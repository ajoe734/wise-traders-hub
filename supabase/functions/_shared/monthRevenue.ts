/**
 * 月營收近 3 個月年增率（純函式，Deno 與 Vitest 共用）。
 * 供站牌「月營收自建前瞻 EPS」：未來四季 EPS ≈ 近四季 EPS × (1 + 近 3 個月營收年增率)，
 * 即近四季營收 × (1+g) × 近四季淨利率 ÷ 股數（淨利率、股數不變時兩式相等）。
 */
export type MonthRevenueRow = { revenue: number | string; revenue_year: number | string; revenue_month: number | string };
export type Revenue3m = { yoy: number; latestMonth: string; months: string[] };

export function revenue3mYoY(rows: MonthRevenueRow[] | null | undefined): Revenue3m | null {
  const map = new Map<string, number>();
  for (const r of rows || []) {
    const y = Number(r.revenue_year); const m = Number(r.revenue_month); const v = Number(r.revenue);
    if (Number.isInteger(y) && m >= 1 && m <= 12 && Number.isFinite(v) && v > 0) map.set(`${y}-${String(m).padStart(2, '0')}`, v);
  }
  const keys = [...map.keys()].sort();
  const latest = keys.at(-1);
  if (!latest) return null;
  const months: string[] = [];
  let [y, m] = latest.split('-').map(Number);
  for (let i = 0; i < 3; i++) { months.push(`${y}-${String(m).padStart(2, '0')}`); m -= 1; if (m === 0) { m = 12; y -= 1; } }
  const prev = months.map((k) => `${Number(k.slice(0, 4)) - 1}${k.slice(4)}`);
  if (![...months, ...prev].every((k) => map.has(k))) return null;
  const cur = months.reduce((s, k) => s + (map.get(k) as number), 0);
  const old = prev.reduce((s, k) => s + (map.get(k) as number), 0);
  return { yoy: cur / old - 1, latestMonth: latest, months: months.reverse() };
}

/**
 * 站牌分母「近三季已公布＋下一季月營收推估」（規則：docs/valuation/three-rulers-rules.md §3）。
 * 下一季 EPS ＝ 最新一季 EPS ×（下一季 3 個月營收合計 ÷ 最新一季營收），即沿用最新一季淨利率。
 * PE 分母保留已核實的股數口徑：basis.eps ×（近三季 EPS＋推估 EPS）÷ 近四季 EPS 合計。
 * PS 分母：（近三季營收＋下一季 3 個月營收）÷ PS 股數。
 * 下一季 3 個月營收未齊、或下一季季報已公布 → null（退回近四季實際）。
 */
export type QuarterLite = { period: string; revenue: number | null; reportedEps: number | null };
export type BasisLite = { quarters: QuarterLite[]; eps: number | null; reportedEpsSum: number | null; psShares: number | null };
export type NextQuarterBasis = {
  quarter: string; months: string[]; latestPeriod: string;
  latestEps: number; latestRevenue: number; nextRevenue: number; ratio: number; estEps: number;
  pe: number | null; ps: number | null;
};

export function nextQuarterBasis(basis: BasisLite | null | undefined, rows: MonthRevenueRow[] | null | undefined): NextQuarterBasis | null {
  const q = (basis?.quarters || []).slice(-4);
  if (q.length < 4) return null;
  const latest = q[3];
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(latest.period || '');
  if (!m || !(Number(latest.revenue) > 0) || latest.reportedEps == null || !Number.isFinite(Number(latest.reportedEps))) return null;
  const map = new Map<string, number>();
  for (const r of rows || []) {
    const y = Number(r.revenue_year); const mo = Number(r.revenue_month); const v = Number(r.revenue);
    if (Number.isInteger(y) && mo >= 1 && mo <= 12 && Number.isFinite(v) && v > 0) map.set(`${y}-${String(mo).padStart(2, '0')}`, v);
  }
  let y = Number(m[1]); let mo = Number(m[2]);
  const months: string[] = [];
  for (let i = 0; i < 3; i++) { mo += 1; if (mo === 13) { mo = 1; y += 1; } months.push(`${y}-${String(mo).padStart(2, '0')}`); }
  if (!months.every((k) => map.has(k))) return null;
  const nextRevenue = months.reduce((s, k) => s + (map.get(k) as number), 0);
  const latestRevenue = Number(latest.revenue);
  const latestEps = Number(latest.reportedEps);
  const ratio = nextRevenue / latestRevenue;
  const estEps = latestEps * ratio;
  const prev3 = q.slice(1);
  const eps3 = prev3.every((l) => l.reportedEps != null) ? prev3.reduce((s, l) => s + Number(l.reportedEps), 0) : null;
  const rev3 = prev3.every((l) => l.revenue != null) ? prev3.reduce((s, l) => s + Number(l.revenue), 0) : null;
  const sum4 = Number(basis?.reportedEpsSum);
  const pe = basis?.eps != null && basis.eps > 0 && eps3 != null && Number.isFinite(sum4) && sum4 > 0 && eps3 + estEps > 0
    ? basis.eps * (eps3 + estEps) / sum4 : null;
  const ps = rev3 != null && basis?.psShares != null && basis.psShares > 0 ? (rev3 + nextRevenue) / basis.psShares : null;
  const quarter = `${y}Q${Math.ceil(mo / 3)}`;
  return { quarter, months, latestPeriod: latest.period, latestEps, latestRevenue, nextRevenue, ratio, estEps, pe, ps };
}
