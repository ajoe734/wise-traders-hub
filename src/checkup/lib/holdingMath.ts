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

export function calculateTotalMarketValue(holdings: HoldingLike[], prices: PriceMap = {}): number {
  return (Array.isArray(holdings) ? holdings : []).reduce((total, holding) => {
    const code = String(holding?.code || "").trim();
    const marketPrice = code ? toFiniteNumber(prices[code]) : 0;
    const fallbackPrice = marketPrice > 0 ? marketPrice : toFiniteNumber(holding?.cost);
    return total + calculateHoldingMarketValue(fallbackPrice, holding?.qty);
  }, 0);
}
