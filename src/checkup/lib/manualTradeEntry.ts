/**
 * manualTradeEntry — 手動新增成交的**純函式層**（零 React、零 I/O、零 state）。
 *
 * 憲法：
 *   - 手動列與 OCR 列進入**同一個** `parsed.trades` preview 清單，
 *     最後只走 `TradeTab.applyCorrections` 這一條 commit 管線。這裡不做任何提交。
 *   - `buildManualTradeRow` 以 **exact 12-key 白名單**輸出，表單 draft 的其他欄位一律被 strip。
 *   - 日期／時間沿用 `applyCorrections` 既有慣例（`zh-TW` 非補零 `YYYY/M/D` + `HH:mm`），
 *     不引入第二種格式，`replayTradeLog` 的排序行為維持不變。
 */

import { normalizeStockCode, qtyRuleFor, validateQty, classifyCode } from './stockIdentity';
import { MAX_HOLDINGS } from '@/pages/_freeCheckup/constants.jsx';

/** manual row 的 canonical key set（builder / whitelist / test 三處唯一依據）。 */
export const MANUAL_ROW_KEYS = [
  'action',
  'code',
  'name',
  'qty',
  'price',
  'market_price',
  'amount',
  'total_cost',
  'fee',
  'date',
  'time',
  'priceSource',
] as const;

export type ManualRowKey = (typeof MANUAL_ROW_KEYS)[number];

export interface ManualTradeRow {
  action: string;
  code: string;
  name: string;
  qty: number;
  price: number;
  market_price: number | null;
  amount: number | null;
  total_cost: number | null;
  fee: number | null;
  date: string;
  time: string;
  priceSource: 'manual';
}

export interface ParsedShell {
  trades: any[];
  targetPriceUpdates: any[];
  note: string;
}

/** 與 `checkup-parse` response 消費形狀相容的空殼。 */
export function createParsedShell(): ParsedShell {
  return { trades: [], targetPriceUpdates: [], note: '' };
}

