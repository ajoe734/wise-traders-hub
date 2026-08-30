/**
 * Group 1.5 — 付款→訂閱原子性
 *
 * 測試路徑：
 *   1.3-1 正常付款 → member_subscriptions(active) + payment_transactions(paid) 同時建立
 *   1.3-2 訂閱建立時 DB 錯誤 → payment_transactions 不建立（保持資料一致性）
 *   1.3-3 payment_transactions.subscription_id 正確指向 member_subscriptions.id
 *
 * 測試策略：
 *   直接測試 createSubscriptionAndTransaction 與 recordPaymentForExistingSubscription
 *   （_shared/paymentProcessor.ts），以依資料表名稱分派的 mock Supabase 驗證呼叫順序、
 *   參數與早期返回行為。drift-detection 確認各 Edge Function 已從 _shared/ import，
 *   不再維護內聯實作。
 *
 * ⚠️ 已知限制（Mock 層固有）：
 *   - Mock 不反映真實 DB constraint / trigger / RPC transaction 行為
 *   - 一方向性保證：subscription 失敗 → tx 不建立（✓ 已測試）
 *     反向（tx 失敗 → subscription 不回滾）為已知行為，見下方「已知行為」describe
 *   - Edge Function 的「已有訂閱」分支（existing subscription branch）不走 helper，
 *     需在 Group 1.17 / 1.24 以真實 Supabase 環境覆蓋
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSubscriptionAndTransaction, recordPaymentForExistingSubscription } from '../../../supabase/functions/_shared/paymentProcessor';
import { createQueryMock } from '../mocks/supabase';

// ── Mock 工具：依資料表名稱回傳不同 queryMock ──────────────────────────────────

function createTableMocks(tableResults: Record<string, { data: unknown; error: unknown }>) {
  const mocks: Record<string, ReturnType<typeof createQueryMock>> = {};
  for (const [table, result] of Object.entries(tableResults)) {
    mocks[table] = createQueryMock(result);
  }
  const supabase = {
    from: vi.fn((table: string) =>
      mocks[table] ?? createQueryMock({ data: null, error: null })
    ),
  };
  return { supabase, mocks };
}

// ── 共用 fixtures ──────────────────────────────────────────────────────────────

const BASE_PARAMS = {
  userId: 'user-test-001',
  planId: 'plan-monthly-001',
  billingCycle: 'monthly',
  amount: 299,
  currency: 'TWD',
  providerTxId: 'PROVIDER-TX-001',
  providerId: 'provider-acpay-001',
  now: new Date('2026-04-14T10:00:00.000Z'),
};

// ── 1.3 付款→訂閱原子性 ──────────────────────────────────────────────────────

describe('1.3 付款→訂閱原子性（createSubscriptionAndTransaction）', () => {
  it('1.3-1 正常付款 → member_subscriptions(active) + payment_transactions(paid) 同時建立', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: { data: { id: 'sub-abc-001' }, error: null },
      payment_transactions: { data: { id: 'tx-xyz-001' }, error: null },
    });

    const result = await createSubscriptionAndTransaction(supabase as any, BASE_PARAMS);

    // 兩筆紀錄均成功建立
    expect(result.error).toBeNull();
    expect(result.subscriptionId).toBe('sub-abc-001');
    expect(result.transactionId).toBe('tx-xyz-001');

    // member_subscriptions.insert 以正確欄位呼叫
    expect(mocks.member_subscriptions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-test-001',
        plan_id: 'plan-monthly-001',
        status: 'active',
      })
    );

    // payment_transactions.insert 以正確欄位呼叫
    expect(mocks.payment_transactions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'paid',
        provider_tx_id: 'PROVIDER-TX-001',
        subscription_id: 'sub-abc-001',
      })
    );
  });

  it('1.3-2 訂閱建立時 DB 錯誤 → payment_transactions 不建立（保持資料一致性）', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: { data: null, error: { message: 'foreign key violation' } },
      payment_transactions: { data: { id: 'tx-should-not-exist' }, error: null },
    });

    const result = await createSubscriptionAndTransaction(supabase as any, BASE_PARAMS);

    // 回傳訂閱錯誤，兩個 ID 均為 null
    expect(result.error).toBe('foreign key violation');
    expect(result.subscriptionId).toBeNull();
    expect(result.transactionId).toBeNull();

    // payment_transactions.insert 不應被呼叫（不可有孤立的交易紀錄）
    expect(mocks.payment_transactions.insert).not.toHaveBeenCalled();
  });

  it('1.3-3 payment_transactions.subscription_id 正確指向 member_subscriptions.id', async () => {
    const EXPECTED_SUB_ID = 'sub-link-check-999';
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: { data: { id: EXPECTED_SUB_ID }, error: null },
      payment_transactions: { data: { id: 'tx-link-001' }, error: null },
    });

    await createSubscriptionAndTransaction(supabase as any, {
      ...BASE_PARAMS,
      userId: 'user-link-003',
      providerTxId: 'TX-LINK-003',
    });

    // payment_transactions.insert 使用的 subscription_id 必須完全等於 member_subscriptions 回傳的 id
    const txPayload = (mocks.payment_transactions.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(txPayload.subscription_id).toBe(EXPECTED_SUB_ID);
    expect(txPayload.subscription_id).not.toBeNull();
  });
});

// ── billing_cycle 到期日計算 ──────────────────────────────────────────────────

describe('billing_cycle 到期日計算（expires_at）', () => {
  const FIXED_NOW = new Date('2026-04-14T10:00:00.000Z');

  it('月繳 → expires_at 為次月同日同時', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: { data: { id: 'sub-m' }, error: null },
      payment_transactions: { data: { id: 'tx-m' }, error: null },
    });

    await createSubscriptionAndTransaction(supabase as any, {
      userId: 'u', planId: 'p', billingCycle: 'monthly',
      amount: 299, currency: 'TWD', providerTxId: 'TX-M',
      providerId: null, now: FIXED_NOW,
    });

    const subPayload = (mocks.member_subscriptions.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(subPayload.started_at).toBe(FIXED_NOW.toISOString());
    expect(subPayload.expires_at).toBe(new Date('2026-05-14T10:00:00.000Z').toISOString());
  });

  it('年繳 → expires_at 為次年同日同時', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: { data: { id: 'sub-y' }, error: null },
      payment_transactions: { data: { id: 'tx-y' }, error: null },
    });

    await createSubscriptionAndTransaction(supabase as any, {
      userId: 'u', planId: 'p', billingCycle: 'yearly',
      amount: 2990, currency: 'TWD', providerTxId: 'TX-Y',
      providerId: null, now: FIXED_NOW,
    });

    const subPayload = (mocks.member_subscriptions.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(subPayload.expires_at).toBe(new Date('2027-04-14T10:00:00.000Z').toISOString());
  });
});

// ── 已知行為：payment_transactions insert 失敗（訂閱不回滾）────────────────────
// 此 describe 記錄「已知的不完整狀態」，不是驗證正確性。
// Supabase Edge Functions 無內建 transaction，tx 失敗後訂閱已寫入，需外層重試或人工補單。

describe('已知行為：payment_transactions insert 失敗（訂閱不回滾）', () => {
  it('訂閱建立成功但交易 insert 失敗 → subscriptionId 保留、transactionId null（非全回滾）', async () => {
    const { supabase } = createTableMocks({
      member_subscriptions: { data: { id: 'sub-ok' }, error: null },
      payment_transactions: { data: null, error: { message: 'tx insert constraint' } },
    });

    const result = await createSubscriptionAndTransaction(supabase as any, {
      ...BASE_PARAMS,
      providerTxId: 'TX-ERR',
    });

    expect(result.subscriptionId).toBe('sub-ok');
    expect(result.transactionId).toBeNull();
    expect(result.error).toBe('tx insert constraint');
  });
});

// ── recordPaymentForExistingSubscription ─────────────────────────────────────

describe('recordPaymentForExistingSubscription（已有訂閱時建立交易紀錄）', () => {
  it('正常路徑 → payment_transactions 建立、subscription_id 正確', async () => {
    const { supabase, mocks } = createTableMocks({
      payment_transactions: { data: { id: 'tx-exist-001' }, error: null },
    });

    const result = await recordPaymentForExistingSubscription(supabase as any, {
      subscriptionId: 'sub-existing-001',
      amount: 299,
      currency: 'TWD',
      providerTxId: 'PROVIDER-TX-EXIST-001',
      providerId: 'provider-acpay-001',
      now: new Date('2026-04-14T10:00:00.000Z'),
    });

    expect(result.error).toBeNull();
    expect(mocks.payment_transactions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'paid',
        subscription_id: 'sub-existing-001',
        provider_tx_id: 'PROVIDER-TX-EXIST-001',
      })
    );
  });

  it('DB 錯誤 → 回傳 error message', async () => {
    const { supabase } = createTableMocks({
      payment_transactions: { data: null, error: { message: 'unique constraint violation' } },
    });

    const result = await recordPaymentForExistingSubscription(supabase as any, {
      subscriptionId: 'sub-existing-002',
      amount: 299,
      currency: 'TWD',
      providerTxId: 'PROVIDER-TX-DUP',
      providerId: null,
    });

    expect(result.error).toBe('unique constraint violation');
  });
});

// ── drift-detection：Edge Functions 使用共用 _shared/paymentProcessor.ts ─────

describe('drift-detection: Edge Functions 使用共用 _shared/paymentProcessor.ts', () => {
  const edgeFn = (name: string) =>
    readFileSync(resolve(process.cwd(), `supabase/functions/${name}/index.ts`), 'utf-8');

  it('acpay-notify 從 _shared/ 取用 createSubscriptionAndTransaction', () => {
    const src = edgeFn('acpay-notify');
    expect(src).toContain('../_shared/paymentProcessor.ts');
    expect(src).toContain('createSubscriptionAndTransaction');
  });

  it('confirm-linepay 從 _shared/ 取用 createSubscriptionAndTransaction', () => {
    expect(edgeFn('confirm-linepay')).toContain('../_shared/linepayConfirm.ts');
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/linepayConfirm.ts'),
      'utf-8',
    );
    expect(src).toContain('./paymentProcessor.ts');
    expect(src).toContain('createSubscriptionAndTransaction');
  });

  it('ecpay-callback 從 _shared/ 取用 createSubscriptionAndTransaction', () => {
    const src = edgeFn('ecpay-callback');
    expect(src).toContain('../_shared/paymentProcessor.ts');
    expect(src).toContain('createSubscriptionAndTransaction');
  });

  it('acpay-notify 從 _shared/ 取用 recordPaymentForExistingSubscription', () => {
    const src = edgeFn('acpay-notify');
    expect(src).toContain('recordPaymentForExistingSubscription');
  });

  it('ecpay-callback 從 _shared/ 取用 recordPaymentForExistingSubscription', () => {
    const src = edgeFn('ecpay-callback');
    expect(src).toContain('recordPaymentForExistingSubscription');
  });
});
