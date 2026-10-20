import { describe, expect, it } from 'vitest';
import { isPageView, pageStats, identityMap } from '@/lib/analytics/trafficQuality';
import { recoverLegacyPage, recoverVisitorIdentity, reconcileDaily, reconcilePageCounts } from '@/lib/analytics/trafficRecovery';

describe('evidence-only historical traffic recovery', () => {
  it('compares aggregate-only snapshots without synthetic events or hidden duplicates', () => {
    const a = [{ day: '2026-10-19', path: '/all-pages', page_views: 681407 }];
    expect(reconcilePageCounts(a, a)).toEqual([]);
    expect(reconcilePageCounts(a, [{ ...a[0], page_views: 681406 }])).toHaveLength(1);
    expect(reconcilePageCounts(a, [a[0], a[0]])).toHaveLength(1);
    expect(reconcilePageCounts([{ ...a[0], page_views: -1 }], [])).not.toEqual([]);
  });
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
  it.each([
    { event_name: 'checkout_open', event_props: null, occurred_at: '2026-08-01T00:00:00Z' },
    { event_name: null, event_props: { unknown: true }, occurred_at: '2026-08-01T00:00:00Z' },
    { event_name: null, event_props: null, occurred_at: '2026-08-30T10:00:00Z' },
    { event_name: '', event_props: null, occurred_at: '2026-08-01T00:00:00Z' },
    { event_name: null, event_props: null, occurred_at: 'invalid' },
  ])('leaves non-evidence events unchanged: %j', row => {
    const event = { id: 'original', ...row };
    expect(recoverLegacyPage(event)).toBe(event);
  });
  it('never uses future evidence, conflicting members or an unrelated visitor', () => {
    expect(recoverVisitorIdentity('a', null, [{ visitor_id: 'a', user_id: 'future', occurred_at: '2026-10-20T00:00:00Z' }])).toBeNull();
    expect(recoverVisitorIdentity('a', null, ['u1', 'u2'].map(user_id => ({ visitor_id: 'a', user_id, occurred_at: '2026-10-01T00:00:00Z' })))).toBeNull();
    expect(recoverVisitorIdentity('a', null, [{ visitor_id: 'b', user_id: 'other', occurred_at: '2026-10-01T00:00:00Z' }])).toBeNull();
    expect(recoverVisitorIdentity('a', 'existing', [])).toBe('existing');
  });
  it('fails reconciliation for a missing date/path and an extra reported path', () => {
    const events = [{ visitor_id: 'a', user_id: null, route: '/not-top-15', event_name: 'page_view', occurred_at: '2026-10-19T15:59:59Z', is_internal: false }];
    expect(reconcileDaily(events, [{ day: '2026-10-20', path: '/extra', page_views: 1 }])).toHaveLength(2);
    expect(reconcileDaily([], [])).toEqual([]);
  });
  it('rejects duplicate report buckets and invalid counts rather than hiding them', () => {
    const bucket = { day: '2026-10-20', path: '/', page_views: 0 };
    expect(reconcileDaily([], [bucket, bucket])).toContain('2026-10-20|/: duplicate reported bucket');
    expect(reconcileDaily([], [{ ...bucket, page_views: -1 }])).toContain('2026-10-20|/: invalid reported count');
  });
  it('compares the actual instant, not lexical timezone formatting', () => {
    const row = { id: 'tz', event_name: null, event_props: null, occurred_at: '2026-08-30T17:59:59+08:00' };
    expect(recoverLegacyPage(row).event_name).toBe('page_view');
    expect(recoverLegacyPage({ ...row, occurred_at: '2026-08-30T18:00:00+08:00' }).event_name).toBeNull();
  });
});