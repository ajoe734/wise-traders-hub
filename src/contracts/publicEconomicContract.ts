/**
 * Typed public economic contract (R1-P consumer closure).
 *
 * Every *public* consumer that used to read expert economic facts straight
 * from the legacy tables (`trade_records`, `expert_signals`,
 * `user_performances`) must pass the payload through one of the gates below.
 *
 * The gates are total: for any not-ready projection state they return a
 * value that CANNOT be rendered as a number. There is no code path that
 * downgrades a withheld/manual-review/incomplete key to 0, 10, 50, NaN or a
 * fabricated percentage — the caller gets `null` / an empty series and must
 * render 「資料檢核中」 instead.
 */

import type { ProjectionStatus } from './publicProjection';

/** Numeric fields that may never leak while a scope is not ready. */
export interface GatedPerformance {
  total_trades: number | null;
  win_rate: number | null;
  max_drawdown: number | null;
  profit_factor: number | null;
  avg_hold_days: number | null;
  avg_pnl_pct: number | null;
  avg_pnl_amount: number | null;
  return_1y: number | null;
  current_asset: number | null;
  starting_capital: number | null;
  realized_pnl_amount: number | null;
  unrealized_pnl_amount: number | null;
  total_return_pct: number | null;
}

const PERF_KEYS: (keyof GatedPerformance)[] = [
  'total_trades', 'win_rate', 'max_drawdown', 'profit_factor', 'avg_hold_days',
  'avg_pnl_pct', 'avg_pnl_amount', 'return_1y', 'current_asset',
  'starting_capital', 'realized_pnl_amount', 'unrealized_pnl_amount',
  'total_return_pct',
];

function finite(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Performance aggregate gate. Not-ready → every numeric field is null, so a
 * card can only render the review notice.
 */
export function gatePerformance<T extends Record<string, unknown>>(
  perf: T | null | undefined,
  status: ProjectionStatus,
): GatedPerformance | null {
  if (!perf) return null;
  const out = {} as GatedPerformance;
  for (const k of PERF_KEYS) {
    (out as unknown as Record<string, number | null>)[k] = status.showNumbers ? finite(perf[k]) : null;
  }
  return out;
}

/**
 * Position/holding row gate. Not-ready → the row keeps its identity
 * (instrument/symbol) but loses every economic figure, and is flagged so the
 * table renders the notice in place of the numbers.
 */
export function gatePositionRows<T extends Record<string, unknown>>(
  rows: T[] | null | undefined,
  status: ProjectionStatus,
): (T & { under_review: boolean })[] {
  const list = Array.isArray(rows) ? rows : [];
  if (status.showNumbers) return list.map((r) => ({ ...r, under_review: false }));
  return list.map((r) => ({
    ...r,
    entry_price: null,
    current_price: null,
    pnl: null,
    pnl_percent: null,
    quantity: null,
    base_quantity: null,
    under_review: true,
  })) as (T & { under_review: boolean })[];
}

/** Capital/NAV gate: not-ready → no capital object at all. */
export function gateCapital<T>(capital: T | null | undefined, status: ProjectionStatus): T | null {
  if (!capital) return null;
  return status.showNumbers ? capital : null;
}

/** Chart/series gate: not-ready → empty series (never a flat 0 line). */
export function gateSeries<T>(series: T[] | null | undefined, status: ProjectionStatus): T[] {
  if (!status.showNumbers) return [];
  return Array.isArray(series) ? series : [];
}

/**
 * Signal-level economics (price hints, quantities) shown to subscribers /
 * anonymous readers. Not-ready → the editorial text survives, the numbers do
 * not.
 */
const SIGNAL_ECON_KEYS = [
  'price_hint', 'entry_price', 'exit_price', 'quantity', 'quantity_shares',
  'capital_pct', 'pnl', 'pnl_percent', 'return_pct',
];

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

/**
 * Public embargo predicate mirrored on the client: a public surface may only
 * acknowledge an effect once T+7 has elapsed. Used for counts/badges so a
 * still-embargoed row cannot even be counted.
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
  return t + graceDays * 86400_000 <= now.getTime();
}

/** Pre-cutover default: no projection row → legacy read path, numbers allowed. */
export const READY_PROJECTION: ProjectionStatus = resolveProjectionStatus({ absent: true });

export type { ProjectionStatus };