/** 現行慣例：`toLocaleDateString('zh-TW')` → `2026/8/29`（非補零）。 */
export function formatTradeDate(value?: Date | string | null): string {
  if (typeof value === 'string' && value.trim()) {
    // `<input type="date">` 給的是 `YYYY-MM-DD`；轉成同一非補零慣例。
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${Number(m[1])}/${Number(m[2])}/${Number(m[3])}`;
    return value.trim();
  }
  const d = value instanceof Date ? value : new Date();
  return d.toLocaleDateString('zh-TW');
}

/** 現行慣例：`HH:mm`。 */
export function formatTradeTime(value?: Date | string | null): string {
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) {
    const [h, mi] = value.trim().split(':');
    return `${String(Number(h)).padStart(2, '0')}:${mi}`;
  }
  const d = value instanceof Date ? value : new Date();
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
}

export interface ManualDraft {
  action?: string;
  code?: unknown;
  name?: unknown;
  qty?: unknown;
  price?: unknown;
  date?: string | null;
  time?: string | null;
  /** 只存在於表單 local state，永遠不會進 row。 */
  nameDirty?: boolean;
  [k: string]: unknown;
}

/** draft → exact 12-key manual row。缺值一律 `null`，不是 `undefined`／`0`。 */
export function buildManualTradeRow(draft: ManualDraft): ManualTradeRow {
  const code = normalizeStockCode(draft?.code);
  const name = String(draft?.name ?? '').trim() || code;
  const action = String(draft?.action ?? '').trim() === '賣出' ? '賣出' : '買進';
  return {
    action,
    code,
    name,
    qty: Number(draft?.qty),
    price: Number(draft?.price),
    market_price: null,
    amount: null,
    total_cost: null,
    fee: null,
    date: formatTradeDate(draft?.date ?? null),
    time: formatTradeTime(draft?.time ?? null),
    priceSource: 'manual',
  };
}

export interface DraftError {
  field: 'code' | 'name' | 'qty' | 'price';
  message: string;
}

/** 表單送出前的欄位檢查（與 preview 的 `validateRow` 規則一致）。 */
export function validateManualDraft(draft: ManualDraft): DraftError[] {
  const errs: DraftError[] = [];
  const code = normalizeStockCode(draft?.code);
  if (!code) errs.push({ field: 'code', message: '請填寫代碼' });
  else if (classifyCode(code) === 'unknown') {
    errs.push({ field: 'code', message: '代碼格式不正確（台股 4–6 碼，美股 1–5 英文字母）' });
  }
  const qtyErr = validateQty(code, draft?.qty);
  if (qtyErr) errs.push({ field: 'qty', message: qtyErr });
  const price = Number(draft?.price);
  if (!Number.isFinite(price) || price <= 0) errs.push({ field: 'price', message: '成交價需大於 0' });
  return errs;
}

/**
 * 把手動列 append 到既有 preview 清單尾端（順序永不重排）。
 * `parsed === null` → 先建 shell。
 */
export function appendToParsed(parsed: any, row: ManualTradeRow): ParsedShell {
  const base: ParsedShell = parsed && typeof parsed === 'object'
    ? {
        ...parsed,
        trades: Array.isArray(parsed.trades) ? parsed.trades : [],
        targetPriceUpdates: Array.isArray(parsed.targetPriceUpdates) ? parsed.targetPriceUpdates : [],
        note: typeof parsed.note === 'string' ? parsed.note : '',
      }
    : createParsedShell();
  return { ...base, trades: [...base.trades, row] };
}

/** 移除一列；清空後回 `null`（preview 區整段消失）。 */
export function removeFromParsed(parsed: any, index: number): ParsedShell | null {
  const trades = Array.isArray(parsed?.trades) ? parsed.trades : [];
  const next = trades.filter((_: unknown, i: number) => i !== index);
  if (next.length === 0) return null;
  return { ...parsed, trades: next };
}

export type PreviewIssue =
  | { kind: 'oversell'; index: number; code: string; held: number; selling: number }
  | { kind: 'max_holdings'; index: null; overBy: number };

const SNAPSHOT_ACTION = '持倉匯入';

/**
 * 依 preview 陣列**順序**逐列 replay，回報賣超與持倉上限問題。
 * 純函式：呼叫端每次 render 直接 derive，逐列編輯／刪除／換序都會即時重算。
 */
export function computePreviewIssues(holdings: any[] | null | undefined, trades: any[] | null | undefined): PreviewIssue[] {
  const issues: PreviewIssue[] = [];
  const map = new Map<string, number>();
  for (const h of Array.isArray(holdings) ? holdings : []) {
    const code = normalizeStockCode(h?.code);
    if (!code) continue;
    map.set(code, (map.get(code) || 0) + (Number(h?.qty) || 0));
  }

  const rows = Array.isArray(trades) ? trades : [];
  rows.forEach((t, index) => {
    const code = normalizeStockCode(t?.code);
    const qty = Number(t?.qty);
    if (!code || !Number.isFinite(qty) || qty <= 0) return;
    const action = String(t?.action ?? '').trim();
    if (action === SNAPSHOT_ACTION) {
      map.set(code, qty);
      return;
    }
    if (action === '賣出') {
      const held = map.get(code) || 0;
      if (qty > held) {
        issues.push({ kind: 'oversell', index, code, held, selling: qty });
        map.set(code, 0);
        return;
      }
      map.set(code, held - qty);
      return;
    }
    map.set(code, (map.get(code) || 0) + qty);
  });

  let live = 0;
  for (const qty of map.values()) if (qty > 0) live += 1;
  if (live > MAX_HOLDINGS) issues.push({ kind: 'max_holdings', index: null, overBy: live - MAX_HOLDINGS });

  return issues;
}

/** 給 UI 用的中文訊息（單一文案來源）。 */
export function describeIssue(issue: PreviewIssue): string {
  if (issue.kind === 'oversell') {
    return `${issue.code} 賣出 ${issue.selling} 超過目前持有 ${issue.held}`;
  }
  return `合併後持倉將達上限以上，超出 ${issue.overBy} 檔（上限 ${MAX_HOLDINGS}）`;
}

export { qtyRuleFor };
