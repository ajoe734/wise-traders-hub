/**
 * Group 1.17 — 訂閱生命週期狀態機
 *
 * 測試範圍：
 *
 *   A. cancelSubscriptionInDB（src/lib/cancelSubscription.ts）：
 *      主動取消的狀態轉換 — 月繳保留 expires_at，年繳截斷至本月底。
 *        4.3-3：月繳取消 → canceled_at 設定，refundAmount=0
 *        4.3-3：年繳取消 → canceled_at + expires_at 截斷，refundAmount>0
 *        4.3-3：DB 錯誤 → error 不為 null
 *
 *   B. extendSubscriptionExpiry（src/lib/subscriptionRenewal.ts）：
 *      自動續約後延長到期日的精確計算。
 *        4.3-4：月繳續約 2026-01-15 → expires_at 延至 2026-02-15
 *        4.3-4：年繳續約 2026-01-15 → expires_at 延至 2027-01-15
 *        4.3-4：找不到 active 訂閱 → error 不為 null
 *
 *   C. drift-detection：
 *      confirm-linepay + ecpay-callback → createSubscriptionAndTransaction（4.3-1）
 *      expire-subscriptions：canceled_at 分類邏輯 + LINE 綁定停用（4.3-2）
 *      auto-cancel-failed-renewals + subscriptionRenewal.ts：
 *        processRenewalCancellations 設 canceled_at，status 由 expire-subscriptions 完成（4.3-5）
 *      protect_subscription_fields trigger：
 *        阻擋 status 與 expires_at 直接修改（4.3-6）
 *
 * 對應測試路徑：
 *   4.3-1：新訂閱建立 started_at/expires_at 精確時間戳
 *   4.3-2：月繳到期排程 → status active → expired
 *   4.3-3：主動取消 → status active → canceled、canceled_at = now
 *   4.3-4：自動續約成功 → expires_at 延長至下月同日同時
 *   4.3-5：連續扣款失敗自動取消 → status → canceled
 *   4.3-6：已過期訂閱不可重新啟用 → UPDATE status='active' 被阻擋
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createQueryMock } from '@/test/mocks/supabase';
import { cancelSubscriptionInDB } from '@/lib/cancelSubscription';
import { extendSubscriptionExpiry } from '../../../supabase/functions/_shared/subscriptionRenewal';

// ── cancelSubscriptionInDB（主動取消路徑 4.3-3）────────────────────────────────

describe('cancelSubscriptionInDB（主動取消路徑 4.3-3）', () => {
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockSupabase: { from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockFrom = vi.fn().mockReturnValue(createQueryMock({ data: null, error: null }));
    mockSupabase = { from: mockFrom };
  });

  it('月繳取消 → refund.isYearly=false、refundAmount=0、error=null、payload 不含 expires_at（4.3-3）', async () => {
    let capturedPayload: Record<string, unknown> = {};
    const mockChain: any = {
      update: vi.fn().mockImplementation((p: any) => { capturedPayload = { ...p }; return mockChain; }),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(resolve({ data: null, error: null })),
    };
    mockFrom.mockReturnValue(mockChain);

    const sub = {
      id: 'sub-001',
      started_at: '2026-02-15T00:00:00.000Z',
      expires_at: '2026-03-15T00:00:00.000Z', // 28 天 < 180 天 → 月繳
      plan: { price_monthly: 99900, price_yearly: null },
    };
    const now = new Date('2026-03-01T00:00:00.000Z');

    const result = await cancelSubscriptionInDB(mockSupabase as any, sub, 'user-001', now);

    expect(result.error).toBeNull();
    expect(result.refund.isYearly).toBe(false);
    expect(result.refund.refundAmount).toBe(0);
    expect(capturedPayload.expires_at).toBeUndefined();
  });

  it('年繳取消 → refund.isYearly=true、refundAmount>0、error=null、payload.expires_at 截斷至本月底（4.3-3）', async () => {
    let capturedPayload: Record<string, unknown> = {};
    const mockChain: any = {
      update: vi.fn().mockImplementation((p: any) => { capturedPayload = { ...p }; return mockChain; }),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(resolve({ data: null, error: null })),
    };
    mockFrom.mockReturnValue(mockChain);

    const sub = {
      id: 'sub-002',
      started_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2027-01-01T00:00:00.000Z', // 365 天 > 180 天 → 年繳
      plan: { price_monthly: 99900, price_yearly: 1079100 },
    };
    const now = new Date('2026-03-15T00:00:00.000Z');

    const result = await cancelSubscriptionInDB(mockSupabase as any, sub, 'user-002', now);

    expect(result.error).toBeNull();
    expect(result.refund.isYearly).toBe(true);
    expect(result.refund.refundAmount).toBeGreaterThan(0);
    // now = 2026-03-15 UTC → nowTW = 2026-03-15 08:00 UTC+8 → 本月底 = 3/31 23:59:59.999 UTC+8 → UTC = 2026-03-31T15:59:59.999Z
    expect(capturedPayload.expires_at).toBe('2026-03-31T15:59:59.999Z');
  });

  it('DB 錯誤 → result.error 不為 null（4.3-3 error path）', async () => {
    mockFrom.mockReturnValue(
      createQueryMock({ data: null, error: { message: 'DB connection failed' } }),
    );
    const sub = {
      id: 'sub-003',
      started_at: '2026-02-15T00:00:00.000Z',
      expires_at: '2026-03-15T00:00:00.000Z',
      plan: { price_monthly: 99900, price_yearly: null },
    };

    const result = await cancelSubscriptionInDB(mockSupabase as any, sub, 'user-003', new Date());

    expect(result.error).toBe('DB connection failed');
  });
});

// ── extendSubscriptionExpiry（自動續約延期 4.3-4）─────────────────────────────

describe('extendSubscriptionExpiry（自動續約延期 4.3-4）', () => {
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockSupabase: { from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockFrom = vi.fn();
    mockSupabase = { from: mockFrom };
  });

  it('月繳續約：2026-01-15 → expires_at 延至 2026-02-15（4.3-4）', async () => {
    // 使用正午 UTC（12:00Z）確保在所有時區中日期不跨月
    const activeSub = { id: 'sub-001', expires_at: '2026-01-15T12:00:00.000Z' };
    mockFrom
      .mockReturnValueOnce(createQueryMock({ data: activeSub, error: null }))
      .mockReturnValueOnce(createQueryMock({ data: null, error: null }));

    const result = await extendSubscriptionExpiry(mockSupabase as any, {
      userId: 'user-001',
      planId: 'plan-001',
      billingCycle: 'monthly',
      now: new Date(),
    });

    expect(result.error).toBeNull();
    expect(result.newExpiresAt).toBe('2026-02-15T12:00:00.000Z');
  });

  it('年繳續約：2026-01-15 → expires_at 延至 2027-01-15（4.3-4）', async () => {
    const activeSub = { id: 'sub-001', expires_at: '2026-01-15T12:00:00.000Z' };
    mockFrom
      .mockReturnValueOnce(createQueryMock({ data: activeSub, error: null }))
      .mockReturnValueOnce(createQueryMock({ data: null, error: null }));

    const result = await extendSubscriptionExpiry(mockSupabase as any, {
      userId: 'user-001',
      planId: 'plan-001',
      billingCycle: 'yearly',
      now: new Date(),
    });

    expect(result.error).toBeNull();
    expect(result.newExpiresAt).toBe('2027-01-15T12:00:00.000Z');
  });

  it('找不到 active 訂閱 → error 不為 null、subscriptionId 為 null（4.3-4 error path）', async () => {
    mockFrom.mockReturnValue(
      createQueryMock({ data: null, error: { message: 'No subscription found' } }),
    );

    const result = await extendSubscriptionExpiry(mockSupabase as any, {
      userId: 'user-999',
      planId: 'plan-999',
      billingCycle: 'monthly',
      now: new Date(),
    });

    expect(result.error).not.toBeNull();
    expect(result.subscriptionId).toBeNull();
  });

  it('UPDATE DB 錯誤 → error 不為 null、subscriptionId 仍被填入、newExpiresAt 為 null（4.3-4 update error）', async () => {
    const activeSub = { id: 'sub-001', expires_at: '2026-01-15T12:00:00.000Z' };
    mockFrom
      .mockReturnValueOnce(createQueryMock({ data: activeSub, error: null }))
      .mockReturnValueOnce(createQueryMock({ data: null, error: { message: 'Update failed' } }));

    const result = await extendSubscriptionExpiry(mockSupabase as any, {
      userId: 'user-001',
      planId: 'plan-001',
      billingCycle: 'monthly',
      now: new Date(),
    });

    expect(result.error).toBe('Update failed');
    expect(result.subscriptionId).toBe('sub-001');
    expect(result.newExpiresAt).toBeNull();
  });
});

// ── drift-detection: 訂閱生命週期各節點 ─────────────────────────────────────

describe('drift-detection: 訂閱生命週期各節點', () => {
  it('confirm-linepay 呼叫 createSubscriptionAndTransaction 建立訂閱（4.3-1）', () => {
    const entry = readFileSync(
      resolve(process.cwd(), 'supabase/functions/confirm-linepay/index.ts'),
      'utf-8',
    );
    // 邏輯已抽到 _shared/linepayConfirm.ts（單一資料源），entry 只做轉呼叫
    expect(entry).toContain('../_shared/linepayConfirm.ts');
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/linepayConfirm.ts'),
      'utf-8',
    );
    expect(src).toContain('createSubscriptionAndTransaction');
  });

  it('ecpay-callback 呼叫 createSubscriptionAndTransaction 建立訂閱（4.3-1）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/ecpay-callback/index.ts'),
      'utf-8',
    );
    expect(src).toContain('createSubscriptionAndTransaction');
  });

  it('paymentProcessor.ts 包含 started_at 賦值與月/年 expires_at 計算（4.3-1）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/paymentProcessor.ts'),
      'utf-8',
    );
    expect(src).toContain('started_at');
    expect(src).toContain('setMonth(');
    expect(src).toContain('setFullYear(');
  });

  it('expire-subscriptions 依 canceled_at 分類：有值 → status canceled；無值 → status expired（4.3-2）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/expire-subscriptions/index.ts'),
      'utf-8',
    );
    expect(src).toContain('canceled_at');
    expect(src).toContain('"canceled"');
    expect(src).toContain('"expired"');
  });

  it('expire-subscriptions 訂閱到期後停用 LINE 綁定（is_active: false）（4.3-2）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/expire-subscriptions/index.ts'),
      'utf-8',
    );
    expect(src).toContain('member_line_bindings');
    expect(src).toContain('is_active: false');
  });

  it('auto-cancel-failed-renewals 已停用為 410 stub（4.3-5 改採手動續訂後過期斷權交給 expire-subscriptions）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/auto-cancel-failed-renewals/index.ts'),
      'utf-8',
    );
    expect(src).toContain('DEPRECATED');
    expect(src).toMatch(/status:\s*410/);
    expect(src).not.toContain('processRenewalCancellations');
  });

  it('processRenewalCancellations 設定 canceled_at 而不直接改 status，status 由 expire-subscriptions 完成（4.3-5）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/subscriptionRenewal.ts'),
      'utf-8',
    );
    expect(src).toContain('canceled_at');
    // status 不在 processRenewalCancellations 的 update payload 中
    expect(src).not.toContain("status: 'canceled'");
  });

  it('protect_subscription_fields trigger 阻擋 NEW.status 直接修改（4.3-6）', () => {
    const src = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260412101307_5d0ba83a-fdfe-41c0-afef-15e331194efe.sql',
      ),
      'utf-8',
    );
    expect(src).toContain('NEW.status IS DISTINCT FROM OLD.status');
    expect(src).toContain('You cannot modify subscription status');
  });

  it('protect_subscription_fields trigger 阻擋 NEW.expires_at 直接修改（4.3-6）', () => {
    const src = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260412101307_5d0ba83a-fdfe-41c0-afef-15e331194efe.sql',
      ),
      'utf-8',
    );
    expect(src).toContain('NEW.expires_at IS DISTINCT FROM OLD.expires_at');
    expect(src).toContain('You cannot modify subscription expiry');
  });

  it('useAccountData 主動取消路徑呼叫 cancelSubscriptionInDB（4.3-3）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/hooks/app/useAccountData.ts'),
      'utf-8',
    );
    expect(src).toContain('cancelSubscriptionInDB');
  });

  it('acpay-recurring-notify 呼叫 extendSubscriptionExpiry 延長 expires_at（4.3-4）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/acpay-recurring-notify/index.ts'),
      'utf-8',
    );
    expect(src).toContain('extendSubscriptionExpiry');
  });
});
