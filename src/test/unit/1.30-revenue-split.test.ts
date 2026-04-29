/**
 * Group 1.30 — 分潤計算（v2，已停用導流分潤）
 *
 * 架構：
 *   - 健檢：平台 100%
 *   - 一般方案：planOverride 優先，否則 standard_default
 *   - attribution 僅做行銷追蹤紀錄，不影響分潤
 */

import { describe, it, expect } from 'vitest';
import { calcSplit, type SplitInput } from '@/lib/revenueSplit';

const DEFAULTS = {
  standard: { pct_platform: 55, pct_expert: 45 },
  checkup: { pct_platform: 100, pct_expert: 0 },
};

function base(overrides: Partial<SplitInput> = {}): SplitInput {
  return {
    productKind: 'expert_plan',
    gross: 1000,
    discount: 0,
    defaults: DEFAULTS,
    ...overrides,
  };
}

describe('1.30 calcSplit', () => {
  it('1.30-1 健檢：平台 100%', () => {
    const r = calcSplit(base({ productKind: 'checkup' }));
    expect(r.platform_amount).toBe(1000);
    expect(r.expert_amount).toBe(0);
    expect(r.channel_reserve).toBe(0);
    expect(r.rule_source).toBe('checkup_default');
  });

  it('1.30-2 一般方案無 override → standard_default 55/45', () => {
    const r = calcSplit(base());
    expect(r.rule_source).toBe('standard_default');
    expect(r.platform_amount).toBe(550);
    expect(r.expert_amount).toBe(450);
    expect(r.channel_reserve).toBe(0);
  });

  it('1.30-3 planOverride 優先於 standard', () => {
    const r = calcSplit(base({ planOverride: { pct_platform: 70, pct_expert: 30 } }));
    expect(r.rule_source).toBe('plan_override');
    expect(r.platform_amount).toBe(700);
    expect(r.expert_amount).toBe(300);
  });

  it('1.30-4 健檢忽略 planOverride', () => {
    const r = calcSplit(base({ productKind: 'checkup', planOverride: { pct_platform: 50, pct_expert: 50 } }));
    expect(r.rule_source).toBe('checkup_default');
    expect(r.platform_amount).toBe(1000);
  });

  it('1.30-5 折扣後：net = gross - discount，分潤以 net 計', () => {
    const r = calcSplit(base({ discount: 100 }));
    expect(r.net).toBe(900);
    expect(r.platform_amount).toBe(495); // 55% of 900
    expect(r.expert_amount).toBe(405);
  });

  it('1.30-6 殘差給 expert（避免湊不足 100%）', () => {
    // 33/67 of 100 → platform=33, expert=100-33=67
    const r = calcSplit(base({ gross: 100, planOverride: { pct_platform: 33, pct_expert: 67 } }));
    expect(r.platform_amount + r.expert_amount).toBe(100);
    expect(r.expert_amount).toBe(67);
  });

  it('1.30-7 attribution 不影響分潤（只做追蹤）', () => {
    const r = calcSplit(base({ attribution: { utm_source: 'facebook_ads' } }));
    expect(r.rule_source).toBe('standard_default');
    expect(r.platform_amount).toBe(550);
    expect(r.channel_reserve).toBe(0);
  });
});
