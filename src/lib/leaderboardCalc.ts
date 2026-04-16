/**
 * Leaderboard calculation helpers extracted from
 * get_weekly_limit_up_leaderboard SQL RPC
 * (supabase/migrations/20260411122030_df1211b9-9a01-4ddb-8e47-df9b058c0a74.sql).
 * Pure functions for unit testing; the RPC itself is drift-detected.
 */

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Win rate percentage for the leaderboard, rounded to 1 decimal place.
 * Mirrors the CASE WHEN COALESCE(p.total_closed, 0) > 0 guard in the RPC.
 * Returns 0 when totalClosed = 0 (zero-division guard).
 */
export function calcLeaderboardWinRate(totalClosed: number, wins: number): number {
  if (totalClosed <= 0) return 0;
  return round1((wins / totalClosed) * 100);
}
