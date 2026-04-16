/**
 * Group 1.7 — 退款操作與冪等性
 *
 * 測試範圍：
 *   cancelSubscriptionInDB（src/lib/cancelSubscription.ts）：
 *     月繳取消 → member_subscriptions.update 不含 expires_at
 *     年繳取消 → member_subscriptions.update 含 expires_at（本月底 23:59:59 TWD = 15:59:59 UTC）
 *     DB update 失敗 → 回傳 error
 *
 *   processRefundInDB（_shared/refundProcessor.ts）：
 *     退款完成 → payment_transactions(refunded) + audit_logs(yearly_refund) 完整 payload 驗證
 *     重複退款請求（冪等性）→ 已有退款紀錄時直接回傳成功，insert 不觸發
 *     payment_transactions.insert 失敗 → 回傳 error，success=false
 *     refundAmount > originalTx.amount → cappedRefundAmount = originalTx.amount（cap 邏輯）
 *     audit_logs.insert 失敗 → 仍回傳 success（audit 為非關鍵步驟）
 *
 *   drift-detection：
 *     process-refund 從 _shared/refundProcessor.ts import processRefundInDB
 *     Account.tsx import cancelSubscriptionInDB
 *
 * 對應測試路徑：
 *   1.5-1：月繳取消不退費，member_subscriptions.update 不含 expires_at
 *   1.5-5：退款完成狀態更新 → payment_transactions(refunded) + audit_logs
 *   1.5-6：重複退款請求拒絕（冪等性）
 *
 * 時區注意：cancelSubscriptionInDB 的 end-of-month 計算使用 setUTC* 方法，
 *          與執行環境時區無關，now=2026-04-14T10:00Z → expires_at=2026-04-30T15:59:59.999Z
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createQueryMock } from '@/test/mocks/supabase';
import { cancelSubscriptionInDB } from '@/lib/cancelSubscription';
import { processRefundInDB } from '@/lib/refundProcessor';

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

// ── cancelSubscriptionInDB ────────────────────────────────────────────────────

describe('cancelSubscriptionInDB（取消訂閱 DB 更新）', () => {
  // now = 2026-04-14T10:00Z → TWD = 2026-04-14T18:00 → 本月底 TWD 23:59:59 = 2026-04-30T15:59:59.999Z
  const now = new Date('2026-04-14T10:00:00.000Z');

  it('月繳取消 → member_subscriptions.update 不含 expires_at，refundAmount = 0（1.5-1）', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: { data: null, error: null },
    });

    const monthlySub = {
      id: 'sub-001',
      started_at: '2026-03-14T00:00:00.000Z',
      expires_at: '2026-04-14T00:00:00.000Z',
      plan: { price_monthly: 299, price_yearly: null },
    };

    const result = await cancelSubscriptionInDB(supabase as any, monthlySub, 'user-001', now);

    expect(result.error).toBeNull();
    expect(result.refund.isYearly).toBe(false);
    expect(result.refund.refundAmount).toBe(0);
    const updateArg = mocks.member_subscriptions.update.mock.calls[0][0];
    expect(updateArg).not.toHaveProperty('expires_at');
    expect(updateArg).toMatchObject({ auto_renew: false, canceled_at: now.toISOString() });
  });

  it('年繳取消 → member_subscriptions.update 含 expires_at 精確為本月底 TWD 23:59:59', async () => {
    const { supabase, mocks } = createTableMocks({
      member_subscriptions: { data: null, error: null },
    });

    const yearlySub = {
      id: 'sub-002',
      started_at: '2025-10-14T00:00:00.000Z',
      expires_at: '2026-10-14T00:00:00.000Z',
      plan: { price_monthly: 299, price_yearly: 3588 },
    };

    const result = await cancelSubscriptionInDB(supabase as any, yearlySub, 'user-002', now);

    expect(result.error).toBeNull();
    expect(result.refund.isYearly).toBe(true);
    const updateArg = mocks.member_subscriptions.update.mock.calls[0][0];
    // 2026-04-14T10:00Z → TWD 本月底 23:59:59.999 = 2026-04-30T15:59:59.999Z
    expect(updateArg.expires_at).toBe('2026-04-30T15:59:59.999Z');
    expect(updateArg).toMatchObject({ auto_renew: false, canceled_at: now.toISOString() });
  });

  it('DB update 失敗 → 回傳 error message，refund 仍有值', async () => {
    const { supabase } = createTableMocks({
      member_subscriptions: { data: null, error: { message: 'update failed' } },
    });

    const monthlySub = {
      id: 'sub-003',
      started_at: '2026-03-14T00:00:00.000Z',
      expires_at: '2026-04-14T00:00:00.000Z',
      plan: { price_monthly: 299, price_yearly: null },
    };

    const result = await cancelSubscriptionInDB(supabase as any, monthlySub, 'user-003', now);

    expect(result.error).toBe('update failed');
    expect(result.refund).toBeDefined();
  });
});

// ── processRefundInDB ─────────────────────────────────────────────────────────

describe('processRefundInDB（退款 DB 操作）', () => {
  it('退款完成 → payment_transactions(refunded) + audit_logs(yearly_refund) 完整 payload（1.5-5）', async () => {
    const ptCheck = createQueryMock({ data: [], error: null });
    const ptOriginalTx = createQueryMock({
      data: { id: 'tx-001', provider_id: 'p1', provider_tx_id: 'TX123', amount: 3588 },
      error: null,
    });
    const ptInsert = createQueryMock({ data: null, error: null });
    const auditInsert = createQueryMock({ data: null, error: null });

    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(ptCheck)
        .mockReturnValueOnce(ptOriginalTx)
        .mockReturnValueOnce(ptInsert)
        .mockReturnValueOnce(auditInsert),
    };

    const result = await processRefundInDB(supabase as any, {
      subscriptionId: 'sub-001',
      userId: 'user-001',
      refundAmount: 897,
      remainingMonths: 3,
      originalAmount: 3588,
      monthlyPrice: 299,
    });

    expect(result.success).toBe(true);
    expect(result.alreadyRefunded).toBe(false);
    expect(result.cappedRefundAmount).toBe(897);
    expect(result.error).toBeNull();
    expect(ptInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'refunded', amount: -897, subscription_id: 'sub-001' })
    );
    expect(auditInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'yearly_refund',
        actor_id: 'user-001',
        target_id: 'sub-001',
        target_type: 'member_subscriptions',
        detail: expect.objectContaining({
          remainingMonths: 3,
          refundAmount: 897,
          originalAmount: 3588,
          monthlyPrice: 299,
        }),
      })
    );
  });

  it('已有退款紀錄 → insert 不觸發，alreadyRefunded=true（1.5-6）', async () => {
    const ptCheck = createQueryMock({ data: [{ id: 'refund-001' }], error: null });

    const supabase = {
      from: vi.fn().mockReturnValue(ptCheck),
    };

    const result = await processRefundInDB(supabase as any, {
      subscriptionId: 'sub-001',
      userId: 'user-001',
      refundAmount: 897,
    });

    expect(result.success).toBe(true);
    expect(result.alreadyRefunded).toBe(true);
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(ptCheck.insert).not.toHaveBeenCalled();
  });

  it('payment_transactions.insert 失敗 → 回傳 error，success=false', async () => {
    const ptCheck = createQueryMock({ data: [], error: null });
    const ptOriginalTx = createQueryMock({ data: null, error: null });
    const ptInsert = createQueryMock({ data: null, error: { message: 'DB insert failed' } });

    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(ptCheck)
        .mockReturnValueOnce(ptOriginalTx)
        .mockReturnValueOnce(ptInsert),
    };

    const result = await processRefundInDB(supabase as any, {
      subscriptionId: 'sub-001',
      userId: 'user-001',
      refundAmount: 897,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('DB insert failed');
  });

  it('refundAmount > originalTx.amount → cappedRefundAmount = originalTx.amount（cap 上限邏輯）', async () => {
    const ptCheck = createQueryMock({ data: [], error: null });
    const ptOriginalTx = createQueryMock({
      data: { id: 'tx-002', provider_id: null, provider_tx_id: null, amount: 3588 },
      error: null,
    });
    const ptInsert = createQueryMock({ data: null, error: null });
    const auditInsert = createQueryMock({ data: null, error: null });

    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(ptCheck)
        .mockReturnValueOnce(ptOriginalTx)
        .mockReturnValueOnce(ptInsert)
        .mockReturnValueOnce(auditInsert),
    };

    const result = await processRefundInDB(supabase as any, {
      subscriptionId: 'sub-002',
      userId: 'user-002',
      refundAmount: 9999, // 遠大於原始金額
    });

    expect(result.success).toBe(true);
    expect(result.cappedRefundAmount).toBe(3588); // cap 在原始金額
    expect(ptInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -3588 }) // 寫入的是 cap 後的金額
    );
  });

  it('audit_logs.insert 失敗 → 仍回傳 success（audit 為非關鍵步驟）', async () => {
    const ptCheck = createQueryMock({ data: [], error: null });
    const ptOriginalTx = createQueryMock({ data: null, error: null });
    const ptInsert = createQueryMock({ data: null, error: null });
    const auditInsert = createQueryMock({ data: null, error: { message: 'audit failed' } });

    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(ptCheck)
        .mockReturnValueOnce(ptOriginalTx)
        .mockReturnValueOnce(ptInsert)
        .mockReturnValueOnce(auditInsert),
    };

    const result = await processRefundInDB(supabase as any, {
      subscriptionId: 'sub-003',
      userId: 'user-003',
      refundAmount: 299,
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });
});

// ── drift-detection ───────────────────────────────────────────────────────────

describe('drift-detection: Edge Functions 使用共用 _shared/refundProcessor.ts', () => {
  it('process-refund 從 _shared/refundProcessor.ts import processRefundInDB', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/process-refund/index.ts'),
      'utf-8',
    );
    expect(src).toContain('../_shared/refundProcessor.ts');
    expect(src).toContain('processRefundInDB');
  });

  it("Account.tsx import cancelSubscriptionInDB 並呼叫 invoke('process-refund')", () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/app/Account.tsx'),
      'utf-8',
    );
    expect(src).toContain('cancelSubscriptionInDB');
    // 年繳退款透過 edge function 寫入，確認串接點不漂移
    expect(src).toContain("invoke('process-refund'");
  });
});

// ── drift-detection: process-refund Edge Function 安全守衛 ────────────────────

describe('drift-detection: process-refund/index.ts 安全守衛邏輯', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/process-refund/index.ts'),
      'utf-8',
    );
  });

  it('JWT 驗證：缺少或格式錯誤的 Authorization header → 401（ISSUE-008 前置守衛）', () => {
    expect(src).toContain('authHeader?.startsWith("Bearer ")');
  });

  it('必填欄位驗證：subscription_id 或 refund_amount 缺少 → 400', () => {
    expect(src).toContain('!subscription_id || refund_amount === undefined');
  });

  it('負數退款金額守衛：refund_amount < 0 → 400（ISSUE-008 server-side validation）', () => {
    expect(src).toContain('refund_amount < 0');
  });

  it('訂閱 ownership 驗證：sub.user_id !== userId → 403，防止跨用戶退款', () => {
    expect(src).toContain('sub.user_id !== userId');
  });

  it('helper 失敗映射：!result.success → HTTP 500 回應', () => {
    expect(src).toContain('!result.success');
    expect(src).toContain('status: 500');
  });
});
