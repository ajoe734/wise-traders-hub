import { describe, it, expect } from 'vitest';
import { normalizePath, reconcileGa4 } from '@/lib/analytics/ga4Reconcile';
import type { EventRow } from '@/lib/analytics/trafficQuality';

const ev = (route: string, iso: string, vid = 'a', name: string | null = 'page_view'): EventRow =>
  ({ visitor_id: vid, user_id: null, route, event_name: name, occurred_at: iso, is_internal: false } as EventRow);
const from = new Date('2026-10-19T16:00:00Z'); // 台北 10/20 00:00
const to = new Date('2026-10-21T16:00:00Z');   // 台北 10/22 00:00

describe('ga4Reconcile', () => {
  it('路徑正規化：去查詢字串與結尾斜線，根目錄保留', () => {
    expect(normalizePath('/expert/sharkgu/?utm=1')).toBe('/expert/sharkgu');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });

  it('每日以台北日對齊、只算具名看頁，差距超過 20% 且量 ≥10 才標記', () => {
    const events = [
      ...Array.from({ length: 10 }, (_, i) => ev('/', '2026-10-19T16:30:00Z', `v${i}`)), // 台北 10/20
      ev('/', '2026-10-20T15:59:00Z', 'x', 'click'),
      ...Array.from({ length: 10 }, (_, i) => ev('/', '2026-10-20T16:30:00Z', `w${i}`)), // 台北 10/21
    ];
    const r = reconcileGa4({ daily: [{ day: '2026-10-20', users: 10, sessions: 10, pageViews: 11 }, { day: '2026-10-21', users: 20, sessions: 20, pageViews: 20 }], topPages: [] }, events, new Map(), from, to);
    expect(r.daily.map(d => [d.day, d.site, d.ga4, d.flagged])).toEqual([['2026-10-20', 10, 11, false], ['2026-10-21', 10, 20, true]]);
  });

  it('樣本太小不標記', () => {
    const r = reconcileGa4({ daily: [{ day: '2026-10-20', users: 1, sessions: 1, pageViews: 3 }], topPages: [] }, [ev('/', '2026-10-19T17:00:00Z')], new Map(), from, to);
    expect(r.daily[0].flagged).toBe(false);
  });

  it('熱門頁面以正規化路徑合併；僅一方前 15 時標為無法比較而非差距', () => {
    const events = Array.from({ length: 12 }, (_, i) => ev('/holding-checkup', '2026-10-20T03:00:00Z', `v${i}`));
    const r = reconcileGa4({ daily: [], topPages: [{ path: '/holding-checkup/', pageViews: 30, users: 25 }, { path: '/only-ga', pageViews: 50, users: 40 }] }, events, new Map(), from, to);
    const hc = r.pages.find(p => p.path === '/holding-checkup')!;
    expect([hc.sitePageViews, hc.ga4PageViews, hc.flagged]).toEqual([12, 30, true]);
    const og = r.pages.find(p => p.path === '/only-ga')!;
    expect([og.sitePageViews, og.comparable, og.flagged]).toEqual([0, true, true]);
  });

  it('本站有、GA4 前 15 外的頁面不算差距', () => {
    const events = Array.from({ length: 20 }, (_, i) => ev('/rare', '2026-10-20T03:00:00Z', `v${i}`));
    const top = Array.from({ length: 15 }, (_, i) => ({ path: `/g${i}`, pageViews: 100, users: 90 }));
    const r = reconcileGa4({ daily: [], topPages: top }, events, new Map(), from, to);
    const rare = r.pages.find(p => p.path === '/rare')!;
    expect([rare.comparable, rare.flagged]).toEqual([false, false]);
  });
});

describe('ga4Reconcile 路徑口徑對齊本站收集', () => {
  it('UUID 與 4 位以上數字段改為 :id（與本站收集規則相同）', () => {
    expect(normalizePath('/app/journal/2f1c9a3e-1b2c-4d5e-8f90-123456789abc')).toBe('/app/journal/:id');
    expect(normalizePath('/checkout/sharkgu/12345')).toBe('/checkout/sharkgu/:id');
    expect(normalizePath('/app/journal/123')).toBe('/app/journal/123');
  });
  it('後台頁不列入（本站不收集後台）', () => {
    const r = reconcileGa4({ daily: [], topPages: [{ path: '/company/traffic', pageViews: 40, users: 2 }] }, [], new Map(), from, to);
    expect(r.pages).toEqual([]);
  });
  it('GA4 已滿 15 筆時，範本路徑只含部分網址，不判定差距', () => {
    const top = [{ path: '/app/journal/11111', pageViews: 100, users: 9 }, ...Array.from({ length: 14 }, (_, i) => ({ path: `/g${i}`, pageViews: 100, users: 90 }))];
    const events = Array.from({ length: 300 }, (_, i) => ev('/app/journal/:id', '2026-10-20T03:00:00Z', `v${i}`));
    const j = reconcileGa4({ daily: [], topPages: top }, events, new Map(), from, to).pages.find(p => p.path === '/app/journal/:id')!;
    expect([j.ga4PageViews, j.comparable, j.flagged]).toEqual([100, false, false]);
  });
});
