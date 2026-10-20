import { describe, expect, it } from 'vitest';
import { isPageView } from '@/lib/analytics/trafficQuality';

describe('evidence-only historical traffic recovery', () => {
  it('does not count unnamed unknown events as page views before recovery', () => {
    expect(isPageView({ event_name: null })).toBe(false);
  });
});