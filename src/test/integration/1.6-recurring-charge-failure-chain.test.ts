/**
 * Group 1.6 — 定期續扣失敗鏈
 *
 * 測試範圍：
 *   直接測試 calcAutoCancelDeadlineUTC、extendSubscriptionExpiry、recordPaymentFailureInDB、
 *   processRenewalCancellations（_shared/subscriptionRenewal.ts），以依資料表名稱分派的
 *   mock Supabase 驗證呼叫順序、參數與早期返回行為。
 *   drift-detection 確認各 Edge Function 已從 _shared/ import，不再維護內聯實作。
 *
 * 對應測試路徑：
 *   1.4-1：扣款成功延長 expires_at（月繳/年繳）
 *   1.4-2：扣款失敗建立 audit_logs + payment_transactions
 *   1.4-3：連續失敗自動取消（無恢復付款）
 *   1.4-4：失敗後有成功付款 → 不自動取消
 *
 * 時區注意：calcAutoCancelDeadlineUTC / processRenewalCancellations 使用 setUTC* 方法，
 *          與執行環境時區無關，可在任意時區正確執行。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createQueryMock } from '@/test/mocks/supabase';
import {
  calcAutoCancelDeadlineUTC,
  extendSubscriptionExpiry,
  recordPaymentFailureInDB,
  filterRenewalFailures,
  processRenewalCancellations,
  type RenewalFailureLog,
} from '@/lib/subscriptionRenewal';

// ── helpers ───────────────────────────────────────────────────────────────────

function createTableMocks(tableResults: Record<string, { data: unknown; error: unknown }>) {
  const mocks: Record<string, ReturnType<typeof createQueryMock>> = {};
  for (const [table, result] of Object.entries(tableResults)) {
    mocks[table] = createQueryMock(result);
  }
  const supabase = {
    from: vi.fn((table: string) => mocks[table] ?? createQueryMock({ data: null, error: null })),
  };
  return { supabase, mocks };
}

// ── calcAutoCancelDeadlineUTC（截止時間純函數）────────────────────────────────

describe('calcAutoCancelDeadlineUTC（自動取消截止時間計算）', () => {
  it('台灣時間 14:00（< 15:30）→ 截止為昨日 15:30 TWD（= 07:30 UTC）', () => {
    // now = 2026-04-14T06:00Z → TW = 2026-04-14T14:00 → before 15:30 → use yesterday
    const deadline = calcAutoCancelDeadlineUTC(new Date('2026-04-14T06:00:00.000Z'));
    expect(deadline.toISOString()).toBe('2026-04-13T07:30:00.000Z');
  });

  it('台灣時間 17:00（> 15:30）→ 截止為今日 15:30 TWD（= 07:30 UTC）', () => {
    // now = 2026-04-14T09:00Z → TW = 2026-04-14T17:00 → after 15:30 → use today
    const deadline = calcAutoCancelDeadlineUTC(new Date('2026-04-14T09:00:00.000Z'));
    expect(deadline.toISOString()).toBe('2026-04-14T07:30:00.000Z');
  });
});

// ── extendSubscriptionExpiry（月繳 / 年繳）────────────────────────────────────

describe('extendSubscriptionExpiry（定期扣款成功延長訂閱到期日）', () => {
  it('月繳成功 → member_subscriptions.update 含正確 expires_at（+1 month）', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: {
        data: { id: 'sub-001', expires_at: '2026-03-14T00:00:00.000Z' },
        error: null,
      },
    });

    const result = await extendSubscriptionExpiry(supabase as any, {
      userId: 'user-001',
      planId: 'plan-001',
      billingCycle: 'monthly',
      now: new Date('2026-04-14T10:00:00.000Z'),
    });

    expect(result.error).toBeNull();
    expect(result.subscriptionId).toBe('sub-001');
    // 2026-03-14 + 1 month = 2026-04-14
    expect(result.newExpiresAt).toBe('2026-04-14T00:00:00.000Z');
    expect(mocks.member_subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: '2026-04-14T00:00:00.000Z' })
    );
  });

  it('年繳成功 → member_subscriptions.update 含正確 expires_at（+1 year）', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: {
        data: { id: 'sub-002', expires_at: '2026-04-14T00:00:00.000Z' },
        error: null,
      },
    });

    const result = await extendSubscriptionExpiry(supabase as any, {
      userId: 'user-002',
      planId: 'plan-002',
      billingCycle: 'yearly',
      now: new Date('2026-04-14T10:00:00.000Z'),
    });

    expect(result.error).toBeNull();
    expect(result.subscriptionId).toBe('sub-002');
    // 2026-04-14 + 1 year = 2027-04-14
    expect(result.newExpiresAt).toBe('2027-04-14T00:00:00.000Z');
    expect(mocks.member_subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: '2027-04-14T00:00:00.000Z' })
    );
  });

  it('找不到有效訂閱 → 回傳 error，update 不觸發', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: { data: null, error: null },
    });

    const result = await extendSubscriptionExpiry(supabase as any, {
      userId: 'user-999',
      planId: 'plan-999',
      billingCycle: 'monthly',
    });

    expect(result.error).toBe('No active subscription found');
    expect(result.subscriptionId).toBeNull();
    expect(result.newExpiresAt).toBeNull();
    expect(mocks.member_subscriptions.update).not.toHaveBeenCalled();
  });

  it('update expires_at DB 錯誤 → 回傳 error，subscriptionId 仍有值', async () => {
    const selectMock = createQueryMock({
      data: { id: 'sub-003', expires_at: '2026-03-14T00:00:00.000Z' },
      error: null,
    });
    const updateMock = createQueryMock({
      data: null,
      error: { message: 'DB update failed' },
    });
    // 第一次呼叫 from() → SELECT mock；第二次 → UPDATE mock
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(selectMock)
        .mockReturnValueOnce(updateMock),
    };

    const result = await extendSubscriptionExpiry(supabase as any, {
      userId: 'user-003',
      planId: 'plan-003',
      billingCycle: 'monthly',
    });

    expect(result.error).toBe('DB update failed');
    expect(result.subscriptionId).toBe('sub-003');
    expect(result.newExpiresAt).toBeNull();
  });
});

// ── filterRenewalFailures（篩選續扣失敗記錄）─────────────────────────────────

describe('filterRenewalFailures（篩選 isRenewal === true 的紀錄）', () => {
  it('混合紀錄 → 只保留 isRenewal=true，過濾其餘', () => {
    const logs = [
      { actor_id: 'u1', detail: { isRenewal: true } },
      { actor_id: 'u2', detail: { isRenewal: false } },
      { actor_id: 'u3', detail: {} },
      { actor_id: 'u4', detail: { isRenewal: true } },
    ];
    const result = filterRenewalFailures(logs);
    expect(result).toHaveLength(2);
    expect(result.map((r: any) => r.actor_id)).toEqual(['u1', 'u4']);
  });
});

// ── recordPaymentFailureInDB（1.4-2）──────────────────────────────────────────

describe('recordPaymentFailureInDB（付款失敗記錄）', () => {
  it('正常路徑 → payment_transactions(status=failed) + audit_logs(payment_failure_notification) 均寫入', async () => {
    const { supabase, mocks } = createTableMocks({
      payment_transactions: { data: null, error: null },
      audit_logs: { data: { id: 'log-001' }, error: null },
    });

    const result = await recordPaymentFailureInDB(supabase as any, {
      userId: 'user-001',
      planId: 'plan-001',
      amount: 299,
      provider: 'acpay',
      providerId: 'provider-acpay-001',
      isRenewal: true,
      lineSent: false,
      emailSent: true,
      errorDetail: 'recurring payResult: 1',
    });

    expect(result.error).toBeNull();
    expect(mocks.payment_transactions.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', amount: 299 })
    );
    expect(mocks.audit_logs.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment_failure_notification',
        actor_id: 'user-001',
        target_id: 'plan-001',
        detail: expect.objectContaining({ isRenewal: true }),
      })
    );
  });

  it('audit_logs.insert 失敗 → 回傳 error message', async () => {
    const { supabase } = createTableMocks({
      payment_transactions: { data: null, error: null },
      audit_logs: { data: null, error: { message: 'audit log insert failed' } },
    });

    const result = await recordPaymentFailureInDB(supabase as any, {
      userId: 'user-001',
      planId: 'plan-001',
      amount: 299,
      provider: 'acpay',
      providerId: null,
      isRenewal: false,
      lineSent: false,
      emailSent: false,
    });

    expect(result.error).toBe('audit log insert failed');
  });

  it('payment_transactions.insert 失敗 → 回傳 error message', async () => {
    const { supabase } = createTableMocks({
      payment_transactions: { data: null, error: { message: 'tx insert failed' } },
      audit_logs: { data: { id: 'log-002' }, error: null },
    });

    const result = await recordPaymentFailureInDB(supabase as any, {
      userId: 'user-001',
      planId: 'plan-001',
      amount: 299,
      provider: 'acpay',
      providerId: null,
      isRenewal: true,
      lineSent: false,
      emailSent: false,
    });

    expect(result.error).toBe('tx insert failed');
  });
});

// ── processRenewalCancellations（1.4-3, 1.4-4）───────────────────────────────

describe('processRenewalCancellations（逾期失敗訂閱自動取消）', () => {
  const failureLog: RenewalFailureLog = {
    actor_id: 'user-001',
    target_id: 'plan-001',
    created_at: '2026-04-13T08:00:00.000Z',
    detail: { isRenewal: true },
  };
  // now = 2026-04-14T12:00Z → TW = 2026-04-14T20:00 → 本月底 UTC = 2026-04-30T15:59:59.999Z
  const now = new Date('2026-04-14T12:00:00.000Z');

  it('有逾期失敗記錄、無恢復付款 → 訂閱取消，update 含正確欄位，audit_log 建立（1.4-3）', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: {
        data: { id: 'sub-001', plan_id: 'plan-001', canceled_at: null },
        error: null,
      },
      payment_transactions: { data: [], error: null },
      audit_logs: { data: { id: 'auditlog-001' }, error: null },
    });

    const result = await processRenewalCancellations(supabase as any, [failureLog], now);

    expect(result.canceled).toBe(1);
    expect(result.checked).toBe(1);
    expect(mocks.member_subscriptions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        auto_renew: false,
        canceled_at: now.toISOString(),
        expires_at: '2026-04-30T15:59:59.999Z', // 本月底 23:59:59.999 TW → UTC
      })
    );
    expect(mocks.audit_logs.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auto_cancel_failed_renewal',
        actor_id: 'user-001',
      })
    );
  });

  it('有逾期失敗記錄、有後續成功付款 → member_subscriptions.update 不觸發（1.4-4）', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: {
        data: { id: 'sub-001', plan_id: 'plan-001', canceled_at: null },
        error: null,
      },
      payment_transactions: { data: [{ id: 'tx-recovery-001' }], error: null },
    });

    const result = await processRenewalCancellations(supabase as any, [failureLog], now);

    expect(result.canceled).toBe(0);
    expect(result.checked).toBe(1);
    expect(mocks.member_subscriptions.update).not.toHaveBeenCalled();
  });

  it('空失敗清單 → 無任何 DB 操作，canceled=0', async () => {
    const supabase = { from: vi.fn() };

    const result = await processRenewalCancellations(supabase as any, [], now);

    expect(result.canceled).toBe(0);
    expect(result.checked).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

// ── drift-detection：Edge Functions 使用共用 _shared/subscriptionRenewal.ts ──

describe('drift-detection: Edge Functions 使用共用 _shared/subscriptionRenewal.ts', () => {
  const edgeFn = (name: string) =>
    readFileSync(resolve(process.cwd(), `supabase/functions/${name}/index.ts`), 'utf-8');

  it('acpay-recurring-notify 從 _shared/ 取用 extendSubscriptionExpiry', () => {
    const src = edgeFn('acpay-recurring-notify');
    expect(src).toContain('../_shared/subscriptionRenewal.ts');
    expect(src).toContain('extendSubscriptionExpiry');
  });

  it('auto-cancel-failed-renewals 從 _shared/ 取用 processRenewalCancellations', () => {
    const src = edgeFn('auto-cancel-failed-renewals');
    expect(src).toContain('../_shared/subscriptionRenewal.ts');
    expect(src).toContain('processRenewalCancellations');
  });

  it('auto-cancel-failed-renewals 從 _shared/ 取用 calcAutoCancelDeadlineUTC', () => {
    const src = edgeFn('auto-cancel-failed-renewals');
    expect(src).toContain('calcAutoCancelDeadlineUTC');
  });

  it('notify-payment-failure 從 _shared/ 取用 recordPaymentFailureInDB', () => {
    const src = edgeFn('notify-payment-failure');
    expect(src).toContain('../_shared/subscriptionRenewal.ts');
    expect(src).toContain('recordPaymentFailureInDB');
  });

  it('auto-cancel-failed-renewals 從 _shared/ 取用 filterRenewalFailures', () => {
    const src = edgeFn('auto-cancel-failed-renewals');
    expect(src).toContain('filterRenewalFailures');
  });
});
