import { describe, it, expect } from 'vitest';
import { calcSplit, isAttributed, type SplitInput } from '../../../supabase/functions/_shared/revenueSplit.ts';

const defaults: SplitInput['defaults'] = {
  standard:   { pct_platform: 55, pct_expert: 45, pct_channel: 0 },
  attributed: { pct_platform: 35, pct_expert: 45, pct_channel: 20 },
  checkup:    { pct_platform: 100, pct_expert: 0, pct_channel: 0 },
};

describe('isAttributed', () => {
  it('returns false when attribution missing or own source', () => {
    expect(isAttributed(null)).toBe(false);
    expect(isAttributed({ utm_source: '' })).toBe(false);
    expect(isAttributed({ utm_source: 'organic' })).toBe(false);
    expect(isAttributed({ utm_source: 'Direct' })).toBe(false);
    expect(isAttributed({ utm_source: 'legendflow' })).toBe(false);
  });
  it('returns true on third-party source', () => {
    expect(isAttributed({ utm_source: 'facebook_ads' })).toBe(true);
  });
});

describe('calcSplit', () => {
  it('checkup → 100% platform regardless of attribution', () => {
    const r = calcSplit({ productKind: 'checkup', gross: 1299, discount: 0, defaults, attribution: { utm_source: 'facebook_ads' } });
    expect(r.platform_amount).toBe(1299);
    expect(r.expert_amount).toBe(0);
    expect(r.channel_reserve).toBe(0);
    expect(r.rule_source).toBe('checkup_default');
  });

  it('expert_plan with no attribution → standard 55/45/0', () => {
    const r = calcSplit({ productKind: 'expert_plan', gross: 1000, discount: 0, defaults, attribution: null });
    expect(r.platform_amount).toBe(550);
    expect(r.expert_amount).toBe(450);
    expect(r.channel_reserve).toBe(0);
    expect(r.rule_source).toBe('standard_default');
  });

  it('expert_plan attributed (no override) → 35/45/20', () => {
    const r = calcSplit({ productKind: 'expert_plan', gross: 1000, discount: 0, defaults, attribution: { utm_source: 'facebook_ads' } });
    expect(r.platform_amount).toBe(350);
    expect(r.channel_reserve).toBe(200);
    expect(r.expert_amount).toBe(450);
    expect(r.rule_source).toBe('attributed_default');
  });

  it('channelOverride applied when attributed', () => {
    const r = calcSplit({
      productKind: 'expert_plan', gross: 1000, discount: 0, defaults,
      attribution: { utm_source: 'facebook_ads' },
      channelOverride: { pct_platform: 30, pct_expert: 40, pct_channel: 30 },
    });
    expect(r.rule_source).toBe('channel_override');
    expect(r.platform_amount).toBe(300);
    expect(r.channel_reserve).toBe(300);
    expect(r.expert_amount).toBe(400);
  });

  it('expertOverride wins over standard', () => {
    const r = calcSplit({
      productKind: 'expert_plan', gross: 1000, discount: 0, defaults,
      expertOverride: { pct_platform: 40, pct_expert: 60, pct_channel: 0 },
    });
    expect(r.rule_source).toBe('expert_override');
    expect(r.platform_amount).toBe(400);
    expect(r.expert_amount).toBe(600);
  });

  it('discount reduces net; sum == net (residual to expert)', () => {
    const r = calcSplit({ productKind: 'expert_plan', gross: 1001, discount: 100, defaults, attribution: null });
    expect(r.net).toBe(901);
    expect(r.platform_amount + r.expert_amount + r.channel_reserve).toBe(r.net);
  });

  it('gross < discount → net = 0 and no negatives', () => {
    const r = calcSplit({ productKind: 'expert_plan', gross: 50, discount: 100, defaults, attribution: null });
    expect(r.net).toBe(0);
    expect(r.platform_amount).toBe(0);
    expect(r.expert_amount).toBe(0);
    expect(r.channel_reserve).toBe(0);
  });
});
