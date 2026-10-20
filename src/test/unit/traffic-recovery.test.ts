import { describe, expect, it } from 'vitest';
import { isPageView, pageStats, identityMap } from '@/lib/analytics/trafficQuality';
import { recoverLegacyPage, recoverVisitorIdentity, reconcileDaily } from '@/lib/analytics/trafficRecovery';

describe('evidence-only historical traffic recovery', () => {
  it('does not count unnamed unknown events as page views before recovery', () => {
    expect(isPageView({ event_name: null })).toBe(false);
  });
  it('restores a surviving original legacy page without adding an event', () => {
    const old = { id: 'original', event_name: null, event_props: null, occurred_at: '2026-08-01T00:00:00Z' };
    const restored = recoverLegacyPage(old);
    expect(restored).toMatchObject({ id: 'original', event_name: 'page_view', occurred_at: old.occurred_at });
    expect(recoverLegacyPage(restored)).toEqual(restored);
  });
  it('links a visitor only to one evidenced member without claiming event-time login', () => {
    expect(recoverVisitorIdentity('v1', null, [
      { visitor_id: 'v1', user_id: 'member', occurred_at: '2026-10-01T00:00:00Z' },
    ])).toBe('member');
  });
  it('reconciles every Taipei date and route, excluding internal and unnamed rows', () => {
    const events = [
      { visitor_id: 'a', user_id: null, route: '/', event_name: 'page_view', occurred_at: '2026-10-19T16:00:00Z', is_internal: false },
      { visitor_id: 'b', user_id: null, route: '/', event_name: null, occurred_at: '2026-10-19T16:00:01Z', is_internal: false },
      { visitor_id: 'c', user_id: null, route: '/company', event_name: 'page_view', occurred_at: '2026-10-19T16:00:02Z', is_internal: true },
    ];
    expect(reconcileDaily(events, [{ day: '2026-10-20', path: '/', page_views: 1 }])).toEqual([]);
    expect(reconcileDaily(events, [{ day: '2026-10-20', path: '/', page_views: 2 }])).toHaveLength(1);
  });
  it('does not call historical anonymous page views logged-in after linking a visitor', () => {
    const rows = [{ visitor_id: 'a', user_id: null, route: '/', event_name: 'page_view', occurred_at: '2026-10-01T00:00:00Z', is_internal: false }];
    expect(pageStats(rows, new Map([['a', 'u:member']]))[0].loggedInViewers).toBe(0);
  });
  it('does not merge shared visitor IDs into an arbitrary member', () => {
    const rows = ['member1', 'member2'].map(user_id => ({ visitor_id: 'a', user_id, route: '/', event_name: 'page_view', occurred_at: '2026-10-01T00:00:00Z', is_internal: false }));
    expect(identityMap([], rows).get('a')).toBe('v:a');
  });
});