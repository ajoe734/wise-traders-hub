/**
 * 守護 /app 不把「失敗 / 已到期 / 已取消」訂閱誤判為 ACTIVE。
 *
 * useMemberSubscriptions 是 /app 與 SubscribedExpertsList 的單一資料源 —
 * 它必須在 query 階段以 `status='active'` 過濾，
 * 並在 mapping 階段排除 expert.status !== 'active'。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock supabase client BEFORE importing the hook
const eqSpy = vi.fn();
const fromSpy = vi.fn();

vi.mock('@/integrations/supabase/client', () => {
  const resultPayload = {
    data: [
      {
        plan_id: 'p1',
        status: 'active',
        user_id: 'u1',
        expires_at: null,
        expert_plans: {
          plan_type: 'analyst_signal_l1',
          expert_id: 'e1',
          experts: {
            id: 'e1',
            slug: 'alice',
            name: 'Alice',
            avatar_url: null,
            role: 'advisor',
            status: 'active',
            line_oa_id: null,
            line_channel_name: null,
            qr_code_url: null,
          },
        },
      },
    ],
    error: null,
  };
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: string) => {
      eqSpy(col, val);
      return builder;
    }),
    // 現行 hook 在 .eq('status','active') 之後還會鏈一個 .or(...)，
    // 讓 .or 才回傳 thenable，避免中間吞掉。
    or: vi.fn(() => Promise.resolve(resultPayload)),
  };
  return {
    supabase: {
      from: (table: string) => {
        fromSpy(table);
        return builder;
      },
    },
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

// useMemberSubscriptions → useEffectiveUserId → useViewAs（需要 ViewAsProvider）。
// 單元測試不掛 provider，直接把 hook 打樁掉。
vi.mock('@/hooks/useEffectiveUserId', () => ({
  useEffectiveUserId: () => ({ userId: 'u1', isViewAs: false }),
}));

import { useMemberSubscriptions } from '@/hooks/useMemberSubscriptions';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useMemberSubscriptions — /app 不誤判失敗訂閱為 ACTIVE', () => {
  beforeEach(() => {
    eqSpy.mockClear();
    fromSpy.mockClear();
  });

  it('一律以 status=active 過濾，從來源拒絕 failed/expired/cancelled 訂閱', async () => {
    const { result } = renderHook(() => useMemberSubscriptions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 必須查詢 member_subscriptions 表
    expect(fromSpy).toHaveBeenCalledWith('member_subscriptions');

    // 必須有 .eq('status', 'active') — 這條是「不誤判失敗為 ACTIVE」的守門
    const statusFilter = eqSpy.mock.calls.find(([col]) => col === 'status');
    expect(statusFilter).toBeDefined();
    expect(statusFilter![1]).toBe('active');

    // 回傳資料應包含一筆 active expert
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].expert.slug).toBe('alice');
  });
});
