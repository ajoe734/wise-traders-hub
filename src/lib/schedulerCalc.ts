/**
 * Scheduler calculation helpers extracted from
 * supabase/functions/daily-performance/index.ts and
 * supabase/functions/daily-snapshot/index.ts.
 * Pure functions for unit testing; the Edge Functions are drift-detected.
 */

/**
 * Calculate PnL percent for a daily performance update.
 * Mirrors the formula in daily-performance/index.ts:
 *   trade.entry_price && trade.entry_price > 0
 *     ? Math.round(((currentPrice - entry_price) / entry_price) * 10000) / 100
 *     : null
 * Returns null when entryPrice is 0 or falsy (zero-division guard).
 */
export function calcDailyPnl(currentPrice: number, entryPrice: number): number | null {
  if (!entryPrice || entryPrice <= 0) return null;
  return Math.round(((currentPrice - entryPrice) / entryPrice) * 10000) / 100;
}

/**
 * Determine if a stock hit the daily limit-up price.
 * Mirrors daily-snapshot/index.ts:
 *   const isLimitUp = p.limit_up != null && p.price != null && p.price >= p.limit_up
 */
export function isLimitUp(price: number | null, limitUp: number | null): boolean {
  return limitUp != null && price != null && price >= limitUp;
}

/**
 * Extract stock symbol from instrument string.
 * Mirrors daily-snapshot/index.ts:
 *   const sym = t.instrument?.split(' ')?.[0]
 * Instrument format: "2330 台積電" — symbol is the first space-delimited part.
 */
export function extractSymbol(instrument: string): string | undefined {
  return instrument?.split(' ')?.[0];
}
