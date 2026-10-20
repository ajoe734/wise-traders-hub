import { describe, expect, it } from 'vitest';
import {
  classifyVisitors, sessionize, pageStats, sourceQuality, reconcile, identityMap,
  type VisitRow, type EventRow,
} from '@/lib/analytics/trafficQuality';

const t = (s: string) => `2026-10-19T${s}Z`;
const visit = (p: Partial<VisitRow> & { visitor_id: string }): VisitRow => ({
  user_id: null, first_landing_path: '/', first_referrer_host: null, utm_campaign: null, utm_content: null,
  channel: 'direct', first_seen_at: t('01:00:00'), ...p,
});
const ev = (p: Partial<EventRow> & { visitor_id: string }): EventRow => ({
  user_id: null, route: '/', event_name: 'page_view', occurred_at: t('01:00:00'), is_internal: false, ...p,
});

describe('classifyVisitors', () => {
  it('flags /e2e and /__ landings as test', () => {
    const r = classifyVisitors([visit({ visitor_id: 'a', first_landing_path: '/e2e/x' }), visit({ visitor_id: 'b', first_landing_path: '/__harness' })], [], new Set());
    expect(r.get('a')?.tier).toBe('test');
    expect(r.get('b')?.tier).toBe('test');
  });
  it('flags 4 anonymous direct visitors in 3 seconds with no actions as bot', () => {
    const vs = ['a', 'b', 'c', 'd'].map((id, i) => visit({ visitor_id: id, first_seen_at: t(`01:00:0${i}`) }));
    const r = classifyVisitors(vs, [], new Set());
    expect([...r.values()].every(x => x.tier === 'bot')).toBe(true);
  });
  it('a burst from Facebook referrer stays human (real post clicks)', () => {
    const vs = ['a', 'b', 'c', 'd'].map((id, i) => visit({ visitor_id: id, first_referrer_host: 'm.facebook.com', channel: 'social', first_seen_at: t(`01:00:0${i}`) }));
    const r = classifyVisitors(vs, [], new Set());
    expect([...r.values()].every(x => x.tier === 'human')).toBe(true);
  });
  it('flags admin/expert accounts as staff via visit or event user_id', () => {
    const r = classifyVisitors([visit({ visitor_id: 'a' })], [ev({ visitor_id: 'a', user_id: 'u-admin' })], new Set(['u-admin']));
    expect(r.get('a')?.tier).toBe('staff');
  });
});

describe('identityMap', () => {
  it('merges visitor ids used by the same member into one identity', () => {
    const m = identityMap([visit({ visitor_id: 'phone' }), visit({ visitor_id: 'pc', user_id: 'u1' })], [ev({ visitor_id: 'phone', user_id: 'u1' })]);
    expect(m.get('phone')).toBe('u:u1');
    expect(m.get('pc')).toBe('u:u1');
  });
});

describe('sessionize', () => {
  it('splits after 30 minutes idle and measures pages and duration', () => {
    const s = sessionize([
      ev({ visitor_id: 'a', occurred_at: t('01:00:00') }),
      ev({ visitor_id: 'a', occurred_at: t('01:05:00'), route: '/x' }),
      ev({ visitor_id: 'a', occurred_at: t('01:40:00') }),
    ]);
    expect(s).toHaveLength(2);
    expect(s[0].pages).toBe(2);
    expect(s[0].durationMs).toBe(5 * 60 * 1000);
    expect(s[1].pages).toBe(1);
  });
});

describe('pageStats', () => {
  it('counts page-view visitors separately from any-event visitors', () => {
    const rows = pageStats([
      ev({ visitor_id: 'a', route: '/expert/sharkgu' }),
      ev({ visitor_id: 'b', route: '/expert/sharkgu', event_name: 'expert_profile_view' }),
      ev({ visitor_id: 'a', route: '/expert/sharkgu', user_id: 'u1' }),
    ], new Map([['a', 'u:u1'], ['b', 'v:b']]));
    const r = rows.find(x => x.path === '/expert/sharkgu')!;
    expect(r.pageViews).toBe(2);
    expect(r.viewers).toBe(1);
    expect(r.anyEventVisitors).toBe(2);
    expect(r.loggedInViewers).toBe(1);
  });
});

describe('sourceQuality', () => {
  it('engaged = viewed 2+ pages or took a key action', () => {
    const q = sourceQuality(
      [visit({ visitor_id: 'a', utm_campaign: 'mia' }), visit({ visitor_id: 'b', utm_campaign: 'mia' }), visit({ visitor_id: 'c', utm_campaign: 'mia' })],
      [ev({ visitor_id: 'a' }), ev({ visitor_id: 'a', route: '/x' }), ev({ visitor_id: 'b', event_name: 'expert_subscribe_click' }), ev({ visitor_id: 'c' })],
    );
    const mia = q.find(x => x.source === 'mia')!;
    expect(mia.visitors).toBe(3);
    expect(mia.engaged).toBe(2);
    expect(mia.bounced).toBe(1);
  });
});

describe('reconcile', () => {
  it('alerts when page-view visitors fall more than 20% below any-event visitors', () => {
    const r = reconcile([{ path: '/expert/sharkgu', pageViews: 10, viewers: 10, anyEventVisitors: 74, loggedInViewers: 0 }], 74, 10);
    expect(r.alerts.some(a => a.includes('/expert/sharkgu'))).toBe(true);
    expect(r.alerts.some(a => a.includes('進站'))).toBe(true);
  });
  it('no alert when numbers agree', () => {
    const r = reconcile([{ path: '/', pageViews: 10, viewers: 10, anyEventVisitors: 11, loggedInViewers: 0 }], 11, 10);
    expect(r.alerts).toHaveLength(0);
  });
});
