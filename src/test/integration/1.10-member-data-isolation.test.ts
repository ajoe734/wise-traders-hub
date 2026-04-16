/**
 * Group 1.10 — 會員個資隔離 RLS
 *
 * 測試範圍：
 *   fetchMemberProfile / fetchMemberSubscriptions / fetchMemberNotifications
 *   （src/lib/memberDataAccess.ts）：
 *
 *   驗證 client 端查詢函數正確以 user_id 過濾資料。
 *   DB 端 RLS（user_id = auth.uid()）在 Vitest Mock 層無法直接測試，
 *   由 drift-detection 確認 migration 中政策存在。
 *
 *   隔離語意：
 *   - 會員 A 查自己的資料 → mock 回傳資料，驗證 eq('user_id', userA) 被呼叫
 *   - 會員 A 查會員 B（不同 userId）→ mock 模擬 RLS 空集，驗證查詢條件正確傳遞
 *
 * 對應測試路徑：
 *   2.4-1：會員 A 查自己的 profiles → 回傳個人資料
 *   2.4-2：會員 A 查會員 B 的 profiles → 空集（RLS mock）
 *   2.4-3：會員 A 查自己的 member_subscriptions → 回傳訂閱資料
 *   2.4-4：會員 A 查會員 B 的 member_subscriptions → 空集（RLS mock）
 *   2.4-5：會員 A 查自己的 notifications → 回傳通知資料
 *   2.4-6：會員 A 查會員 B 的 notifications → 空集（RLS mock）
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createQueryMock } from '@/test/mocks/supabase';
import {
  fetchMemberProfile,
  fetchMemberSubscriptions,
  fetchMemberNotifications,
} from '@/lib/memberDataAccess';

// ── fetchMemberProfile ────────────────────────────────────────────────────────

describe('fetchMemberProfile（會員個人資料查詢）', () => {
  it('會員 A 查自己的 profiles → eq(user_id, userA)，回傳個人資料（2.4-1）', async () => {
    const profileMock = createQueryMock({
      data: { id: 'p-1', user_id: 'user-a', display_name: '會員甲' },
      error: null,
    });
    const supabase = { from: vi.fn().mockReturnValue(profileMock) };

    const result = await fetchMemberProfile(supabase as any, 'user-a');

    expect(result.error).toBeNull();
    expect(result.profile).not.toBeNull();
    expect(result.profile?.user_id).toBe('user-a');
    expect(profileMock.eq).toHaveBeenCalledWith('user_id', 'user-a');
  });

  it('會員 A 查會員 B 的 profiles → DB 端 RLS 過濾回空集（2.4-2）', async () => {
    const profileMock = createQueryMock({ data: null, error: null }); // RLS 返回 null
    const supabase = { from: vi.fn().mockReturnValue(profileMock) };

    const result = await fetchMemberProfile(supabase as any, 'user-b');

    expect(result.profile).toBeNull();
    // 確認 eq 被呼叫為 user-b（查詢本身正確，RLS 在 DB 層過濾）
    expect(profileMock.eq).toHaveBeenCalledWith('user_id', 'user-b');
  });

  it('DB 查詢失敗 → 回傳 error，profile=null', async () => {
    const profileMock = createQueryMock({ data: null, error: { message: 'profiles error' } });
    const supabase = { from: vi.fn().mockReturnValue(profileMock) };

    const result = await fetchMemberProfile(supabase as any, 'user-a');

    expect(result.error).toBe('profiles error');
    expect(result.profile).toBeNull();
  });
});

// ── fetchMemberSubscriptions ──────────────────────────────────────────────────

describe('fetchMemberSubscriptions（會員訂閱查詢）', () => {
  it('會員 A 查自己的 member_subscriptions → eq(user_id, userA)，回傳訂閱資料（2.4-3）', async () => {
    const subsMock = createQueryMock({
      data: [
        { id: 'sub-1', user_id: 'user-a', plan_id: 'plan-1', status: 'active' },
        { id: 'sub-2', user_id: 'user-a', plan_id: 'plan-2', status: 'active' },
      ],
      error: null,
    });
    const supabase = { from: vi.fn().mockReturnValue(subsMock) };

    const result = await fetchMemberSubscriptions(supabase as any, 'user-a');

    expect(result.error).toBeNull();
    expect(result.subscriptions).toHaveLength(2);
    expect(subsMock.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(subsMock.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('會員 A 查會員 B 的 member_subscriptions → DB 端 RLS 過濾回空集（2.4-4）', async () => {
    const subsMock = createQueryMock({ data: [], error: null }); // RLS 返回空
    const supabase = { from: vi.fn().mockReturnValue(subsMock) };

    const result = await fetchMemberSubscriptions(supabase as any, 'user-b');

    expect(result.subscriptions).toEqual([]);
    expect(subsMock.eq).toHaveBeenCalledWith('user_id', 'user-b');
  });

  it('DB 查詢失敗 → 回傳 error，subscriptions=[]', async () => {
    const subsMock = createQueryMock({ data: null, error: { message: 'subscriptions error' } });
    const supabase = { from: vi.fn().mockReturnValue(subsMock) };

    const result = await fetchMemberSubscriptions(supabase as any, 'user-a');

    expect(result.error).toBe('subscriptions error');
    expect(result.subscriptions).toEqual([]);
  });
});

// ── fetchMemberNotifications ──────────────────────────────────────────────────

describe('fetchMemberNotifications（會員通知查詢）', () => {
  it('會員 A 查自己的 notifications → eq(user_id, userA)，回傳通知資料（2.4-5）', async () => {
    const notifMock = createQueryMock({
      data: [
        { id: 'n-1', user_id: 'user-a', title: '訂閱成功', is_read: false },
        { id: 'n-2', user_id: 'user-a', title: '訊號更新', is_read: true },
      ],
      error: null,
    });
    const supabase = { from: vi.fn().mockReturnValue(notifMock) };

    const result = await fetchMemberNotifications(supabase as any, 'user-a');

    expect(result.error).toBeNull();
    expect(result.notifications).toHaveLength(2);
    expect(notifMock.eq).toHaveBeenCalledWith('user_id', 'user-a');
  });

  it('會員 A 查會員 B 的 notifications → DB 端 RLS 過濾回空集（2.4-6）', async () => {
    const notifMock = createQueryMock({ data: [], error: null }); // RLS 返回空
    const supabase = { from: vi.fn().mockReturnValue(notifMock) };

    const result = await fetchMemberNotifications(supabase as any, 'user-b');

    expect(result.notifications).toEqual([]);
    expect(notifMock.eq).toHaveBeenCalledWith('user_id', 'user-b');
  });

  it('DB 查詢失敗 → 回傳 error，notifications=[]', async () => {
    const notifMock = createQueryMock({ data: null, error: { message: 'notifications error' } });
    const supabase = { from: vi.fn().mockReturnValue(notifMock) };

    const result = await fetchMemberNotifications(supabase as any, 'user-a');

    expect(result.error).toBe('notifications error');
    expect(result.notifications).toEqual([]);
  });
});

// ── drift-detection ───────────────────────────────────────────────────────────

describe('drift-detection: 會員個資隔離 RLS 政策存在於 migration SQL', () => {
  it('profiles 有 "Users can view own profile" 政策（user_id = auth.uid()）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260224015609_a67cee41-e47f-4e55-aaf0-a9e405d295b7.sql'),
      'utf-8',
    );
    expect(src).toContain('Users can view own profile');
    expect(src).toContain('auth.uid() = user_id');
  });

  it('member_subscriptions 有 "Users can view own subscriptions" 政策（user_id = auth.uid()）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260225013857_f8ddcb3b-2bdc-4b53-a51d-92da134bbf8f.sql'),
      'utf-8',
    );
    expect(src).toContain('Users can view own subscriptions');
    expect(src).toContain('user_id = auth.uid()');
  });

  it('notifications 有 "Users can view own notifications" 政策（user_id = auth.uid()）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260304075729_e36a0e97-eadf-4fee-9536-fd2272221ee1.sql'),
      'utf-8',
    );
    expect(src).toContain('Users can view own notifications');
    expect(src).toContain('user_id = auth.uid()');
  });

  it('drift: useSubscriptions.ts 使用 fetchMemberSubscriptions（防止 user_id 過濾被繞過）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/hooks/useSubscriptions.ts'),
      'utf-8',
    );
    expect(src).toContain('fetchMemberSubscriptions');
    expect(src).toContain('@/lib/memberDataAccess');
  });

  it('drift: NotificationBell.tsx 使用 fetchMemberNotifications（防止 notifications user_id 過濾被繞過）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/NotificationBell.tsx'),
      'utf-8',
    );
    expect(src).toContain('fetchMemberNotifications');
    expect(src).toContain('@/lib/memberDataAccess');
  });

  it('drift: AuthContext.tsx profiles 查詢有 eq(user_id, userId) 過濾（唯一 profile 讀取路徑守護）', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/contexts/AuthContext.tsx'),
      'utf-8',
    );
    expect(src).toContain(".from('profiles')");
    expect(src).toContain(".eq('user_id', userId)");
  });
});
