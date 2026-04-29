/**
 * Group 1.34 — confirm-remittance 流程整合測試（v2，已停用導流分潤）
 *
 * 1.34-1 健檢產品 → 100% 平台收入
 * 1.34-2 expert_plan 無 plan override → standard_default
 * 1.34-3 expert_plan 有 plan override → plan_override 規則
 * 1.34-4 plan_split_overrides.is_active=false → fallback standard_default
 * 1.34-5 折扣金額正確扣除
 * 1.34-6 utm_snapshot 寫入但不影響分潤
 * 1.34-7 recordPaymentForExistingSubscription 寫 tx + split
 * 1.34-8 tx insert 失敗時不寫 split
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeRevenueSplit, recordPaymentForExistingSubscription } from '@/lib/paymentProcessor';
import { createQueryMock } from '../mocks/supabase';

function buildSupabase(tables: Record<string, { data: unknown; error: unknown }>) {
  const mocks: Record<string, ReturnType<typeof createQueryMock>> = {};
  for (const [t, r] of Object.entries(tables)) mocks[t] = createQueryMock(r);
  return {
    supabase: { from: vi.fn((t: string) => mocks[t] ?? createQueryMock({ data: null, error: null })) },
    mocks,
  };
}

const DEFAULTS_ROWS = [
  { key: 'split_standard', value: { pct_platform: 55, pct_expert: 45 } },
  { key: 'split_checkup', value: { pct_platform: 100, pct_expert: 0 } },
];

describe('1.34 writeRevenueSplit', () => {
  let supabase: any, mocks: any;

  beforeEach(() => {
    ({ supabase, mocks } = buildSupabase({
      payment_settings: { data: DEFAULTS_ROWS, error: null },
      plan_split_overrides: { data: null, error: null },
      revenue_splits: { data: { id: 'split-1' }, error: null },
    }));
  });

  it('1.34-1 健檢 → checkup_default', async () => {
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-1', planId: null, expertId: null,
      productKind: 'checkup', gross: 6990, discount: 0,
      discountReason: null, attribution: null,
    });
    const c = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(c.platform_amount).toBe(6990);
    expect(c.expert_amount).toBe(0);
    expect(c.rule_source).toBe('checkup_default');
  });

  it('1.34-2 expert_plan 無 override → standard_default 55/45', async () => {
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-2', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 0,
      discountReason: null, attribution: null,
    });
    const c = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(c.rule_source).toBe('standard_default');
    expect(c.platform_amount).toBe(550);
    expect(c.expert_amount).toBe(450);
    expect(c.channel_reserve).toBe(0);
  });

  it('1.34-3 expert_plan 有 plan override → plan_override 70/30', async () => {
    ({ supabase, mocks } = buildSupabase({
      payment_settings: { data: DEFAULTS_ROWS, error: null },
      plan_split_overrides: { data: { pct_platform: 70, pct_expert: 30 }, error: null },
      revenue_splits: { data: { id: 'split-3' }, error: null },
    }));
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-3', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 0,
      discountReason: null, attribution: null,
    });
    const c = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(c.rule_source).toBe('plan_override');
    expect(c.platform_amount).toBe(700);
    expect(c.expert_amount).toBe(300);
  });

  it('1.34-4 is_active=false 的 override 被 maybeSingle filter 排除 → fallback default', async () => {
    // 模擬 query 加上 .eq('is_active', true) 後找不到，回 null
    ({ supabase, mocks } = buildSupabase({
      payment_settings: { data: DEFAULTS_ROWS, error: null },
      plan_split_overrides: { data: null, error: null },
      revenue_splits: { data: { id: 'split-4' }, error: null },
    }));
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-4', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 0,
      discountReason: null, attribution: null,
    });
    const c = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(c.rule_source).toBe('standard_default');
  });

  it('1.34-5 折扣：net = gross - discount，分潤以 net 計', async () => {
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-5', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 100,
      discountReason: 'cross_checkup_basic', attribution: null,
    });
    const c = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(c.gross).toBe(1000);
    expect(c.discount).toBe(100);
    expect(c.net).toBe(900);
    expect(c.discount_source).toBe('cross_checkup_basic');
    expect(c.platform_amount).toBe(495); // 55% of 900
  });

  it('1.34-6 utm_snapshot 寫入但不影響分潤計算', async () => {
    const attr = { utm_source: 'facebook_ads', utm_campaign: 'spring', ref_code: 'AG01' };
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-6', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 0,
      discountReason: null, attribution: attr,
    });
    const c = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(c.utm_snapshot).toEqual(attr);
    // 不論 utm 為何，分潤一律走 standard
    expect(c.rule_source).toBe('standard_default');
    expect(c.platform_amount).toBe(550);
    expect(c.channel_reserve).toBe(0);
  });
});

describe('1.34 recordPaymentForExistingSubscription（升級/續約）', () => {
  it('1.34-7 為現有訂閱補寫 payment_transactions + revenue_splits', async () => {
    const { supabase, mocks } = buildSupabase({
      payment_settings: { data: DEFAULTS_ROWS, error: null },
      plan_split_overrides: { data: null, error: null },
      payment_transactions: { data: { id: 'tx-new-1' }, error: null },
      revenue_splits: { data: { id: 'split-new-1' }, error: null },
    });
    const result = await recordPaymentForExistingSubscription(supabase, {
      subscriptionId: 'sub-existing-1',
      amount: 12990, currency: 'TWD',
      providerTxId: 'REMIT:order-1', providerId: 'provider-remit',
      productKind: 'expert_plan', planId: 'plan-1', expertId: 'expert-1',
      originalAmount: 12990, discountAmount: 0,
    });
    expect(result.error).toBeNull();
    expect(mocks.payment_transactions.insert).toHaveBeenCalledTimes(1);
    expect(mocks.revenue_splits.insert).toHaveBeenCalledTimes(1);
    expect(mocks.payment_transactions.insert.mock.calls[0][0].subscription_id).toBe('sub-existing-1');
  });

  it('1.34-8 payment_transactions 失敗時不寫 revenue_splits', async () => {
    const { supabase, mocks } = buildSupabase({
      payment_settings: { data: DEFAULTS_ROWS, error: null },
      payment_transactions: { data: null, error: { message: 'insert failed' } },
      revenue_splits: { data: null, error: null },
    });
    const result = await recordPaymentForExistingSubscription(supabase, {
      subscriptionId: 'sub-1', amount: 100, currency: 'TWD',
      providerTxId: 'TX-1', providerId: null,
    });
    expect(result.error).toBe('insert failed');
    expect(mocks.revenue_splits.insert).not.toHaveBeenCalled();
  });
});
