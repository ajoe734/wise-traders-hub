// Pure helpers for ig-conversion-report (shared with Vitest).

export const MAX_RANGE_DAYS = 31;
export const RATE_LIMIT_PER_MINUTE = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(s: string | null): number | null {
  if (!s || !DATE_RE.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return null;
  return t;
}

export type RangeResult = { ok: true; since: string; until: string } | { ok: false; error: string };

/** since/until inclusive Taipei dates, at most 31 days total. */
export function validateRange(since: string | null, until: string | null): RangeResult {
  const a = parseDate(since);
  const b = parseDate(until);
  if (a === null || b === null) return { ok: false, error: 'since and until must be YYYY-MM-DD' };
  if (b < a) return { ok: false, error: 'until must be on or after since' };
  const days = (b - a) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, error: `range must be at most ${MAX_RANGE_DAYS} days` };
  return { ok: true, since: since!, until: until! };
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** Sliding-window limiter (in-memory, per runtime instance). */
export function createRateLimiter(limit = RATE_LIMIT_PER_MINUTE, windowMs = 60_000) {
  let hits: number[] = [];
  return (now: number): boolean => {
    hits = hits.filter((t) => now - t < windowMs);
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  };
}

export const REPORT_FIELDS = [
  'date', 'utm_source', 'utm_medium', 'utm_campaign', 'visitors', 'signups',
  'purchases', 'revenue', 'holdings_board_conversions', 'event_signups',
] as const;

export type ReportRow = Record<(typeof REPORT_FIELDS)[number], string | number>;

/** Whitelist projection: only aggregate fields leave the function. */
export function projectRows(rows: Array<Record<string, unknown>>): ReportRow[] {
  return rows.map((r) => ({
    date: String(r.date),
    utm_source: String(r.utm_source),
    utm_medium: String(r.utm_medium),
    utm_campaign: String(r.utm_campaign),
    visitors: Math.round(Number(r.visitors) || 0),
    signups: Math.round(Number(r.signups) || 0),
    purchases: Math.round(Number(r.purchases) || 0),
    revenue: Math.round(Number(r.revenue) || 0),
    holdings_board_conversions: Math.round(Number(r.holdings_board_conversions) || 0),
    event_signups: Math.round(Number(r.event_signups) || 0),
  }));
}
