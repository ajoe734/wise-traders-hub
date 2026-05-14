/**
 * Performance calculation helpers extracted from
 * calculate_expert_performance SQL RPC.
 * Pure functions for unit testing; the RPC itself is drift-detected.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Win rate percentage, rounded to 2 decimal places.
 * Returns 0 when totalTrades = 0 (zero-division guard mirrors SQL CASE).
 */
export function calcWinRate(totalTrades: number, winningTrades: number): number {
  if (totalTrades <= 0) return 0;
  return round2((winningTrades / totalTrades) * 100);
}

/**
 * Profit factor = profitSumAmount / lossSumAmount, in dollars (not %).
 * - lossSum = 0 && profitSum > 0 → 999.99 cap
 * - lossSum = 0 && profitSum = 0 → 0
 */
export function calcProfitFactor(profitSumAmount: number, lossSumAmount: number): number {
  if (lossSumAmount > 0) return round2(profitSumAmount / lossSumAmount);
  if (profitSumAmount > 0) return 999.99;
  return 0;
}

export interface ClosedTradeAmount {
  pnl_amount: number;
}

/**
 * Maximum drawdown (in %) from running cumulative pnl_amount series, normalized by starting capital.
 * Mirrors the new SQL RPC algorithm:
 *   running += pnl_amount
 *   peak = max(peak, running)
 *   worst_dd = max(worst_dd, peak - running)
 *   return (worst_dd / starting_capital) * 100
 */
export function calcMaxDrawdown(trades: ClosedTradeAmount[], startingCapital: number): number {
  let peak = 0;
  let runningSum = 0;
  let worstDd = 0;

  for (const trade of trades) {
    runningSum += trade.pnl_amount;
    if (runningSum > peak) peak = runningSum;
    const dd = peak - runningSum;
    if (dd > worstDd) worstDd = dd;
  }

  if (startingCapital <= 0) return 0;
  return round2((worstDd / startingCapital) * 100);
}

/**
 * Total return % = (realized + unrealized) / starting_capital × 100.
 */
export function calcTotalReturnPct(
  realizedAmount: number,
  unrealizedAmount: number,
  startingCapital: number,
): number {
  if (startingCapital <= 0) return 0;
  return round2(((realizedAmount + unrealizedAmount) / startingCapital) * 100);
}

/**
 * Equal-weighted average of pnl_percent across closed trades.
 */
export function calcAvgPnlPct(closedPnlPercents: number[]): number {
  if (closedPnlPercents.length === 0) return 0;
  const sum = closedPnlPercents.reduce((s, v) => s + v, 0);
  return round2(sum / closedPnlPercents.length);
}

/**
 * Average realized pnl amount per closed trade.
 */
export function calcAvgPnlAmount(realizedAmount: number, totalTrades: number): number {
  if (totalTrades <= 0) return 0;
  return Math.round(realizedAmount / totalTrades);
}

/**
 * Average hold days, including open trades (NOW() treated as exit).
 */
export function calcAvgHoldDays(
  trades: { entry_date: Date; exit_date: Date | null }[],
  now: Date = new Date(),
): number {
  if (trades.length === 0) return 0;
  const ms = trades.reduce(
    (s, t) => s + ((t.exit_date ?? now).getTime() - t.entry_date.getTime()),
    0,
  );
  const days = ms / 1000 / 86400 / trades.length;
  return Math.round(days * 10) / 10;
}
