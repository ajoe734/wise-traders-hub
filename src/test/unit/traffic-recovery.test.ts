import { describe, expect, it } from 'vitest';
import { isPageView } from '@/lib/analytics/trafficQuality';
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
});