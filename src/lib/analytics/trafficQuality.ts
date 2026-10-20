/**
 * 流量品質唯一計算處（純函式）。看板的熱門頁面、可疑流量分級、工作階段、
 * 來源品質與每日對帳都從這裡算，避免各圖各算一套口徑。
 */
export interface VisitRow {
  visitor_id: string;
  user_id: string | null;
  first_landing_path: string | null;
  first_referrer_host: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  channel: string | null;
  first_seen_at: string;
}
export interface EventRow {
  visitor_id: string;
  user_id: string | null;
  route: string;
  event_name: string | null;
  occurred_at: string;
  is_internal: boolean;
}
export type Tier = 'human' | 'bot' | 'test' | 'staff';
export interface Classification { tier: Tier; reason: string }

export const SESSION_GAP_MS = 30 * 60 * 1000;
export const RECONCILE_TOLERANCE = 0.2;
export const RECONCILE_MIN_SAMPLE = 10;
/** 視為「有後續行動」的事件（點方案、訂閱、註冊、結帳）。 */
export const KEY_ACTIONS = new Set([
  'expert_subscribe_click', 'checkout_open', 'checkout_submit', 'checkout_success',
  'auth_signup_submit', 'auth_signup_success', 'auth_login_success', 'checkup_upgrade_click', 'pricing_view',
]);

export const isPageView = (e: Pick<EventRow, 'event_name'>) => e.event_name === 'page_view';
const ms = (s: string) => new Date(s).getTime();

/** 同一位會員用過的所有訪客編號歸成同一身分（u:<user>），其餘為 v:<visitor>。 */
export function identityMap(visits: VisitRow[], events: EventRow[]): Map<string, string> {
  const user = new Map<string, Set<string>>();
  for (const r of [...visits, ...events]) if (r.user_id) {
    const linked = user.get(r.visitor_id) ?? new Set<string>();
    linked.add(r.user_id); user.set(r.visitor_id, linked);
  }
  const out = new Map<string, string>();
  for (const r of [...visits, ...events]) {
    const linked = user.get(r.visitor_id);
    const u = linked?.size === 1 ? [...linked][0] : undefined;
    out.set(r.visitor_id, u ? `u:${u}` : `v:${r.visitor_id}`);
  }
  return out;
}

/** 分級不刪資料：測試頁 → test；管理員／老師 → staff；無來源、未登入、無任何動作且成群湧入 → bot。 */
export function classifyVisitors(visits: VisitRow[], events: EventRow[], staffUserIds: Set<string>): Map<string, Classification> {
  const evBy = new Map<string, EventRow[]>();
  for (const e of events) (evBy.get(e.visitor_id) ?? evBy.set(e.visitor_id, []).get(e.visitor_id)!).push(e);
  const users = identityMap(visits, events);
  const suspect = visits.filter(v => !v.user_id && !users.get(v.visitor_id)?.startsWith('u:')
    && !v.first_referrer_host && !v.utm_campaign && (v.channel ?? 'direct') === 'direct'
    && (evBy.get(v.visitor_id) ?? []).filter(isPageView).length <= 1
    && !(evBy.get(v.visitor_id) ?? []).some(e => e.event_name && KEY_ACTIONS.has(e.event_name)));
  const times = suspect.map(v => ms(v.first_seen_at)).sort((a, b) => a - b);
  const countWithin = (t: number, w: number) => times.filter(x => Math.abs(x - t) <= w).length;

  const out = new Map<string, Classification>();
  const suspectIds = new Set(suspect.map(v => v.visitor_id));
  for (const v of visits) {
    const path = v.first_landing_path ?? '';
    const uid = users.get(v.visitor_id);
    if (path.startsWith('/e2e') || path.includes('/__')) { out.set(v.visitor_id, { tier: 'test', reason: '落在測試專用頁' }); continue; }
    if (uid?.startsWith('u:') && staffUserIds.has(uid.slice(2))) { out.set(v.visitor_id, { tier: 'staff', reason: '管理員或老師本人' }); continue; }
    if (suspectIds.has(v.visitor_id)) {
      const t = ms(v.first_seen_at);
      if (countWithin(t, 1500) >= 4) { out.set(v.visitor_id, { tier: 'bot', reason: '3 秒內 4 位以上無來源訪客同時湧入' }); continue; }
      if (countWithin(t, 30000) >= 3) { out.set(v.visitor_id, { tier: 'bot', reason: '60 秒內 3 位以上無來源訪客' }); continue; }
    }
    out.set(v.visitor_id, { tier: 'human', reason: '' });
  }
  return out;
}

