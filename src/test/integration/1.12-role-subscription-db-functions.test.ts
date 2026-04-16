/**
 * Group 1.12 — 角色與訂閱狀態 DB 函數
 *
 * 測試範圍：
 *   checkUserRole / checkIsSubscribedToPlan / fetchActiveSubscriptions
 *   （src/lib/roleSubscriptionChecks.ts）：
 *
 *   驗證三個 SECURITY DEFINER RPC 函數的呼叫參數正確性與結果轉換邏輯。
 *   DB 端函數定義（SELECT EXISTS / RETURNS TABLE 邏輯與關鍵 WHERE 條件）由
 *   drift-detection 確認 migration SQL 中包含完整安全條件字串。
 *
 *   函數本身定義：
 *     has_role                → migration 20260224015609
 *     is_subscribed_to_plan / has_active_subscription → migration 20260412111243
 *
 *   函數套用於 production policy / trigger：
 *     has_role → protect_subscription_fields / protect_profile_fields trigger → migration 20260412101307
 *     has_role → notifications INSERT policy                                 → migration 20260304075747
 *     has_role → audit_logs INSERT policy                                    → migration 20260412112114
 *     has_active_subscription → experts SELECT RLS                           → migration 20260409043138
 *     has_active_subscription → trade_records SELECT RLS                     → migration 20260304131143
 *
 * 對應測試路徑：
 *   3.1-1 ~ 3.1-4：has_role 四種情境
 *   3.2-1 ~ 3.2-5：is_subscribed_to_plan / has_active_subscription 五種情境
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  checkUserRole,
  checkIsSubscribedToPlan,
  fetchActiveSubscriptions,
} from '@/lib/roleSubscriptionChecks';

const USER_A = 'user-a-uuid';
const PLAN_1 = 'plan-1-uuid';
const PLAN_2 = 'plan-2-uuid';
const EXPERT_1 = 'expert-1-uuid';
const EXPERT_2 = 'expert-2-uuid';

// ── checkUserRole（has_role）─────────────────────────────────────────────────

describe('checkUserRole（has_role DB 函數）', () => {
  it('company_admin 角色存在 → hasRole=true，rpc 以正確函數名與參數呼叫（3.1-1）', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc };

    const result = await checkUserRole(supabase as any, USER_A, 'company_admin');

    expect(result.hasRole).toBe(true);
    expect(result.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith('has_role', { _user_id: USER_A, _role: 'company_admin' });
  });

  it('company_admin 角色不存在（無此角色）→ hasRole=false（3.1-2）', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const supabase = { rpc };

    const result = await checkUserRole(supabase as any, USER_A, 'company_admin');

    expect(result.hasRole).toBe(false);
    expect(result.error).toBeNull();
  });

  it('analyst 角色存在 → hasRole=true，rpc 以正確函數名與參數呼叫（3.1-3）', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc };

    const result = await checkUserRole(supabase as any, USER_A, 'analyst');

    expect(result.hasRole).toBe(true);
    expect(result.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith('has_role', { _user_id: USER_A, _role: 'analyst' });
  });

  it('analyst 角色不存在（一般會員）→ hasRole=false（3.1-4）', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const supabase = { rpc };

    const result = await checkUserRole(supabase as any, USER_A, 'analyst');

    expect(result.hasRole).toBe(false);
    expect(result.error).toBeNull();
  });

  it('DB 查詢失敗 → hasRole=false，回傳 error message', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc error' } });
    const supabase = { rpc };

    const result = await checkUserRole(supabase as any, USER_A, 'company_admin');

    expect(result.hasRole).toBe(false);
    expect(result.error).toBe('rpc error');
  });
});

// ── checkIsSubscribedToPlan（is_subscribed_to_plan）──────────────────────────

describe('checkIsSubscribedToPlan（is_subscribed_to_plan DB 函數）', () => {
  it('有效訂閱（status=active 且未到期）→ isSubscribed=true，rpc 以正確參數呼叫（3.2-1）', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc };

    const result = await checkIsSubscribedToPlan(supabase as any, USER_A, PLAN_1);

    expect(result.isSubscribed).toBe(true);
    expect(result.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith('is_subscribed_to_plan', {
      _user_id: USER_A,
      _plan_id: PLAN_1,
    });
  });

  it('DB 函數回傳 false（過期 / 取消 / 未訂閱三種情況均由 DB 函數處理，JS 層結果等效）→ isSubscribed=false（3.2-2/3/4）', async () => {
    // 三種 DB 狀態（expires_at 過期、status=canceled、從未存在）在 SQL 層均回傳 false。
    // JS 封裝層的行為相同，具體區分由 is_subscribed_to_plan drift test 保護。
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const supabase = { rpc };

    const result = await checkIsSubscribedToPlan(supabase as any, USER_A, PLAN_1);

    expect(result.isSubscribed).toBe(false);
    expect(result.error).toBeNull();
  });

  it('DB 查詢失敗 → isSubscribed=false，回傳 error message', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc error' } });
    const supabase = { rpc };

    const result = await checkIsSubscribedToPlan(supabase as any, USER_A, PLAN_1);

    expect(result.isSubscribed).toBe(false);
    expect(result.error).toBe('rpc error');
  });
});

// ── fetchActiveSubscriptions（has_active_subscription）───────────────────────

describe('fetchActiveSubscriptions（has_active_subscription DB 函數）', () => {
  it('同時訂閱兩方案 → 回傳兩筆 {plan_id, expert_id}（3.2-5）', async () => {
    const mockData = [
      { plan_id: PLAN_1, expert_id: EXPERT_1 },
      { plan_id: PLAN_2, expert_id: EXPERT_2 },
    ];
    const rpc = vi.fn().mockResolvedValue({ data: mockData, error: null });
    const supabase = { rpc };

    const result = await fetchActiveSubscriptions(supabase as any, USER_A);

    expect(result.error).toBeNull();
    expect(result.subscriptions).toHaveLength(2);
    expect(result.subscriptions[0]).toEqual({ plan_id: PLAN_1, expert_id: EXPERT_1 });
    expect(result.subscriptions[1]).toEqual({ plan_id: PLAN_2, expert_id: EXPERT_2 });
    expect(rpc).toHaveBeenCalledWith('has_active_subscription', { _user_id: USER_A });
  });

  it('無任何有效訂閱 → subscriptions=[]', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const supabase = { rpc };

    const result = await fetchActiveSubscriptions(supabase as any, USER_A);

    expect(result.error).toBeNull();
    expect(result.subscriptions).toEqual([]);
  });

  it('DB 查詢失敗 → subscriptions=[]，回傳 error message', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc error' } });
    const supabase = { rpc };

    const result = await fetchActiveSubscriptions(supabase as any, USER_A);

    expect(result.subscriptions).toEqual([]);
    expect(result.error).toBe('rpc error');
  });
});

// ── drift-detection：函數定義完整性 ──────────────────────────────────────────

describe('drift-detection: has_role / is_subscribed_to_plan / has_active_subscription 函數定義', () => {
  it('has_role 以 SECURITY DEFINER 定義，查詢 user_roles 表（migration 20260224015609）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260224015609_a67cee41-e47f-4e55-aaf0-a9e405d295b7.sql'),
      'utf-8',
    );
    expect(src).toContain('has_role');
    expect(src).toContain('SECURITY DEFINER');
    expect(src).toContain('user_roles');
  });

  it('is_subscribed_to_plan 包含 status=active 與 expires_at IS NULL OR expires_at > now() 精確條件（migration 20260412111243）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412111243_2c84247d-20fc-4ad1-bee0-6bf4b3ecfb4d.sql'),
      'utf-8',
    );
    expect(src).toContain('is_subscribed_to_plan');
    expect(src).toContain("status = 'active'");
    expect(src).toContain('expires_at IS NULL OR expires_at > now()');
  });

  it('has_active_subscription 包含 user_id / status=active / expires_at IS NULL OR expires_at > now() 核心 WHERE 條件（migration 20260412111243）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412111243_2c84247d-20fc-4ad1-bee0-6bf4b3ecfb4d.sql'),
      'utf-8',
    );
    expect(src).toContain('has_active_subscription');
    expect(src).toContain('RETURNS TABLE');
    expect(src).toContain('ms.user_id = _user_id');
    expect(src).toContain("ms.status = 'active'");
    expect(src).toContain('ms.expires_at IS NULL OR ms.expires_at > now()');
  });
});

// ── drift-detection：函數套用於 production policy / trigger ──────────────────

describe('drift-detection: has_role / has_active_subscription 套用於 production policy / trigger', () => {
  it('has_role 被套用於 protect_subscription_fields / protect_profile_fields trigger admin bypass（migration 20260412101307）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412101307_5d0ba83a-fdfe-41c0-afef-15e331194efe.sql'),
      'utf-8',
    );
    expect(src).toContain('has_role');
    expect(src).toContain('protect_subscription_fields');
    expect(src).toContain('protect_profile_fields');
    expect(src).toContain('company_admin');
  });

  it('has_role 被套用於 notifications INSERT policy WITH CHECK（migration 20260304075747）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260304075747_b0cda80a-6164-43cf-9d02-e7f735daba33.sql'),
      'utf-8',
    );
    expect(src).toContain('has_role');
    expect(src).toContain('notifications');
    expect(src).toContain('company_admin');
  });

  it('has_role 被套用於 audit_logs INSERT policy WITH CHECK（migration 20260412112114）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412112114_5fddb8a2-c61d-442d-88cd-56b32d7896cb.sql'),
      'utf-8',
    );
    expect(src).toContain('has_role');
    expect(src).toContain('audit_logs');
    expect(src).toContain('company_admin');
  });

  it('has_active_subscription 被套用於 experts SELECT RLS policy（migration 20260409043138）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260409043138_b1b797e2-4d62-46d2-b7aa-ca71859f4d4e.sql'),
      'utf-8',
    );
    expect(src).toContain('has_active_subscription');
    expect(src).toContain('experts');
  });

  it('has_active_subscription 被套用於 trade_records SELECT RLS policy（migration 20260304131143）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260304131143_df409e7b-6da9-489f-bdb5-9f07ba7011c5.sql'),
      'utf-8',
    );
    expect(src).toContain('has_active_subscription');
    expect(src).toContain('trade_records');
  });
});
