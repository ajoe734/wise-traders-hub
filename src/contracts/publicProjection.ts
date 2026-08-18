/**
 * Public projection contract (R1-P).
 *
 * Every consumer-facing surface that shows expert economic facts (quantity,
 * NAV, return, factsheet/download) must go through this module. It is the only
 * place that decides whether a number may be rendered.
 *
 * Rules enforced here:
 *  - a key under manual review, incomplete valuation, or withheld by the
 *    projection is NEVER rendered as a number — not 10, not 50, not 0, not NaN
 *    and not a placeholder percentage. It renders 「資料檢核中」 instead.
 *  - internal reason codes and hashed manifest keys are never returned to the
 *    UI; only a fixed public-safe copy string is.
 *  - the projection being absent, unknown, not-yet-loaded or failing is
 *    fail-closed: it resolves to `incomplete` / `error`, numbers are null and
 *    the review notice renders. There is NO legacy numeric fallback.
 */

export type ProjectionState =
  | 'ready'            // fully replayed, valued, released — numbers may show
  | 'manual_review'    // drift under adjudication (e.g. 6515) — no number ever
  | 'incomplete'       // valuation incomplete: missing FX / derivative multiplier
  | 'withheld'         // publisher withheld the key (embargo, unsupported)
  | 'error';           // read failed — never a number

/** Public-safe copy. These exact strings are the contract. */
export const REVIEW_BADGE = '資料檢核中';
export const REVIEW_NOTE = '該區間不納入績效';

/**
 * Masked-value copy. A gated (fail-closed / relation-error / unknown) economic
 * field must render THIS string — never `0`, `0 股`, `-0.00%` or any other
 * number-shaped placeholder, because 0 is valid business data (a real
 * quantity=0 position exists) and a fake 0 is indistinguishable from it.
 */
export const UNAVAILABLE_LABEL = '資料暫時無法取得';

/**
 * True when a row must render `UNAVAILABLE_LABEL` instead of a number:
 * either the projection gate masked it (`under_review`) or every economic
 * field came back null (the gate's own output shape).
 */
export function isMaskedRow(
  row: { under_review?: boolean | null; quantity?: unknown; base_quantity?: unknown } | null | undefined,
): boolean {
  if (!row) return false;
  if (row.under_review === true) return true;
  return row.quantity == null && row.base_quantity == null;
}


/**
 * Fail-closed set: everything except `ready`. A failed read, an absent
 * projection, an unknown state and a not-yet-loaded scope all land here.
 */
const NOT_READY: ReadonlySet<ProjectionState> = new Set<ProjectionState>([
  'manual_review',
  'incomplete',
  'withheld',
  'error',
]);

export interface ProjectionStatusInput {
  /** row/aggregate state coming from the public projection contract */
  state?: string | null;
  /** true when the publisher withheld at least one key in the shown scope */
  withheld?: boolean | null;
  /** true when valuation could not be completed (FX / multiplier missing) */
  incomplete?: boolean | null;
  /** true when a key in scope is under manual adjudication */
  manualReview?: boolean | null;
  /** the read itself failed */
  failed?: boolean | null;
  /**
   * No projection row exists for this scope (pre-cutover / not deployed).
   * Fail-closed: resolves to `incomplete`, never to a legacy numeric path.
   */
  absent?: boolean | null;
}

export interface ProjectionStatus {
  state: ProjectionState;
  /** may a numeric economic fact be rendered? */
  showNumbers: boolean;
  /** must the 資料檢核中 notice be rendered? */
  showReviewNotice: boolean;
  /** public-safe copy — never an internal reason code or hashed key */
  badge: string | null;
  note: string | null;
}

/** Normalises whatever the projection returns into a single UI state. */
export function resolveProjectionStatus(input: ProjectionStatusInput | null | undefined): ProjectionStatus {
  const i = input ?? {};
  let state: ProjectionState;

  if (i.failed) state = 'error';
  else if (i.absent) state = 'incomplete'; // absent projection fails closed
  else if (i.manualReview || i.state === 'manual_review') state = 'manual_review';
  else if (i.incomplete || i.state === 'incomplete' || i.state === 'withheld_incomplete') state = 'incomplete';
  else if (i.withheld || i.state === 'withheld') state = 'withheld';
  else if (i.state === 'ready' || i.state === 'as_reported_publishable') state = 'ready';
  else state = 'incomplete'; // unknown / not-yet-loaded input fails closed

  const notReady = NOT_READY.has(state);
  return {
    state,
    showNumbers: !notReady,
    showReviewNotice: notReady,
    badge: notReady ? REVIEW_BADGE : null,
    note: notReady ? REVIEW_NOTE : null,
  };
}

/**
 * Renders an economic number only when the state allows it. Returns null (the
 * caller must then render the review notice or an em dash) for every
 * not-ready state, and also for NaN / non-finite input so a broken read can
 * never surface as "NaN%" or a bogus 0.
 */
export function projectedNumber(
  status: ProjectionStatus,
  value: number | null | undefined,
): number | null {
  if (!status.showNumbers) return null;
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Formats a percentage, or null when it must not be shown. */
export function projectedPercent(
  status: ProjectionStatus,
  value: number | null | undefined,
  digits = 2,
): string | null {
  const n = projectedNumber(status, value);
  if (n === null) return null;
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** Formats a money amount, or null when it must not be shown. */
export function projectedAmount(
  status: ProjectionStatus,
  value: number | null | undefined,
  prefix = '$',
): string | null {
  const n = projectedNumber(status, value);
  if (n === null) return null;
  return `${prefix}${Math.round(n).toLocaleString()}`;
}

/**
 * Fail-closed default for any caller that has not resolved a projection yet
 * (not loaded, unknown, injected default). Renders the review notice.
 */
export const UNKNOWN_PROJECTION: ProjectionStatus = resolveProjectionStatus({ incomplete: true });

/**
 * The projection is provably not deployed for this scope (pre-cutover).
 * Fail-closed: identical to `UNKNOWN_PROJECTION` — `incomplete`, no numbers.
 * There is deliberately no legacy numeric path any more.
 */
export const NO_PROJECTION: ProjectionStatus = resolveProjectionStatus({ absent: true });

/** May a factsheet / export be produced for this scope? Only when ready. */
export function canExportFactsheet(status: ProjectionStatus): boolean {
  return status.state === 'ready';
}