export interface Session { visitor_id: string; start: number; end: number; pages: number; durationMs: number }
export function sessionize(events: EventRow[], gapMs = SESSION_GAP_MS): Session[] {
  const by = new Map<string, number[]>();
  for (const e of events) if (isPageView(e)) (by.get(e.visitor_id) ?? by.set(e.visitor_id, []).get(e.visitor_id)!).push(ms(e.occurred_at));
  const out: Session[] = [];
  for (const [vid, ts] of by) {
    ts.sort((a, b) => a - b);
    let cur: Session | null = null;
    for (const t of ts) {
      if (!cur || t - cur.end > gapMs) { cur = { visitor_id: vid, start: t, end: t, pages: 0, durationMs: 0 }; out.push(cur); }
      cur.end = t; cur.pages += 1; cur.durationMs = cur.end - cur.start;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface PageStat { path: string; pageViews: number; viewers: number; anyEventVisitors: number; loggedInViewers: number }
export function pageStats(events: EventRow[], ids: Map<string, string>): PageStat[] {
  const m = new Map<string, { pv: number; viewers: Set<string>; any: Set<string>; logged: Set<string> }>();
  for (const e of events) {
    const s = m.get(e.route) ?? m.set(e.route, { pv: 0, viewers: new Set(), any: new Set(), logged: new Set() }).get(e.route)!;
    const id = ids.get(e.visitor_id) ?? `v:${e.visitor_id}`;
    s.any.add(id);
    if (isPageView(e)) {
      s.pv += 1; s.viewers.add(id);
      if (e.user_id) s.logged.add(`u:${e.user_id}`);
    }
  }
  return [...m].map(([path, s]) => ({ path, pageViews: s.pv, viewers: s.viewers.size, anyEventVisitors: s.any.size, loggedInViewers: s.logged.size }))
    .sort((a, b) => b.viewers - a.viewers || b.anyEventVisitors - a.anyEventVisitors);
}

export interface PageDay { day: string; pageViews: number; viewers: number; loggedIn: number }
const taipeiDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
/** 單一路徑每日（台北日）具名看頁；口徑與 pageStats 相同，期間 totals 為去重人數。 */
export function pageDailyTrend(events: EventRow[], ids: Map<string, string>, path: string, from: Date, to: Date): { days: PageDay[]; totals: Omit<PageDay, 'day'> } {
  const keys: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 86400000) { const d = taipeiDay(t); if (keys[keys.length - 1] !== d) keys.push(d); }
  const last = taipeiDay(to.getTime() - 1); if (to > from && keys[keys.length - 1] !== last) keys.push(last);
  const m = new Map(keys.map(k => [k, { pv: 0, v: new Set<string>(), u: new Set<string>() }]));
  const tv = new Set<string>(), tu = new Set<string>(); let tpv = 0;
  for (const e of events) {
    if (e.route !== path || !isPageView(e)) continue;
    const ms = new Date(e.occurred_at).getTime();
    if (ms < from.getTime() || ms >= to.getTime()) continue;
    const s = m.get(taipeiDay(ms)); if (!s) continue;
    const id = ids.get(e.visitor_id) ?? `v:${e.visitor_id}`;
    s.pv += 1; s.v.add(id); tpv += 1; tv.add(id);
    if (e.user_id) { s.u.add(e.user_id); tu.add(e.user_id); }
  }
  return {
    days: keys.map(day => { const s = m.get(day)!; return { day, pageViews: s.pv, viewers: s.v.size, loggedIn: s.u.size }; }),
    totals: { pageViews: tpv, viewers: tv.size, loggedIn: tu.size },
  };
}

export function sourceOf(v: VisitRow): string {
  if (v.utm_campaign) return v.utm_campaign;
  const h = v.first_referrer_host ?? '';
  if (/instagram/.test(h)) return 'Instagram';
  if (/facebook|fb\./.test(h)) return 'Facebook';
  if (/youtube|youtu\.be/.test(h)) return 'YouTube';
  if (/line\.me|line\.naver/.test(h)) return 'LINE';
  if (/google/.test(h)) return 'Google';
  return h || '直接進站';
}

export interface SourceQualityRow { source: string; visitors: number; engaged: number; bounced: number; noPageView: number }
export function sourceQuality(visits: VisitRow[], events: EventRow[]): SourceQualityRow[] {
  const evBy = new Map<string, EventRow[]>();
  for (const e of events) (evBy.get(e.visitor_id) ?? evBy.set(e.visitor_id, []).get(e.visitor_id)!).push(e);
  const m = new Map<string, SourceQualityRow>();
  for (const v of visits) {
    const s = sourceOf(v);
    const r = m.get(s) ?? m.set(s, { source: s, visitors: 0, engaged: 0, bounced: 0, noPageView: 0 }).get(s)!;
    const evs = evBy.get(v.visitor_id) ?? [];
    const pv = evs.filter(isPageView).length;
    r.visitors += 1;
    if (pv >= 2 || evs.some(e => e.event_name && KEY_ACTIONS.has(e.event_name))) r.engaged += 1; else r.bounced += 1;
    if (pv === 0) r.noPageView += 1;
  }
  return [...m.values()].sort((a, b) => b.visitors - a.visitors);
}

export function reconcile(pages: PageStat[], landedVisitors: number, pageViewVisitors: number): { alerts: string[] } {
  const alerts: string[] = [];
  const gap = (a: number, b: number) => b >= RECONCILE_MIN_SAMPLE && a < b * (1 - RECONCILE_TOLERANCE);
  if (gap(pageViewVisitors, landedVisitors)) alerts.push(`進站 ${landedVisitors} 位，只有 ${pageViewVisitors} 位留下看頁紀錄`);
  for (const p of pages) if (gap(p.viewers, p.anyEventVisitors)) alerts.push(`${p.path}：有動作 ${p.anyEventVisitors} 位，看頁紀錄只有 ${p.viewers} 位`);
  return { alerts };
}
