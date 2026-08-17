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
 *  - the projection being absent (pre-cutover) or failing is a distinct state:
 *    the page keeps working on the legacy read path and never blanks out.
 */

export type ProjectionState =
  | 'ready'            // fully replayed, valued, released — numbers may show
  | 'manual_review'    // drift under adjudication (e.g. 6515) — no number ever
  | 'incomplete'       // valuation incomplete: missing FX / derivative multiplier
  | 'withheld'         // publisher withheld the key (embargo, unsupported)
  | 'no_projection'    // projection not deployed for this expert — legacy path
  | 'error';           // read failed — legacy path, but never a fake number

/** Public-safe copy. These exact strings are the contract. */
export const REVIEW_BADGE = '資料檢核中';
export const REVIEW_NOTE = '該區間不納入績效';

const NOT_READY: ReadonlySet<ProjectionState> = new Set<ProjectionState>([
  'manual_review',
  'incomplete',
  'withheld',
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
  /** no projection row exists for this expert (pre-cutover) */
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
  else if (i.absent) state = 'no_projection';
  else if (i.manualReview || i.state === 'manual_review') state = 'manual_review';
  else if (i.incomplete || i.state === 'incomplete' || i.state === 'withheld_incomplete') state = 'incomplete';
  else if (i.withheld || i.state === 'withheld') state = 'withheld';
  else if (i.state === 'ready' || i.state === 'as_reported_publishable') state = 'ready';
  else if (i.state == null) state = 'no_projection';
  else state = 'incomplete'; // unknown state fails closed

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

/** May a factsheet / export be produced for this scope? */
export function canExportFactsheet(status: ProjectionStatus): boolean {
  return status.state === 'ready' || status.state === 'no_projection';
}
