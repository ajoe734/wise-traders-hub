import { describe, it, expect } from 'vitest';
import { pageDailyTrend, type EventRow } from '@/lib/analytics/trafficQuality';

const ev = (visitor_id: string, occurred_at: string, route = '/expert/master-brcto', event_name: string | null = 'page_view', user_id: string | null = null): EventRow =>
  ({ visitor_id, user_id, route, event_name, occurred_at, is_internal: false });

// 台北 2026/10/01 00:00 ～ 10/04 00:00（UTC 9/30 16:00 ～ 10/3 16:00）
const FROM = new Date('2026-09-30T16:00:00Z');
const TO = new Date('2026-10-03T16:00:00Z');

describe('pageDailyTrend', () => {
  it('每個台北日都有一列，沒資料補 0', () => {
    const r = pageDailyTrend([ev('a', '2026-10-01T02:00:00Z')], new Map(), '/expert/master-brcto', FROM, TO);
    expect(r.days.map(d => d.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(r.days.map(d => d.pageViews)).toEqual([1, 0, 0]);
  });

  it('UTC 15:59 與 16:00 分屬不同台北日', () => {
    const r = pageDailyTrend([ev('a', '2026-10-01T15:59:00Z'), ev('b', '2026-10-01T16:00:00Z')], new Map(), '/expert/master-brcto', FROM, TO);
    expect(r.days.map(d => d.viewers)).toEqual([1, 1, 0]);
  });

  it('只算該路徑的具名看頁；登入訪客依 user_id', () => {
    const r = pageDailyTrend([
      ev('a', '2026-10-02T01:00:00Z', '/expert/master-brcto', 'page_view', 'u1'),
      ev('a', '2026-10-02T02:00:00Z', '/expert/master-brcto', 'page_view', 'u1'),
      ev('b', '2026-10-02T03:00:00Z', '/expert/master-brcto', 'cta_click'),
      ev('c', '2026-10-02T03:00:00Z', '/pricing'),
    ], new Map(), '/expert/master-brcto', FROM, TO);
    expect(r.days[1]).toEqual({ day: '2026-10-02', pageViews: 2, viewers: 1, loggedIn: 1 });
  });

  it('期間人數去重，不是每日相加；跨裝置同人合併', () => {
    const ids = new Map([['a', 'u:1'], ['b', 'u:1']]);
    const r = pageDailyTrend([ev('a', '2026-10-01T01:00:00Z'), ev('b', '2026-10-02T01:00:00Z'), ev('c', '2026-10-02T01:00:00Z')], ids, '/expert/master-brcto', FROM, TO);
    expect(r.days.map(d => d.viewers)).toEqual([1, 2, 0]);
    expect(r.totals).toEqual({ pageViews: 3, viewers: 2, loggedIn: 0 });
  });

  it('空資料全部為 0', () => {
    const r = pageDailyTrend([], new Map(), '/x', FROM, TO);
    expect(r.days).toHaveLength(3);
    expect(r.totals).toEqual({ pageViews: 0, viewers: 0, loggedIn: 0 });
  });
});
