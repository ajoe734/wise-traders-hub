/**
 * Deno mirror of `src/contracts/publicEconomicContract.ts` (R1-P).
 *
 * Public edge surfaces (OG metadata, share cards) must not acknowledge an
 * effect before its T+7 visibility date, and must never emit an economic
 * figure for a key that the projection has not released.
 */

export const EMBARGO_DAYS = 7;

export function isPubliclyVisible(
  publishedAt: string | Date | null | undefined,
  now: Date = new Date(),
  graceDays: number = EMBARGO_DAYS,
): boolean {
  if (!publishedAt) return false;
  const t = publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(String(publishedAt));
  if (!Number.isFinite(t)) return false;
  return t + graceDays * 86_400_000 <= now.getTime();
}

/** Economic fields that must never appear in public metadata. */
const FORBIDDEN = [
  'price_hint', 'entry_price', 'exit_price', 'quantity', 'quantity_shares',
  'capital_pct', 'pnl', 'pnl_percent', 'return_pct', 'current_asset',
  'total_return_pct',
];

/** Throws in tests / strips in production if an economic field sneaks in. */
export function stripEconomicFacts<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row };
  for (const k of FORBIDDEN) delete copy[k];
  return copy as T;
}

export function isEconomicFactField(name: string): boolean {
  return FORBIDDEN.includes(name);
}
