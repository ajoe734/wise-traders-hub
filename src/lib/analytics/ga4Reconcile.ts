import { isPageView, RECONCILE_MIN_SAMPLE, RECONCILE_TOLERANCE, type EventRow } from '@/lib/analytics/trafficQuality';

/** GA4 vs 本站自有紀錄對帳。只比對「看頁次數」口徑相同的數字；人數定義不同，只並列不標記。 */
export interface Ga4Input {
  daily: Array<{ day: string; users: number; sessions: number; pageViews: number }>;
  topPages: Array<{ path: string; pageViews: number; users: number }>;
}
export interface DailyGap { day: string; site: number; ga4: number; diff: number; pct: number | null; flagged: boolean }
export interface PageGap {
  path: string; sitePageViews: number; siteViewers: number; ga4PageViews: number | null; ga4Users: number | null;
  inSiteTop: boolean; inGa4Top: boolean; comparable: boolean; diff: number | null; pct: number | null; flagged: boolean;
}

export function normalizePath(p: string): string {
  const s = (p || '/').split(/[?#]/)[0] || '/';
  return s.length > 1 ? s.replace(/\/+$/, '') || '/' : '/';
}
const taipeiDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

function gap(site: number, ga4: number) {
  const diff = ga4 - site;
  const base = Math.max(site, ga4);
  const pct = base ? diff / base : null;
  return { diff, pct, flagged: base >= RECONCILE_MIN_SAMPLE && Math.abs(diff) / base > RECONCILE_TOLERANCE };
}

export function reconcileGa4(ga4: Ga4Input, events: EventRow[], ids: Map<string, string>, from: Date, to: Date, top = 15) {
  const perDay = new Map<string, number>();
  const perPage = new Map<string, { pv: number; v: Set<string> }>();
  for (const e of events) {
    if (!isPageView(e)) continue;
    const ms = new Date(e.occurred_at).getTime();
    if (ms < from.getTime() || ms >= to.getTime()) continue;
    const d = taipeiDay(ms);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
    const p = normalizePath(e.route);
    const s = perPage.get(p) ?? perPage.set(p, { pv: 0, v: new Set() }).get(p)!;
    s.pv += 1; s.v.add(ids.get(e.visitor_id) ?? `v:${e.visitor_id}`);
  }

  const days = new Set<string>(ga4.daily.map(d => d.day));
  perDay.forEach((_, d) => days.add(d));
  const gaDay = new Map(ga4.daily.map(d => [d.day, d.pageViews]));
  const daily: DailyGap[] = [...days].sort().map(day => {
    const site = perDay.get(day) ?? 0, g = gaDay.get(day) ?? 0;
    return { day, site, ga4: g, ...gap(site, g) };
  });

  const gaPages = new Map<string, { pv: number; u: number }>();
  for (const p of ga4.topPages) {
    const k = normalizePath(p.path);
    const s = gaPages.get(k) ?? { pv: 0, u: 0 };
    gaPages.set(k, { pv: s.pv + p.pageViews, u: s.u + p.users });
  }
  const gaFull = ga4.topPages.length < top; // GA 回傳不足 15 筆＝期間所有頁面都在清單內
  const siteTop = [...perPage].sort((a, b) => b[1].pv - a[1].pv).slice(0, top).map(([k]) => k);
  const paths = new Set<string>([...gaPages.keys(), ...siteTop]);
  const pages: PageGap[] = [...paths].map(path => {
    const s = perPage.get(path), g = gaPages.get(path);
    const sitePv = s?.pv ?? 0;
    const comparable = !!g || gaFull;
    const ga4Pv = g ? g.pv : gaFull ? 0 : null;
    const r = comparable ? gap(sitePv, ga4Pv ?? 0) : { diff: null, pct: null, flagged: false };
    return {
      path, sitePageViews: sitePv, siteViewers: s?.v.size ?? 0, ga4PageViews: ga4Pv, ga4Users: g ? g.u : gaFull ? 0 : null,
      inSiteTop: siteTop.includes(path), inGa4Top: !!g, comparable, ...r,
    };
  }).sort((a, b) => Math.max(b.sitePageViews, b.ga4PageViews ?? 0) - Math.max(a.sitePageViews, a.ga4PageViews ?? 0));

  return {
    daily, pages,
    totals: { site: daily.reduce((a, d) => a + d.site, 0), ga4: daily.reduce((a, d) => a + d.ga4, 0) },
  };
}
