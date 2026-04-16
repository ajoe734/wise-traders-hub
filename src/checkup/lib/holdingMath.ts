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

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function calculateHoldingCostBasis(cost: unknown, qty: unknown): number {
  return toFiniteNumber(cost) * toFiniteNumber(qty);
}

export function calculateHoldingMarketValue(price: unknown, qty: unknown): number {
  return toFiniteNumber(price) * toFiniteNumber(qty);
}

export function calculateHoldingUnrealizedPnl(price: unknown, qty: unknown, cost: unknown): number {
  return calculateHoldingMarketValue(price, qty) - calculateHoldingCostBasis(cost, qty);
}

export function calculateHoldingReturnPct(price: unknown, qty: unknown, cost: unknown): number {
  const costBasis = calculateHoldingCostBasis(cost, qty);
  if (costBasis <= 0) return 0;
  return (calculateHoldingUnrealizedPnl(price, qty, cost) / costBasis) * 100;
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
  const totalQty = currentQty + addQty;
  if (totalQty === 0) return 0;
  return (currentCost * currentQty + addPrice * addQty) / totalQty;
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
  const taxRate = (code || '').length === 6 ? 0.001 : 0.003;
  const tax = Math.round(marketValue * taxRate);
  return marketValue - (fee || 0) - tax;
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
  const newValue = Math.round(newPrice * h.qty);
  const hasCostAndFee = h.totalCost != null && h.fee != null;
  if (hasCostAndFee) {
    const net = calcNetSettlement(newValue, h.fee, h.code || '');
    const pnl = net - h.totalCost!;
    const pct = h.totalCost! > 0 ? Math.round((pnl / h.totalCost!) * 10000) / 100 : 0;
    return { value: newValue, pnl, pct };
  }
  const cost = h.cost ?? 0;
  const pnl = Math.round((newPrice - cost) * h.qty);
  const pct = cost > 0 ? Math.round((newPrice / cost - 1) * 10000) / 100 : 0;
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
    const code = String(holding?.code || "").trim();
    const marketPrice = code ? toFiniteNumber(prices[code]) : 0;
    const fallbackPrice = marketPrice > 0 ? marketPrice : toFiniteNumber(holding?.cost);
    return total + calculateHoldingMarketValue(fallbackPrice, holding?.qty);
  }, 0);
}
