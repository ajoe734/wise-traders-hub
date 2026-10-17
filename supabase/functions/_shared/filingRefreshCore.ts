import { filingDeadline, nextQuarterEnd } from './peerPsCore.ts';

/** Calendar dates are explicitly Taipei, never the last market close. */
export function taipeiDate(now: Date | number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function expiredEstimate(latestPeriod: string, day = taipeiDate()) {
  const end = nextQuarterEnd(latestPeriod);
  const deadline = filingDeadline(end);
  if (day <= deadline) return null;
  const quarter = `${end.slice(0, 4)}Q${Math.ceil(Number(end.slice(5, 7)) / 3)}`;
  return { stale: true as const, quarter, deadline, asOf: day,
    reason: `${quarter} 財報申報期限 ${deadline.replace(/-/g, '/')} 已過，季報應已公布但尚未取得，停用月營收推估以免重複推估同一季（資料不足）` };
}

export const FILING_CHECK_MS = 60 * 60 * 1000;
export function financialCacheValid(at: number, now: number): boolean {
  return now >= at && now - at < FILING_CHECK_MS && taipeiDate(at) === taipeiDate(now);
}

type Row = { date: string; type: string; value: number };
/** A partial filing must not advance the committed quarter. Values may be zero or negative. */
export function completeFinancialPeriods(fs: Row[], bs: Row[]): string[] {
  const fields = (rows: Row[]) => {
    const map = new Map<string, Set<string>>();
    const values = new Map<string, number>();
    const invalid = new Set<string>();
    for (const r of rows) {
      if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(r.date) || r.value == null || String(r.value).trim() === '' || !Number.isFinite(Number(r.value))) continue;
      const types = map.get(r.date) ?? new Set<string>();
      const key = `${r.date}:${r.type}`;
      if (values.has(key) && values.get(key) !== Number(r.value)) invalid.add(r.date);
      values.set(key, Number(r.value));
      types.add(r.type); map.set(r.date, types);
    }
    for (const date of invalid) map.delete(date);
    return map;
  };
  const f = fields(fs); const b = fields(bs);
  return [...f.keys()].filter((p) => {
    const fi = f.get(p); const ba = b.get(p);
    return fi?.has('EPS') && fi.has('Revenue') && ba?.has('OrdinaryShare')
      && (ba.has('Equity') || ba.has('EquityAttributableToOwnersOfParent'));
  }).sort();
}

export function committedFiling<T extends Row>(fs: T[], bs: T[], expected: string | null) {
  const complete = completeFinancialPeriods(fs,bs);
  const latest = complete.at(-1);
  if (!latest || (expected && latest < expected)) return null;
  const periods = new Set(complete);
  return { latest, fs: fs.filter((r) => periods.has(r.date)), bs: bs.filter((r) => periods.has(r.date)) };
}