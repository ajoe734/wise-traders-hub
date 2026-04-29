/**
 * Group 1.35 — plan_split_overrides 解析行為
 */

import { describe, it, expect } from 'vitest';
import { calcSplit } from '@/lib/revenueSplit';

const DEFAULTS = {
  standard: { pct_platform: 55, pct_expert: 45 },
  checkup: { pct_platform: 100, pct_expert: 0 },
};

describe('1.35 plan override resolution', () => {
  it('1.35-1 null override → fallback 至 standard_default', () => {
    const r = calcSplit({
      productKind: 'expert_plan', gross: 1000, discount: 0,
      planOverride: null, defaults: DEFAULTS,
    });
    expect(r.rule_source).toBe('standard_default');
  });

  it('1.35-2 有效 override → plan_override，數字精準', () => {
    const r = calcSplit({
      productKind: 'expert_plan', gross: 1000, discount: 0,
      planOverride: { pct_platform: 60, pct_expert: 40 },
      defaults: DEFAULTS,
    });
    expect(r.rule_source).toBe('plan_override');
    expect(r.rule_snapshot).toEqual({ pct_platform: 60, pct_expert: 40 });
    expect(r.platform_amount).toBe(600);
    expect(r.expert_amount).toBe(400);
  });

  it('1.35-3 override 平台 100% → 專家 0', () => {
    const r = calcSplit({
      productKind: 'expert_plan', gross: 1000, discount: 0,
      planOverride: { pct_platform: 100, pct_expert: 0 },
      defaults: DEFAULTS,
    });
    expect(r.platform_amount).toBe(1000);
    expect(r.expert_amount).toBe(0);
  });

  it('1.35-4 override 平台 0% → 專家拿全額', () => {
    const r = calcSplit({
      productKind: 'expert_plan', gross: 1000, discount: 0,
      planOverride: { pct_platform: 0, pct_expert: 100 },
      defaults: DEFAULTS,
    });
    expect(r.platform_amount).toBe(0);
    expect(r.expert_amount).toBe(1000);
  });

  it('1.35-5 折扣 + override：分潤以 net 計', () => {
    const r = calcSplit({
      productKind: 'expert_plan', gross: 1200, discount: 200,
      planOverride: { pct_platform: 50, pct_expert: 50 },
      defaults: DEFAULTS,
    });
    expect(r.net).toBe(1000);
    expect(r.platform_amount).toBe(500);
    expect(r.expert_amount).toBe(500);
  });

  it('1.35-6 UI 驗證器：pct_platform + pct_expert 必須 = 100', () => {
    const validate = (p: number, e: number) => p + e === 100 && p >= 0 && p <= 100 && e >= 0 && e <= 100;
    expect(validate(55, 45)).toBe(true);
    expect(validate(60, 40)).toBe(true);
    expect(validate(50, 51)).toBe(false);
    expect(validate(-10, 110)).toBe(false);
  });
});
