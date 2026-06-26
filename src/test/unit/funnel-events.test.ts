/**
 * 漏斗事件契約測試：
 *   - 後台 `/company/funnel` 對應的 traffic_events.event_name 必須維持精確字串
 *   - 對應 GTM mirror 名稱也必須維持精確字串
 *
 * 若改 `src/lib/analytics/events.ts` 或 GTM_MIRROR，這裡會立刻 fail，
 * 避免「埋點重命名 → 後台漏斗變 0%」的 silent breakage。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// trafficTracker 是 side-effect module — 用 mock 攔 trackEvent 的呼叫
const trackEventMock = vi.fn();
vi.mock('@/lib/trafficTracker', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
  initTrafficTracker: () => {},
  trackPageView: () => {},
}));

import { track } from '@/lib/analytics/events';

describe('funnel events → traffic_events.event_name 契約', () => {
  beforeEach(() => {
    trackEventMock.mockReset();
    (window as any).dataLayer = [];
  });

  const cases: Array<[Parameters<typeof track>[0], Record<string, unknown> | undefined]> = [
    ['pricing_view',           undefined],
    ['expert_subscribe_click', { expert_slug: 'alice', plan_id: 'p1' }],
    ['checkout_open',          { plan_id: 'p1', expert_slug: 'alice' }],
    ['checkout_submit',        { plan_id: 'p1', method: 'ecpay' }],
    ['checkout_success',       { plan_id: 'p1', amount: 599 }],
    ['checkout_failure',       { reason: 'declined', plan_id: 'p1' }],
    ['checkup_upgrade_click',  { from: 'paywall' }],
  ];

  it.each(cases)('track(%s) 應送出同名 traffic event', (name, props) => {
    track(name as any, props as any);
    expect(trackEventMock).toHaveBeenCalledWith(name, props);
  });

  it('pricing_view 應 mirror 為 GTM `ViewPricing`', () => {
    track('pricing_view');
    expect((window as any).dataLayer[0]).toMatchObject({ event: 'ViewPricing' });
  });

  it('checkup_upgrade_click 應 mirror 為 GTM `UpgradeClick` 並帶 from', () => {
    track('checkup_upgrade_click', { from: 'paywall' });
    expect((window as any).dataLayer[0]).toMatchObject({ event: 'UpgradeClick', from: 'paywall' });
  });

  it('expert_subscribe_click 應 mirror 為 GTM `SubscribeExpertClick`', () => {
    track('expert_subscribe_click', { expert_slug: 'alice', plan_id: 'p1' });
    expect((window as any).dataLayer[0]).toMatchObject({
      event: 'SubscribeExpertClick', expert_slug: 'alice', plan_id: 'p1',
    });
  });

  // ⚠️ checkout_open / checkout_success 目前沒進 GTM_MIRROR（後台 funnel 是直接讀 traffic_events）。
  // 若未來加 GTM mirror，請補對應 assert；移除 mirror 也會讓本測試需更新。
  it('checkout_open 目前不 mirror 到 GTM dataLayer', () => {
    track('checkout_open', { plan_id: 'p1' });
    expect((window as any).dataLayer).toHaveLength(0);
  });
});
