import { describe, it, expect } from 'vitest';
import { calcCrossDiscount } from '../../../supabase/functions/_shared/revenueSplit.ts';

const rules = {
  has_checkup_basic_discount_on_expert: 100,
  has_checkup_pro_discount_on_expert: 200,
  has_expert_discount_on_checkup_basic: 100,
  has_expert_discount_on_checkup_pro: 200,
};

describe('calcCrossDiscount', () => {
  it('expert_plan + checkup pro → 200', () => {
    expect(calcCrossDiscount({ productKind: 'expert_plan', hasActiveExpert: false, activeCheckupTier: 'pro', rules }))
      .toEqual({ amount: 200, reason: 'cross_checkup_pro' });
  });
  it('expert_plan + checkup basic → 100', () => {
    expect(calcCrossDiscount({ productKind: 'expert_plan', hasActiveExpert: false, activeCheckupTier: 'basic', rules }))
      .toEqual({ amount: 100, reason: 'cross_checkup_basic' });
  });
  it('checkup pro + active expert → 200', () => {
    expect(calcCrossDiscount({ productKind: 'checkup', checkupTier: 'pro', hasActiveExpert: true, activeCheckupTier: null, rules }))
      .toEqual({ amount: 200, reason: 'cross_expert_on_pro' });
  });
  it('checkup basic + active expert → 100', () => {
    expect(calcCrossDiscount({ productKind: 'checkup', checkupTier: 'basic', hasActiveExpert: true, activeCheckupTier: null, rules }))
      .toEqual({ amount: 100, reason: 'cross_expert_on_basic' });
  });
  it('no eligible state → 0', () => {
    expect(calcCrossDiscount({ productKind: 'expert_plan', hasActiveExpert: false, activeCheckupTier: null, rules }))
      .toEqual({ amount: 0, reason: null });
    expect(calcCrossDiscount({ productKind: 'checkup', checkupTier: 'basic', hasActiveExpert: false, activeCheckupTier: null, rules }))
      .toEqual({ amount: 0, reason: null });
  });
});
