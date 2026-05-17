/**
 * Integration test — React Query 快取在 list ⇄ detail 切換的一致性。
 *
 * 對應的快取契約 (src/hooks/useExpert.ts)：
 *  1. useExperts 的結果會被 useExpert.initialData 拾取 →
 *     從 list 進 detail 應「立刻」拿到資料，不需要等 fetch。
 *  2. useExpert 完成後會 mergeExpertIntoListCaches() →
 *     從 detail 回 list 應該看到 detail 拿回來的最新欄位。
 *  3. staleTime = 5 分鐘 → unmount/remount 同一個 query 在 staleTime
 *     之內不會重打 supabase（驗證透過 fetch 計數）。
 *
 * 這些 invariants 之前曾分別在不同 PR 被打破過（30s staleTime、
 * detail 缺 back-propagation），因此把它們鎖在同一支整合測試裡。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---- AuthContext: 固定回傳一個訪客，避免實際 supabase auth 動作 ----
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, isLoading: false }),
}));

// ---- supabase client mock：只支援 from('experts').select(...).order/.eq ----
const expertRow = (over: Partial<any> = {}) => ({
  id: 'e-alpha',
  slug: 'alpha',
  name: 'Alpha Advisor',
  role: 'advisor',
  status: 'active',
  avatar_url: null,
  bio: '',
  description: '',
  style_tags: [],
  markets: [],
  strategy_summary: '',
  expert_plans: [],
  ...over,
});

// 計數 + 可控回傳值
const expertsFetches: { list: number; detail: number } = { list: 0, detail: 0 };
const detailFetchesBySlug: Record<string, number> = {};
let listRows: any[] = [];
let detailRows: any[] = [];
let detailRowsBySlug: Record<string, any[]> | null = null;

function buildExpertsBuilder() {
  return {
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockImplementation(async () => {
        expertsFetches.list += 1;
        return { data: listRows, error: null };
      }),
      eq: vi.fn().mockImplementation(async (_col: string, val: string) => {
        expertsFetches.detail += 1;
        detailFetchesBySlug[val] = (detailFetchesBySlug[val] || 0) + 1;
        const rows = detailRowsBySlug ? (detailRowsBySlug[val] || []) : detailRows;
        return { data: rows, error: null };
      }),
    }),
  };
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'experts') return buildExpertsBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
  },
}));

import { useExperts, useExpert } from '@/hooks/useExpert';

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // 與 production queryClient 對齊；本檔依賴 5min staleTime
        staleTime: 5 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
      },
    },
  });
}

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  expertsFetches.list = 0;
  expertsFetches.detail = 0;
  for (const k of Object.keys(detailFetchesBySlug)) delete detailFetchesBySlug[k];
  listRows = [expertRow()];
  detailRows = [expertRow()];
  detailRowsBySlug = null;
});

describe('Expert cache continuity — list ⇄ detail', () => {
  it('list → detail：useExpert 透過 initialData 立即拿到資料，'
    + 'detail fetch 仍會在背景補打但不會阻塞 UI', async () => {
    const qc = makeQC();
    const w = wrapper(qc);

    const list = renderHook(() => useExperts(), { wrapper: w });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(expertsFetches.list).toBe(1);

    // 進 detail：應該 *同步* 命中 initialData，第一個 render 已經有 data
    const detail = renderHook(() => useExpert('alpha'), { wrapper: w });
    expect(detail.result.current.data?.slug).toBe('alpha');

    // 因為 initialDataUpdatedAt = list 的 dataUpdatedAt，且 staleTime = 5min，
    // detail 在 staleTime 內被視為 fresh → 不應觸發 detail fetch。
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(expertsFetches.detail).toBe(0);
  });

  it('detail → list：useExpert 拿到較新資料後會 merge 回 list cache，'
    + '回到 useExperts 不會 refetch 且看到 merge 後的欄位', async () => {
    const qc = makeQC();
    const w = wrapper(qc);

    // detail 提供「更新後」的 bio，list 之後應該看到這個 bio
    detailRows = [expertRow({ bio: 'updated-from-detail' })];

    const detail = renderHook(() => useExpert('alpha'), { wrapper: w });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(detail.result.current.data?.bio).toBe('updated-from-detail');
    expect(expertsFetches.detail).toBe(1);

    // 現在打 useExperts。注意：list cache 一開始是空的，所以這次「會」打一次 list。
    const list = renderHook(() => useExperts(), { wrapper: w });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(expertsFetches.list).toBe(1);

    // 重點：mergeExpertIntoListCaches 在 list fetch 回來之後仍應確保
    // 後續 list cache 反映 detail 拿到的較新欄位。
    // 我們手動觸發一次 detail re-fetch（透過 invalidate）以驗證 merge 路徑生效。
    detailRows = [expertRow({ bio: 'updated-again' })];
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['expert', 'alpha'] });
    });
    await waitFor(() =>
      expect(detail.result.current.data?.bio).toBe('updated-again')
    );

    // list cache 應該已被 back-propagation 同步到最新 bio
    const cachedLists = qc.getQueriesData<any[]>({ queryKey: ['experts'] });
    const found = cachedLists.flatMap(([, v]) => (Array.isArray(v) ? v : []))
      .find((p) => p?.slug === 'alpha');
    expect(found?.bio).toBe('updated-again');
  });

  it('unmount / remount 同一 query 在 staleTime 內不會 refetch', async () => {
    const qc = makeQC();
    const w = wrapper(qc);

    const a = renderHook(() => useExperts(), { wrapper: w });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    expect(expertsFetches.list).toBe(1);

    a.unmount();

    const b = renderHook(() => useExperts(), { wrapper: w });
    // 立刻就有 data（cache 命中）
    expect(b.result.current.data?.length).toBe(1);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(expertsFetches.list).toBe(1); // 沒有第 2 次 fetch
  });
});

/**
 * 模擬「在 SPA 內切換頁面」：list → detail(A) → list → detail(A) → detail(B)。
 * 每次「進新頁面」用 renderHook + unmount 表示，queryClient 跨頁面共用。
 *
 * 在 5min staleTime 內：
 *   - 重進 list / 重進已看過的 detail → 0 次新 fetch（cache hit）
 *   - 第一次進新 slug 的 detail → 因為 list cache 有 row，initialData 命中
 *     且因 staleTime 仍 fresh，不應觸發 detail fetch
 */
