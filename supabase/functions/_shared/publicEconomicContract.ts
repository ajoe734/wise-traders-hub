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

// ── R1-P projection gate (shared with the frontend contract) ────────────────

/** Minimal projection status shape shared by the Deno and frontend contracts. */
export interface ProjectionStatus {
  state: string;
  showNumbers: boolean;
  showReviewNotice: boolean;
  badge: string | null;
  note: string | null;
}

/** Public-safe copy — identical strings to the frontend contract. */
export const REVIEW_BADGE = '資料檢核中';
export const REVIEW_NOTE = '該區間不納入績效';

/**
 * Fail-closed default: a caller that has not resolved a projection (not
 * loaded, unknown, read failed) never gets numbers.
 */
export const UNKNOWN_PROJECTION: ProjectionStatus = {
  state: 'incomplete',
  showNumbers: false,
  showReviewNotice: true,
  badge: REVIEW_BADGE,
  note: REVIEW_NOTE,
};

/**
 * Explicit pre-cutover legacy path: only for a caller that has observed the
 * projection to be absent for this scope.
 */
export const LEGACY_NO_PROJECTION: ProjectionStatus = {
  state: 'no_projection',
  showNumbers: true,
  showReviewNotice: false,
  badge: null,
  note: null,
};

const SIGNAL_ECON_KEYS = [
  'price_hint', 'entry_price', 'exit_price', 'quantity', 'quantity_shares',
  'capital_pct', 'pnl', 'pnl_percent', 'return_pct',
];

/** Not-ready scopes keep the editorial text and lose every number. */
export function gateSignalEconomics<T extends Record<string, unknown>>(
  rows: T[] | null | undefined,
  status: ProjectionStatus,
): T[] {
  const list = Array.isArray(rows) ? rows : [];
  if (status.showNumbers) return list;
  return list.map((r) => {
    const copy: Record<string, unknown> = { ...r };
    for (const k of SIGNAL_ECON_KEYS) if (k in copy) copy[k] = null;
    copy.under_review = true;
    return copy as T;
  });
}
