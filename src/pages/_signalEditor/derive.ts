import { simulatePositions, type TradeAction } from '@/lib/simulatePositions';
import { normalizeSignalQuantityToShares } from '@/lib/signalTradeLogic';
import {
  actionLabels, fmtMoney,
  type CapitalStatus, type OpenPosition, type TradeDraft,
} from './types';
import { sanitizeRichHtml } from '@/lib/sanitizeHtml';

/** 將 trades 轉為 `simulateCashAfterTrades` 需要的 row 形狀。 */
export function buildCashSimTrades(trades: TradeDraft[], capital: CapitalStatus | null) {
  const posMap = new Map<string, OpenPosition>();
  (capital?.open_positions || []).forEach((p) => posMap.set(p.symbol, p));
  return trades.map((t) => {
    const shares = normalizeSignalQuantityToShares(
      parseInt(t.quantity || '0', 10) || 0,
      t.quantityUnit,
    );
    const code = t.stockCode.trim();
    const pos = posMap.get(code);
    return {
      action: (t.action || '') as any,
      price: parseFloat(t.priceHint || '0') || 0,
      shares,
      exitShares: pos?.quantity_shares,
      exitAvgPrice: pos?.entry_price,
    };
  });
}

/** 根據目前 trades 推導出「執行後」每檔股票的張數，用於 UI 預覽。 */
export function buildSimulatedPositions(
  trades: TradeDraft[],
  capital: CapitalStatus | null,
) {
  const initial = (capital?.open_positions || []).map((p) => ({
    symbol: p.symbol,
    quantity: p.quantity_shares,
  }));
  const simTrades = trades
    .filter((t) => t.stockCode.trim() && t.action)
    .map((t) => ({
      symbol: t.stockCode.trim(),
      action: t.action as TradeAction,
      quantity: normalizeSignalQuantityToShares(
        parseInt(t.quantity || '0', 10) || 0,
        t.quantityUnit,
      ),
    }));
  return simulatePositions(initial, simTrades);
}

/**
 * 整批 trades 的硬性檢查；任何一條失敗就回傳第一個錯誤訊息（沿用既有 UX）。
 * 注意：剩餘現金、未平倉部位這兩條規則跟 buildCashSimTrades 互相獨立，
 * 為避免「驗證通過但 UI 顯示透支」的不一致，這裡直接用同樣的 simulator。
 */
export function validateSignalBatch(args: {
  expert: any;
  trades: TradeDraft[];
  openPositions: { symbol: string; quantity: number }[];
  capital: CapitalStatus | null;
}): string | null {
  const { expert, trades, openPositions, capital } = args;
  if (!expert) return '找不到分析師資料';
  if (trades.length === 0) return '至少要有一檔股票';

  const initial = openPositions.map((p) => ({ symbol: p.symbol, quantity: p.quantity }));
  const simulated: { symbol: string; action: TradeAction; quantity: number }[] = [];

  let remaining = capital?.available_cash || 0;
  const posMap = new Map<string, OpenPosition>();
  (capital?.open_positions || []).forEach((p) => posMap.set(p.symbol, p));

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const tag = `第 ${i + 1} 檔`;
    if (!t.stockCode.trim()) return `${tag}：請填股票代碼`;
    if (!t.action) return `${tag}：請選操作方向`;
    if (!t.executedAt) return `${tag}：請填操作時間`;
    const qty = parseInt(t.quantity || '0', 10);
    if (!qty || qty <= 0) return `${tag}：請填數量`;
    const price = parseFloat(t.priceHint || '0');
    if (!price || price <= 0) return `${tag}：請填參考價格`;

    const code = t.stockCode.trim();
    const shares = normalizeSignalQuantityToShares(qty, t.quantityUnit);

    if (['add', 'trim', 'sell', 'exit'].includes(t.action)) {
      const sim = simulatePositions(initial, simulated);
      const cur = sim.get(code) || 0;
      if (cur <= 0) return `${tag}：尚無 ${code} 的未平倉部位，無法執行${actionLabels[t.action]}`;
      if ((t.action === 'trim' || t.action === 'sell') && qty > cur) {
        return `${tag}：減碼數量 (${qty}) 超過模擬持倉 (${cur})`;
      }
    }

    if (t.action === 'buy' || t.action === 'add') {
      const required = price * shares;
      if (required > remaining) {
        return `${tag}：本筆需 ${fmtMoney(required)}，剩餘可用現金僅 ${fmtMoney(remaining)}，已超過操作金額上限`;
      }
      remaining -= required;
    } else if (t.action === 'sell' || t.action === 'trim') {
      remaining += price * shares;
    } else if (t.action === 'exit') {
      const pos = posMap.get(code);
      remaining += (pos?.entry_price || price) * (pos?.quantity_shares || shares);
    }

    simulated.push({ symbol: code, action: t.action as TradeAction, quantity: qty });
  }
  return null;
}

/** 把 trades 轉成 expert_signals insert payload 陣列。 */
export function buildPublishRows(args: {
  expertId: string;
  batchId: string;
  status: string;
  isMentor: boolean;
  teachingTopic: string;
  overallSummary: string;
  learningPoints: string;
  trades: TradeDraft[];
}) {
  const { expertId, batchId, status, isMentor, teachingTopic, overallSummary, learningPoints, trades } = args;
  return trades.map((t, idx) => {
    const instrument = t.stockName.trim()
      ? `${t.stockCode.trim()} ${t.stockName.trim()}`
      : t.stockCode.trim();
    return {
      expert_id: expertId,
      plan_id: null,
      batch_id: batchId,
      instrument,
      action: t.action as any,
      price_hint: parseFloat(t.priceHint),
      quantity: parseInt(t.quantity, 10),
      quantity_unit: t.quantityUnit,
      executed_at: new Date(t.executedAt).toISOString(),
      reason_summary: sanitizeRichHtml(t.reasonSummary),
      reason_detail: sanitizeRichHtml(t.reasonDetail),
      risk_notes: sanitizeRichHtml(t.riskNotes),
      teaching_topic: idx === 0 && isMentor ? teachingTopic || null : null,
      overall_summary: idx === 0 && isMentor ? sanitizeRichHtml(overallSummary) || null : null,
      learning_points: idx === 0 && isMentor ? sanitizeRichHtml(learningPoints) || null : null,
      status: status as any,
    } as any;
  });
}
