export type FinmindJob = { ran_at: string; job_name: string; detail: Record<string, unknown> | null };
export type QuotaObservation = { source: string; remaining: number | null; quota_limit: number | null; reset_at: string | null; observed_at: string };
export const QUOTA_WARNING_RATIO = 0.2;
export const QUOTA_CRITICAL_RATIO = 0.1;
export const QUOTA_OBSERVATION_TTL = 3600000;
export function taipeiDay(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
export function usageWindow(now = new Date()) {
  return new Date(new Date(`${taipeiDay(now.toISOString())}T00:00:00+08:00`).getTime() - 13 * 86400000).toISOString();
}
export function dailyFinmindUsage(jobs: FinmindJob[], now = new Date()) {
  const start = new Date(`${taipeiDay(now.toISOString())}T00:00:00+08:00`).getTime();
  return Array.from({ length: 14 }, (_, i) => {
    const day = taipeiDay(new Date(start - i * 86400000).toISOString());
    const rows = jobs.filter(j => taipeiDay(j.ran_at) === day && ((j.job_name === 'market_data_sync' && j.detail?.mode === 'backfill') || (j.job_name === 'valuation_ps_sync' && j.detail?.mode === 'basis')));
    const symbols = new Set<string>();
    let filings = 0, history = 0, stops = 0, legacy = false;
    for (const j of rows) {
      const d = j.detail ?? {};
      const n = Number(j.job_name === 'market_data_sync' ? d.done : d.ok);
      const count = Number.isFinite(n) && n > 0 ? n : 0;
      if (j.job_name === 'market_data_sync') history += count; else filings += count;
      if (Array.isArray(d.completedSymbols)) d.completedSymbols.forEach(s => { if (typeof s === 'string') symbols.add(s); });
      else if (count > 0) legacy = true;
      if (d.stoppedForQuota === true) stops++;
    }
    return { day, filings, history, unique: legacy ? null : symbols.size, stops, runs: rows.length };
  });
}
export function quotaState(q: QuotaObservation, nowMs = Date.now()) {
  if (q.remaining == null || !Number.isFinite(q.remaining) || q.remaining < 0) return 'unknown';
  const observed = Date.parse(q.observed_at);
  if (!Number.isFinite(observed) || nowMs - observed > QUOTA_OBSERVATION_TTL || (q.reset_at && Date.parse(q.reset_at) <= nowMs)) return 'stale';
  if (q.remaining === 0) return 'exhausted';
  if (q.quota_limit == null || !Number.isFinite(q.quota_limit) || q.quota_limit <= 0) return 'unknown';
  const ratio = q.remaining / q.quota_limit;
  return ratio <= QUOTA_CRITICAL_RATIO ? 'critical' : ratio <= QUOTA_WARNING_RATIO ? 'warning' : 'normal';
}
export async function loadFinmindJobs(make: (offset: number) => PromiseLike<{ data: FinmindJob[] | null; error: unknown }>) {
  const rows: FinmindJob[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await make(offset);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}