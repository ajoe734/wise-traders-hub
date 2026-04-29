import { describe, it, expect, beforeEach } from 'vitest';
import { readAttribution } from '@/hooks/useAttributionTracking';

const KEY = 'lf_attr_v1';

describe('readAttribution (30-day first-touch lock)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing stored', () => {
    expect(readAttribution()).toBeNull();
  });

  it('returns payload when locked_until in future', () => {
    const payload = { utm_source: 'facebook_ads', locked_until: Date.now() + 1000 * 60 * 60 };
    localStorage.setItem(KEY, JSON.stringify(payload));
    expect(readAttribution()?.utm_source).toBe('facebook_ads');
  });

  it('clears and returns null when expired', () => {
    const payload = { utm_source: 'facebook_ads', locked_until: Date.now() - 1000 };
    localStorage.setItem(KEY, JSON.stringify(payload));
    expect(readAttribution()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    localStorage.setItem(KEY, 'not-json');
    expect(readAttribution()).toBeNull();
  });
});
