import { afterEach, describe, expect, it } from 'vitest';
import { isAutomatedOrLocal } from '@/lib/trafficTracker';

describe('traffic tracker excludes automated/local traffic', () => {
  afterEach(() => { Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true }); });
  it('skips webdriver browsers', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    expect(isAutomatedOrLocal()).toBe(true);
  });
  it('skips localhost sandbox', () => {
    expect(window.location.hostname).toBe('localhost');
    expect(isAutomatedOrLocal()).toBe(true);
  });
});
