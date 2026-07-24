// Pure helpers extracted from admin/Signals.tsx
import { isMarketClosedFor, sanitizeAssetQuantityUnit, type MarketHours } from '@/lib/asset';
import { SIGNAL_ACTION_META } from '@/lib/signalAction';

export const actionLabelMap: Record<string, string> = Object.fromEntries(
  Object.entries(SIGNAL_ACTION_META).map(([key, meta]) => [meta.label, key]),
);
export const statusOnlyKeywords = ['持有中', '已平倉', '待發布'];


/**
 * 是否已收盤（供訊號／週記發布判斷）
 *
 * @param mode  'tw' (default) | 'us' | '24x7'；未傳 = 台股，向下相容
 * @param now   當前時間
 */
export function isMarketClosed(mode: MarketHours | Date = 'tw', now: Date = new Date()): boolean {
  if (mode instanceof Date) return isMarketClosedFor('tw', mode);
  return isMarketClosedFor(mode, now);
}

/** 判斷 buy signal 實際是否為「加碼」（同標的後續買進） */
export function computeAddBuySignalIds(signals: any[], openInstruments: Set<string>): Set<string> {
  const ids = new Set<string>();
  const sorted = [...signals].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const openPositions = new Map<string, boolean>();
  for (const s of sorted) {
    const inst = s.instrument;
    if (s.action === 'buy') {
      if (openPositions.get(inst)) ids.add(s.id);
      else openPositions.set(inst, true);
    } else if (s.action === 'add') {
      openPositions.set(inst, true);
    } else if (s.action === 'exit') {
      openPositions.set(inst, false);
    } else if (s.action === 'sell' || s.action === 'trim') {
      if (!openInstruments.has(inst)) openPositions.set(inst, false);
    }
  }
  return ids;
}

export function getDisplayStatus(
  s: any,
  openInstruments: Set<string>,
  addBuySignalIds: Set<string>,
): string {
  if (s.status === 'pending') return '待發布';
  if (s.action === 'exit') return '已平倉';
  if (['sell', 'trim'].includes(s.action)) return openInstruments.has(s.instrument) ? '減碼' : '已平倉';
  if (s.action === 'add') return '加碼';
  if (s.action === 'buy' && addBuySignalIds.has(s.id)) return '加碼';
  return '持有中';
}

export function filterSignals(
  signals: any[],
  searchQuery: string,
  openInstruments: Set<string>,
  addBuySignalIds: Set<string>,
): any[] {
  return signals.filter((s) => {
    if (!searchQuery.trim()) return true;
    const conditions = searchQuery.split('、').map((c) => c.trim()).filter(Boolean);
    const sigDateFull = s.published_at
      ? new Date(s.published_at).toLocaleString('zh-TW', {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      : '';
    const displayStatus = getDisplayStatus(s, openInstruments, addBuySignalIds);

    return conditions.every((cond) => {
      const lower = cond.toLowerCase();
      if (actionLabelMap[cond]) return s.action === actionLabelMap[cond];
      if (statusOnlyKeywords.includes(cond)) return displayStatus === cond;
      if (cond === '加碼') return s.action === 'add' || displayStatus === '加碼';
      if (cond === '減碼') return s.action === 'trim' || displayStatus === '減碼';
      return (
        s.instrument?.toLowerCase().includes(lower) ||
        sigDateFull.includes(cond) ||
        (typeof s.reason_summary === 'string' && s.reason_summary.toLowerCase().includes(lower))
      );
    });
  });
}

export function computeBatchInfo(signals: any[]): Map<string, { count: number; instruments: string[] }> {
  const m = new Map<string, { count: number; instruments: string[] }>();
  signals.forEach((s: any) => {
    if (!s.batch_id) return;
    const cur = m.get(s.batch_id) || { count: 0, instruments: [] };
    cur.count += 1;
    if (!cur.instruments.includes(s.instrument)) cur.instruments.push(s.instrument);
    m.set(s.batch_id, cur);
  });
  return m;
}

export interface HoldingSummaryRow {
  instrument: string;
  zhangQty: number;
  guQty: number;
  cost: number;
}

export function computeHoldingSummary(
  filtered: any[],
  searchQuery: string,
): HoldingSummaryRow[] | null {
  if (!searchQuery.trim()) return null;
  const instrumentMap = new Map<string, { zhangQty: number; guQty: number; zhangCost: number; guCost: number }>();
  const sorted = [...filtered].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  for (const s of sorted) {
    const inst = s.instrument;
    const qty = s.quantity || 1;
    // 依 asset_class 決定合法單位；不再一律 fallback 成「張」（美股/加密幣會誤算 ×1000）
    const assetClass = s.asset_class || (s.currency === 'USD' ? 'us_stock' : 'tw_stock');
    const unit = sanitizeAssetQuantityUnit(s.quantity_unit, assetClass);
    const price = s.price_hint || 0;
    const current = instrumentMap.get(inst) || { zhangQty: 0, guQty: 0, zhangCost: 0, guCost: 0 };
    const isLot = unit === '張';
    const lineCost = isLot ? price * qty * 1000 : price * qty;

    if (s.action === 'buy' || s.action === 'add') {
      if (isLot) { current.zhangQty += qty; current.zhangCost += lineCost; }
      else { current.guQty += qty; current.guCost += lineCost; }
      instrumentMap.set(inst, current);
    } else if (s.action === 'sell' || s.action === 'trim') {
      if (isLot) {
        current.zhangQty = Math.max(0, current.zhangQty - qty);
        current.zhangCost = Math.max(0, current.zhangCost - lineCost);
      } else {
        current.guQty = Math.max(0, current.guQty - qty);
        current.guCost = Math.max(0, current.guCost - lineCost);
      }
      instrumentMap.set(inst, current);
    } else if (s.action === 'exit') {
      instrumentMap.set(inst, { zhangQty: 0, guQty: 0, zhangCost: 0, guCost: 0 });
    }
  }

  const entries = Array.from(instrumentMap.entries()).filter(([, v]) => v.zhangQty > 0 || v.guQty > 0);
  if (entries.length === 0) return null;

  return entries.map(([inst, v]) => ({
    instrument: inst,
    zhangQty: v.zhangQty,
    guQty: v.guQty,
    cost: v.zhangCost + v.guCost,
  }));
}
