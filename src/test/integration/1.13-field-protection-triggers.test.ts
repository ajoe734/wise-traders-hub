/**
 * Group 1.13 — 欄位保護 Trigger
 *
 * 測試範圍：
 *   updateProfileFields（src/lib/profileFieldGuard.ts）：
 *     驗證 profiles 欄位更新函數正確傳遞 DB 端 trigger 拋出的錯誤，
 *     非敏感欄位更新正常回傳成功。
 *
 *   cancelSubscriptionInDB（src/lib/cancelSubscription.ts）：
 *     驗證年繳取消路徑設定 expires_at 時，若 DB trigger 阻擋，錯誤正確傳遞。
 *     月繳取消路徑不設 expires_at，trigger 放行，error=null。
 *
 *   DB 端 trigger 定義（RAISE EXCEPTION 條件）由 drift-detection 確認
 *   migration SQL 包含所有受保護欄位的錯誤訊息字串：
 *     protect_profile_fields       → is_tester / expert_slug（含 company_admin bypass）
 *     protect_subscription_fields  → status / expires_at / started_at / plan_id / provider_id
 *
 *   觸發器定義：migration 20260412101307
 *
 * 對應測試路徑：
 *   3.3-1：UPDATE profiles.is_tester → 被阻擋
 *   3.3-2：UPDATE profiles.expert_slug → 被阻擋
 *   3.3-3：UPDATE member_subscriptions.status → 被阻擋（drift）
 *   3.3-4：UPDATE member_subscriptions.expires_at → 被阻擋
 *   3.3-5：UPDATE profiles.display_name → 成功（非敏感欄位）
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createQueryMock } from '@/test/mocks/supabase';
import { updateProfileFields } from '@/lib/profileFieldGuard';
import { cancelSubscriptionInDB } from '@/lib/cancelSubscription';

const USER_A = 'user-a-uuid';
const SUB_ID = 'sub-uuid-1';

// ── updateProfileFields（protect_profile_fields trigger 錯誤傳遞）────────────

describe('updateProfileFields（protect_profile_fields trigger）', () => {
  it('嘗試更新 is_tester=true → DB trigger 拒絕 → 函數回傳 error message（3.3-1）', async () => {
    const profileMock = createQueryMock({
      data: null,
      error: { message: 'You cannot modify tester status' },
    });
    const supabase = { from: vi.fn().mockReturnValue(profileMock) };

    const result = await updateProfileFields(supabase as any, USER_A, { is_tester: true });

    expect(result.error).toBe('You cannot modify tester status');
    expect(supabase.from).toHaveBeenCalledWith('profiles');
  });

  it('嘗試更新 expert_slug → DB trigger 拒絕 → 函數回傳 error message（3.3-2）', async () => {
    const profileMock = createQueryMock({
      data: null,
      error: { message: 'You cannot modify expert slug' },
    });
    const supabase = { from: vi.fn().mockReturnValue(profileMock) };

    const result = await updateProfileFields(supabase as any, USER_A, { expert_slug: 'new-slug' });

    expect(result.error).toBe('You cannot modify expert slug');
    expect(supabase.from).toHaveBeenCalledWith('profiles');
  });

  it('更新 display_name → trigger 放行 → 函數回傳 error=null（成功）（3.3-5）', async () => {
    const profileMock = createQueryMock({ data: [{ display_name: '新名稱' }], error: null });
    const supabase = { from: vi.fn().mockReturnValue(profileMock) };

    const result = await updateProfileFields(supabase as any, USER_A, { display_name: '新名稱' });

    expect(result.error).toBeNull();
    expect(supabase.from).toHaveBeenCalledWith('profiles');
  });

  it('DB 回傳非 trigger 相關錯誤 → 錯誤訊息正確傳遞（邊界補充）', async () => {
    const profileMock = createQueryMock({
      data: null,
      error: { message: 'connection timeout' },
    });
    const supabase = { from: vi.fn().mockReturnValue(profileMock) };

    const result = await updateProfileFields(supabase as any, USER_A, { display_name: '測試' });

    expect(result.error).toBe('connection timeout');
  });
});

// ── cancelSubscriptionInDB（protect_subscription_fields trigger 互動）─────────

describe('cancelSubscriptionInDB（protect_subscription_fields trigger 互動）', () => {
  it('年繳取消：DB trigger 阻擋 expires_at 修改 → error 正確傳遞（3.3-4 production path）', async () => {
    // 模擬 DB 端 protect_subscription_fields trigger 阻擋非管理員修改 expires_at
    const subMock = createQueryMock({
      data: null,
      error: { message: 'You cannot modify subscription expiry' },
    });
    const supabase = { from: vi.fn().mockReturnValue(subMock) };

    const result = await cancelSubscriptionInDB(
      supabase as any,
      {
        id: SUB_ID,
        started_at: '2026-01-01T00:00:00Z',
        expires_at: '2027-01-01T00:00:00Z',
        plan: { price_monthly: 500, price_yearly: 5000 },
      },
      USER_A,
      new Date('2026-04-15T10:00:00Z'),
    );

    expect(result.error).toBe('You cannot modify subscription expiry');
  });

  it('月繳取消：不修改 expires_at → trigger 放行 → error=null（3.3-3 相關）', async () => {
    // 月繳取消 payload 不含 expires_at，trigger 不會觸發阻擋
    const subMock = createQueryMock({ data: [{ id: SUB_ID }], error: null });
    const supabase = { from: vi.fn().mockReturnValue(subMock) };

    const result = await cancelSubscriptionInDB(
      supabase as any,
      {
        id: SUB_ID,
        started_at: '2026-04-01T00:00:00Z',
        expires_at: '2026-05-01T00:00:00Z',
        plan: { price_monthly: 500, price_yearly: null },
      },
      USER_A,
      new Date('2026-04-15T10:00:00Z'),
    );

    expect(result.error).toBeNull();
    expect(supabase.from).toHaveBeenCalledWith('member_subscriptions');
  });
});

// ── drift-detection: protect_profile_fields trigger ─────────────────────────

describe('drift-detection: protect_profile_fields trigger（migration 20260412101307）', () => {
  const getMigration = () =>
    readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412101307_5d0ba83a-fdfe-41c0-afef-15e331194efe.sql'),
      'utf-8',
    );

  it('protect_profile_fields trigger 以 RAISE EXCEPTION 阻擋 is_tester 修改（3.3-1）', () => {
    const src = getMigration();
    expect(src).toContain('protect_profile_fields');
    expect(src).toContain('is_tester');
    expect(src).toContain('You cannot modify tester status');
  });

  it('protect_profile_fields trigger 以 RAISE EXCEPTION 阻擋 expert_slug 修改（3.3-2）', () => {
    const src = getMigration();
    expect(src).toContain('expert_slug');
    expect(src).toContain('You cannot modify expert slug');
  });

  it('trg_protect_profile_fields trigger 掛載於 profiles 資料表', () => {
    const src = getMigration();
    expect(src).toContain('trg_protect_profile_fields');
    expect(src).toContain('BEFORE UPDATE ON public.profiles');
  });

  it('protect_profile_fields company_admin bypass 存在（防止 bypass 被移除）', () => {
    const src = getMigration();
    // protect_profile_fields 在 migration 中排在 protect_subscription_fields 之後，
    // 以第一個出現位置向後截取即可涵蓋函數本體
    const profileFnStart = src.indexOf('CREATE OR REPLACE FUNCTION public.protect_profile_fields');
    const profileFnBody = src.slice(profileFnStart);
    expect(profileFnBody).toContain('has_role');
    expect(profileFnBody).toContain('company_admin');
    expect(profileFnBody).toContain('RETURN NEW');
  });

  it('drift: Profile.tsx import updateProfileFields（防止 profiles update 繞過 helper）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/account/Profile.tsx'),
      'utf-8',
    );
    expect(src).toContain('updateProfileFields');
  });
});

// ── drift-detection: protect_subscription_fields trigger ─────────────────────

describe('drift-detection: protect_subscription_fields trigger（migration 20260412101307）', () => {
  const getMigration = () =>
    readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260412101307_5d0ba83a-fdfe-41c0-afef-15e331194efe.sql'),
      'utf-8',
    );

  it('protect_subscription_fields trigger 以 RAISE EXCEPTION 阻擋 status 修改（3.3-3）', () => {
    const src = getMigration();
    expect(src).toContain('protect_subscription_fields');
    expect(src).toContain('You cannot modify subscription status');
  });

  it('protect_subscription_fields trigger 以 RAISE EXCEPTION 阻擋 expires_at 修改（3.3-4）', () => {
    const src = getMigration();
    expect(src).toContain('You cannot modify subscription expiry');
  });

  it('protect_subscription_fields trigger 以 RAISE EXCEPTION 阻擋 started_at 修改', () => {
    const src = getMigration();
    expect(src).toContain('You cannot modify subscription start date');
  });

  it('protect_subscription_fields trigger 以 RAISE EXCEPTION 阻擋 plan_id 修改', () => {
    const src = getMigration();
    expect(src).toContain('You cannot modify subscription plan');
  });

  it('protect_subscription_fields trigger 以 RAISE EXCEPTION 阻擋 provider_id 修改', () => {
    const src = getMigration();
    expect(src).toContain('You cannot modify payment provider');
  });

  it('trg_protect_subscription_fields trigger 掛載於 member_subscriptions 資料表', () => {
    const src = getMigration();
    expect(src).toContain('trg_protect_subscription_fields');
    expect(src).toContain('BEFORE UPDATE ON public.member_subscriptions');
  });

  it('company_admin bypass 存在：has_role 檢查允許管理員繞過欄位保護', () => {
    const src = getMigration();
    expect(src).toContain('has_role');
    expect(src).toContain('company_admin');
    expect(src).toContain('RETURN NEW');
  });

  it('drift: Account.tsx import cancelSubscriptionInDB（防止年繳取消路徑繞過 helper）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/pages/app/Account.tsx'),
      'utf-8',
    );
    expect(src).toContain('cancelSubscriptionInDB');
  });
});
