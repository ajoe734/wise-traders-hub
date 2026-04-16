/**
 * Performance calculation helpers extracted from
 * calculate_expert_performance SQL RPC
 * (supabase/migrations/20260410062402_46a61b2e-c8c1-49a7-b28e-971f72960382.sql).
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
 * Profit factor = profitSum / lossSum, rounded to 2 decimal places.
 * - lossSum = 0 && profitSum > 0 → 999.99 (mirrors SQL 999.99 cap)
 * - lossSum = 0 && profitSum = 0 → 0
 */
export function calcProfitFactor(profitSum: number, lossSum: number): number {
  if (lossSum > 0) return round2(profitSum / lossSum);
  if (profitSum > 0) return 999.99;
  return 0;
}

export interface ClosedTrade {
  pnl_percent: number;
}

/**
 * Maximum drawdown from a running-sum series of closed trades.
 * Mirrors the FOR loop in calculate_expert_performance SQL RPC:
 *   running_sum += pnl_percent
 *   if running_sum > peak → peak = running_sum
 *   if (peak - running_sum) > worst_dd → worst_dd = peak - running_sum
 * Trades must be ordered by exit_date ASC (caller responsibility).
 */
export function calcMaxDrawdown(trades: ClosedTrade[]): number {
  let peak = 0;
  let runningSum = 0;
  let worstDd = 0;

  for (const trade of trades) {
    runningSum += trade.pnl_percent;
    if (runningSum > peak) peak = runningSum;
    const dd = peak - runningSum;
    if (dd > worstDd) worstDd = dd;
  }

  return round2(worstDd);
}
