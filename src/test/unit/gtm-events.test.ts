import { describe, it, expect, beforeEach } from 'vitest';
import { gtmPush } from '@/lib/analytics/gtm';
import { pathToFeature } from '@/components/PerfMetricsTracker';

declare global {
  // eslint-disable-next-line no-var
  var dataLayer: Array<Record<string, unknown>> | undefined;
}

describe('gtmPush', () => {
  beforeEach(() => {
    (window as any).dataLayer = [];
  });

  it('initializes dataLayer if missing', () => {
    delete (window as any).dataLayer;
    gtmPush('Login', { method: 'email' });
    expect((window as any).dataLayer).toHaveLength(1);
  });

  it('pushes event with params', () => {
    gtmPush('Purchase', { value: 990, currency: 'TWD', plan_id: 'p1' });
    expect((window as any).dataLayer[0]).toEqual({
      event: 'Purchase',
      value: 990,
      currency: 'TWD',
      plan_id: 'p1',
    });
  });

  it('supports all 13 documented events', () => {
    const events = [
      'Login', 'SignUp', 'Function', 'ViewExpert', 'ViewPricing',
      'BeginCheckout', 'Purchase', 'SubscribeExpertClick',
      'LineBindStart', 'LineBindSuccess', 'CheckupAnalysisRun',
      'QuotaBlocked', 'UpgradeClick',
    ] as const;
    events.forEach((e) => gtmPush(e));
    expect((window as any).dataLayer).toHaveLength(events.length);
  });

  it('does not throw if push fails', () => {
    (window as any).dataLayer = { push: () => { throw new Error('boom'); } };
    expect(() => gtmPush('Login')).not.toThrow();
  });
});
