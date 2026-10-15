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
