/**
 * Group 1.34 — confirm-remittance 流程整合測試
 *
 * 驗證 writeRevenueSplit + recordPaymentForExistingSubscription 兩個核心 helper
 * 在 confirm-remittance edge function 流程中的正確性：
 *   1.34-1 健檢產品 → 100% 平台收入，無 expert/channel
 *   1.34-2 expert_plan 標準流量 → 套用 split_standard
 *   1.34-3 expert_plan 被導流 → 套用 split_attributed
 *   1.34-4 expert_plan 被導流 + 通路 override → 通路規則優先
 *   1.34-5 expert_plan 有 expert override → 覆蓋預設
 *   1.34-6 折扣金額正確帶入 net 與 discount 欄位
 *
 * Mock 策略：依資料表分派的 query mock。
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
  { key: 'split_standard', value: { pct_platform: 55, pct_expert: 45, pct_channel: 0 } },
  { key: 'split_attributed', value: { pct_platform: 35, pct_expert: 45, pct_channel: 20 } },
  { key: 'split_checkup', value: { pct_platform: 100, pct_expert: 0, pct_channel: 0 } },
];

describe('1.34 confirm-remittance writeRevenueSplit 流程', () => {
  let supabase: any, mocks: any;

  beforeEach(() => {
    ({ supabase, mocks } = buildSupabase({
      payment_settings: { data: DEFAULTS_ROWS, error: null },
      experts: { data: null, error: null },
      referral_channels: { data: null, error: null },
      revenue_splits: { data: { id: 'split-1' }, error: null },
    }));
  });

  it('1.34-1 健檢產品 → 平台 100%，rule_source = checkup_default', async () => {
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-1', planId: null, expertId: null,
      productKind: 'checkup', gross: 6990, discount: 0,
      discountReason: null, attribution: null,
    });
    const insertCall = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(insertCall.platform_amount).toBe(6990);
    expect(insertCall.expert_amount).toBe(0);
    expect(insertCall.channel_reserve).toBe(0);
    expect(insertCall.rule_source).toBe('checkup_default');
    expect(insertCall.net).toBe(6990);
  });

  it('1.34-2 expert_plan 無 utm → standard_default (55/45/0)', async () => {
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-2', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 0,
      discountReason: null, attribution: null,
    });
    const insertCall = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(insertCall.rule_source).toBe('standard_default');
    expect(insertCall.platform_amount).toBe(550);
    expect(insertCall.channel_reserve).toBe(0);
    expect(insertCall.expert_amount).toBe(450);
  });

  it('1.34-3 expert_plan 有 utm_source → attributed_default (35/45/20)', async () => {
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-3', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 0,
      discountReason: null,
      attribution: { utm_source: 'facebook_ads' },
    });
    const insertCall = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(insertCall.rule_source).toBe('attributed_default');
    expect(insertCall.platform_amount).toBe(350);
    expect(insertCall.channel_reserve).toBe(200);
    expect(insertCall.expert_amount).toBe(450);
  });

  it('1.34-4 channel override 在 attributed 時覆蓋 default', async () => {
    ({ supabase, mocks } = buildSupabase({
      payment_settings: { data: DEFAULTS_ROWS, error: null },
      experts: { data: null, error: null },
      referral_channels: {
        data: { pct_platform: 20, pct_expert: 50, pct_channel: 30 },
        error: null,
      },
      revenue_splits: { data: { id: 'split-2' }, error: null },
    }));
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-4', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 0,
      discountReason: null,
      attribution: { utm_source: 'partner_a' },
    });
    const insertCall = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(insertCall.rule_source).toBe('channel_override');
    expect(insertCall.platform_amount).toBe(200);
    expect(insertCall.channel_reserve).toBe(300);
    expect(insertCall.expert_amount).toBe(500);
  });

  it('1.34-5 expert override 在無 channel override 時生效', async () => {
    ({ supabase, mocks } = buildSupabase({
      payment_settings: { data: DEFAULTS_ROWS, error: null },
      experts: {
        data: { split_no_ref: { pct_platform: 40, pct_expert: 60, pct_channel: 0 }, split_with_ref: null },
        error: null,
      },
      referral_channels: { data: null, error: null },
      revenue_splits: { data: { id: 'split-3' }, error: null },
    }));
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-5', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 0,
      discountReason: null, attribution: null,
    });
    const insertCall = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(insertCall.rule_source).toBe('expert_override');
    expect(insertCall.platform_amount).toBe(400);
    expect(insertCall.expert_amount).toBe(600);
  });

  it('1.34-6 折扣金額正確扣除：net = gross - discount', async () => {
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-6', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 100,
      discountReason: 'cross_checkup_basic', attribution: null,
    });
    const insertCall = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(insertCall.gross).toBe(1000);
    expect(insertCall.discount).toBe(100);
    expect(insertCall.net).toBe(900);
    expect(insertCall.discount_source).toBe('cross_checkup_basic');
    // 55% of 900 = 495
    expect(insertCall.platform_amount).toBe(495);
  });

  it('1.34-7 utm_snapshot 正確寫入歸因欄位', async () => {
    const attr = { utm_source: 'facebook_ads', utm_campaign: 'spring_2026', ref_code: 'AGENT01' };
    await writeRevenueSplit(supabase, {
      transactionId: 'tx-7', planId: 'plan-1', expertId: 'expert-1',
      productKind: 'expert_plan', gross: 1000, discount: 0,
      discountReason: null, attribution: attr,
    });
    const insertCall = mocks.revenue_splits.insert.mock.calls[0][0];
    expect(insertCall.utm_snapshot).toEqual(attr);
  });
});

describe('1.34 recordPaymentForExistingSubscription（升級/續約場景）', () => {
  it('1.34-8 為現有訂閱補寫 payment_transactions + revenue_splits', async () => {
    const { supabase, mocks } = buildSupabase({
      payment_settings: { data: DEFAULTS_ROWS, error: null },
      experts: { data: null, error: null },
      referral_channels: { data: null, error: null },
      payment_transactions: { data: { id: 'tx-new-1' }, error: null },
      revenue_splits: { data: { id: 'split-new-1' }, error: null },
    });
    const result = await recordPaymentForExistingSubscription(supabase, {
      subscriptionId: 'sub-existing-1',
      amount: 12990,
      currency: 'TWD',
      providerTxId: 'REMIT:order-1',
      providerId: 'provider-remit',
      productKind: 'expert_plan',
      planId: 'plan-1',
      expertId: 'expert-1',
      originalAmount: 12990,
      discountAmount: 0,
    });
    expect(result.error).toBeNull();
    expect(mocks.payment_transactions.insert).toHaveBeenCalledTimes(1);
    expect(mocks.revenue_splits.insert).toHaveBeenCalledTimes(1);
    const txCall = mocks.payment_transactions.insert.mock.calls[0][0];
    expect(txCall.subscription_id).toBe('sub-existing-1');
    expect(txCall.status).toBe('paid');
  });

  it('1.34-9 payment_transactions 失敗時不寫入 revenue_splits', async () => {
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