describe('Expert cache 在頁面切換中持續命中（5 min staleTime）', () => {
  it('list → detail(A) → list → detail(A) 全程只 fetch list 一次', async () => {
    const qc = makeQC();
    const w = wrapper(qc);

    listRows = [expertRow({ slug: 'alpha' }), expertRow({ id: 'e-beta', slug: 'beta', name: 'Beta' })];

    // 1) 開 list
    const list1 = renderHook(() => useExperts(), { wrapper: w });
    await waitFor(() => expect(list1.result.current.isSuccess).toBe(true));
    expect(expertsFetches.list).toBe(1);
    list1.unmount();

    // 2) 進 detail(A) — 應 initialData 命中，無 detail fetch
    const detailA1 = renderHook(() => useExpert('alpha'), { wrapper: w });
    expect(detailA1.result.current.data?.slug).toBe('alpha');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(detailFetchesBySlug.alpha || 0).toBe(0);
    detailA1.unmount();

    // 3) 回 list — staleTime 內 cache hit
    const list2 = renderHook(() => useExperts(), { wrapper: w });
    expect(list2.result.current.data?.length).toBe(2);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(expertsFetches.list).toBe(1);
    list2.unmount();

    // 4) 再進 detail(A) — 仍是 cache hit
    const detailA2 = renderHook(() => useExpert('alpha'), { wrapper: w });
    expect(detailA2.result.current.data?.slug).toBe('alpha');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(detailFetchesBySlug.alpha || 0).toBe(0);
    expect(expertsFetches.list).toBe(1);
  });

  it('detail(A) → detail(B) — list cache 有 B 時 B 走 initialData 不打 detail', async () => {
    const qc = makeQC();
    const w = wrapper(qc);

    listRows = [expertRow({ slug: 'alpha' }), expertRow({ id: 'e-beta', slug: 'beta', name: 'Beta' })];

    // 先預熱 list
    const list = renderHook(() => useExperts(), { wrapper: w });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    list.unmount();

    // detail(A)
    const da = renderHook(() => useExpert('alpha'), { wrapper: w });
    expect(da.result.current.data?.slug).toBe('alpha');
    da.unmount();

    // detail(B) — 也應從 list cache 拿到 initialData
    const db = renderHook(() => useExpert('beta'), { wrapper: w });
    expect(db.result.current.data?.slug).toBe('beta');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(detailFetchesBySlug.alpha || 0).toBe(0);
    expect(detailFetchesBySlug.beta || 0).toBe(0);
    expect(expertsFetches.list).toBe(1);
  });

  it('staleTime 過期後重進頁面才會 refetch（用 invalidate 模擬時間流逝）', async () => {
    const qc = makeQC();
    const w = wrapper(qc);

    const list1 = renderHook(() => useExperts(), { wrapper: w });
    await waitFor(() => expect(list1.result.current.isSuccess).toBe(true));
    expect(expertsFetches.list).toBe(1);
    list1.unmount();

    // staleTime 內重進：cache hit
    const list2 = renderHook(() => useExperts(), { wrapper: w });
    expect(list2.result.current.data?.length).toBe(1);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(expertsFetches.list).toBe(1);
    list2.unmount();

    // 模擬 staleTime 過期 — invalidate 強制視為 stale
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['experts'] });
    });

    const list3 = renderHook(() => useExperts(), { wrapper: w });
    await waitFor(() => expect(expertsFetches.list).toBe(2));
    list3.unmount();
  });
});
