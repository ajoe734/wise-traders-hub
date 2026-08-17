import { describe, it, expect } from 'vitest';
import { buildIdentityIndex, computeFunnel, resolveActor, type StageEvent } from '@/lib/analytics/funnel';

const t = (s: string) => `2026-08-16T${s}Z`;

describe('funnel identity attribution', () => {
  it('匿名 visitor 登入後併入同一身分', () => {
    const index = buildIdentityIndex([{ userId: 'U1', visitorId: 'V1' }]);
    expect(resolveActor({ visitorId: 'V1' }, index)).toBe('u:U1');
    expect(resolveActor({ userId: 'U1' }, index)).toBe('u:U1');
    expect(resolveActor({ visitorId: 'V9' }, index)).toBe('v:V9');
  });

  it('匿名瀏覽 → 登入結帳 → 匯款開通，全程算成 1 人走完', () => {
    const index = buildIdentityIndex([{ userId: 'U1', visitorId: 'V1' }]);
    const events: StageEvent[] = [
      { stage: 'view_pricing', visitorId: 'V1', at: t('01:00:00'), source: 'pricing_view' },
      { stage: 'upgrade_click', visitorId: 'V1', at: t('01:01:00'), source: 'checkup_upgrade_click' },
      { stage: 'begin_checkout', userId: 'U1', visitorId: 'V1', at: t('01:02:00'), source: 'checkout_open' },
      // 匯款審核後才開通：來自 member_subscriptions，非前端事件
      { stage: 'purchase', userId: 'U1', at: t('05:00:00'), source: 'member_subscriptions' },
    ];
    const steps = computeFunnel(events, index);
    expect(steps.map((s) => s.actors)).toEqual([1, 1, 1, 1]);
    expect(steps[3].rate).toBe(1);
  });

  it('沒走過上一階段的人不計入本階段，並記為 unattributed', () => {
    const index = buildIdentityIndex([]);
    const steps = computeFunnel([
      { stage: 'view_pricing', visitorId: 'V1', at: t('01:00:00'), source: 'pricing_view' },
      { stage: 'begin_checkout', visitorId: 'V1', at: t('01:05:00'), source: 'checkout_open' },
      { stage: 'begin_checkout', visitorId: 'V2', at: t('01:06:00'), source: 'checkout_open' },
    ], index);
    // upgrade_click 為 0 → 之後階段依序子集必為 0
    expect(steps.map((s) => s.actors)).toEqual([1, 0, 0, 0]);
    expect(steps[2].unattributed).toBe(2);
  });

  it('雙來源同一次點擊只算一次事件', () => {
    const index = buildIdentityIndex([]);
    const steps = computeFunnel([
      { stage: 'upgrade_click', userId: 'U1', at: t('02:00:00.100'), source: 'traffic_events' },
      { stage: 'upgrade_click', userId: 'U1', at: t('02:00:00.800'), source: 'paywall_events' },
      { stage: 'upgrade_click', userId: 'U1', at: t('02:00:05.000'), source: 'traffic_events' },
    ], index);
    expect(steps[1].events).toBe(2);
    expect(steps[1].bySource).toEqual({ traffic_events: 2, paywall_events: 1 });
  });
});
