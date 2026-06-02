/**
 * Holding math primitives — 唯一公式入口（憲法）
 *
 * H 系列修復（2026-06）：
 *   - 新增 toSafeNumber：吸收 string/null/undefined/NaN/Infinity，禁止裸 Number()（H1）
 *   - calculateHoldingReturnPct: costBasis 非有限數 / <=0 一律 0，杜絕 Infinity/NaN（H7）
 *   - 任何 *qty/-cost 公式只允許出現在本檔；其它檔案禁止實作（H6 護欄）
 *
 * 護欄腳本：scripts/check-holdings-formula-singleton.mjs 會掃描其它檔案，
 * 出現 `qty.*-.*cost|cost.*\\*.*qty` 字面 pattern 即 CI 阻擋。
 */

export interface HoldingLike {
  code?: string | null;
  name?: string | null;
  qty?: number | string | null;
  cost?: number | string | null;
  price?: number | string | null;
  value?: number | string | null;
  pnl?: number | null;
  pct?: number | null;
}

export interface PriceMap {
  [code: string]: number | undefined;
}

/**
 * Coerce any input to a finite number; fall back to `fallback` (default 0).
 * 唯一允許在 holdings 數學中對外部資料做數字轉換的入口。
 */
export function toSafeNumber(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function calculateHoldingCostBasis(cost: unknown, qty: unknown): number {
  return toSafeNumber(cost) * toSafeNumber(qty);
}

export function calculateHoldingMarketValue(price: unknown, qty: unknown): number {
  return toSafeNumber(price) * toSafeNumber(qty);
}

export function calculateHoldingUnrealizedPnl(price: unknown, qty: unknown, cost: unknown): number {
  return calculateHoldingMarketValue(price, qty) - calculateHoldingCostBasis(cost, qty);
}

export function calculateHoldingReturnPct(price: unknown, qty: unknown, cost: unknown): number {
  const costBasis = calculateHoldingCostBasis(cost, qty);
  // H7 (audit 2026-06): cost=0 / 負數 / 非有限數 → 一律 0，杜絕 Infinity/NaN
  if (!Number.isFinite(costBasis) || costBasis <= 0) return 0;
  const pnl = calculateHoldingUnrealizedPnl(price, qty, cost);
  if (!Number.isFinite(pnl)) return 0;
  return (pnl / costBasis) * 100;
}

/**
 * 加碼加權均價：(currentCost × currentQty + addPrice × addQty) / totalQty
 * 對應 FreeCheckup.jsx 買進加碼邏輯（5.5-5）
 */
export function calcWeightedAvgCost(
  currentCost: number,
  currentQty: number,
  addPrice: number,
  addQty: number,
): number {
  const cc = toSafeNumber(currentCost);
  const cq = toSafeNumber(currentQty);
  const ap = toSafeNumber(addPrice);
  const aq = toSafeNumber(addQty);
  const totalQty = cq + aq;
  if (totalQty === 0) return 0;
  return (cc * cq + ap * aq) / totalQty;
}

/**
 * 預估淨收付：市值 - 手續費 - 證交稅
 * 稅率：6碼（權證）= 0.1%，4碼（股票）= 0.3%（5.5-1 / 5.5-2）
 */
export function calcNetSettlement(
  marketValue: number,
  fee: number | null | undefined,
  code: string,
): number {
  const mv = toSafeNumber(marketValue);
  const f = toSafeNumber(fee);
  const taxRate = String(code || '').length === 6 ? 0.001 : 0.003;
  const tax = Math.round(mv * taxRate);
  return mv - f - tax;
}

export interface PnlInput {
  qty: number;
  cost?: number | null;
  totalCost?: number | null;
  fee?: number | null;
  code?: string;
}

export interface PnlResult {
  value: number;
  pnl: number;
  pct: number;
}

/**
 * 計算持倉損益（5.5-1/2 精確模式 或 Fallback 模式）
 * 精確模式：h.totalCost && h.fee 皆有值 → pnl = calcNetSettlement(marketValue, fee, code) - totalCost
 * Fallback：pnl = round((newPrice - cost) × qty)
 */
export function calcPnlWithNet(h: PnlInput, newPrice: number): PnlResult {
  const qty = toSafeNumber(h?.qty);
  const np = toSafeNumber(newPrice);
  const newValue = Math.round(np * qty);
  const hasCostAndFee = h?.totalCost != null && h?.fee != null;
  if (hasCostAndFee) {
    const net = calcNetSettlement(newValue, h.fee, h.code || '');
    const totalCost = toSafeNumber(h.totalCost);
    const pnl = net - totalCost;
    const pct = totalCost > 0 ? Math.round((pnl / totalCost) * 10000) / 100 : 0;
    return { value: newValue, pnl, pct };
  }
  const cost = toSafeNumber(h?.cost);
  const pnl = Math.round((np - cost) * qty);
  const pct = cost > 0 ? Math.round((np / cost - 1) * 10000) / 100 : 0;
  return { value: newValue, pnl, pct };
}

/**
 * 賣出後按比例縮減 totalCost 和 fee（5.5-6）
 * ratio = remainQty / originalQty，結果 Math.round 取整
 */
export function calcRemainingCostAfterPartialSell(
  totalCost: number | null,
  fee: number | null,
  remainQty: number,
  originalQty: number,
): { newTotalCost: number | null; newFee: number | null } {
  if (originalQty === 0) return { newTotalCost: null, newFee: null };
  const ratio = remainQty / originalQty;
  return {
    newTotalCost: totalCost != null ? Math.round(totalCost * ratio) : null,
    newFee: fee != null ? Math.round(fee * ratio) : null,
  };
}

export function calculateTotalMarketValue(holdings: HoldingLike[], prices: PriceMap = {}): number {
  return (Array.isArray(holdings) ? holdings : []).reduce((total, holding) => {
    const code = String(holding?.code || '').trim();
    const marketPrice = code ? toSafeNumber(prices[code]) : 0;
    const fallbackPrice = marketPrice > 0 ? marketPrice : toSafeNumber(holding?.cost);
    return total + calculateHoldingMarketValue(fallbackPrice, holding?.qty);
  }, 0);
}
