/**
 * Checkup Gateway seam 守衛 + hook 層整合測試。
 *
 * 契約：
 *  1. `src/checkup/hooks/**`（測試除外）不得直接 `fetch()`，
 *     也不得 import supabase client —— 一律走 `getCheckupGateway()`。
 *  2. 換上 fake gateway 後，hook 的對外握手可被完整攔截與斷言，
 *     測試環境不會有任何真實網路 / DB 呼叫。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  createFakeGateway,
  setCheckupGateway,
  resetCheckupGateway,
  type FakeGateway,
} from '@/checkup/lib/gateway';

const HOOKS_DIR = 'src/checkup/hooks';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('gateway seam · 靜態守衛', () => {
  const files = walk(HOOKS_DIR);

  it('掃描到所有 checkup hooks', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('沒有任何 hook 直接 import supabase client', () => {
    const offenders = files.filter((f) =>
      /from\s+['"][^'"]*integrations\/supabase\/client/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('沒有任何 hook 直接呼叫 fetch()', () => {
    const offenders = files.filter((f) => /(^|[^.\w])fetch\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('有握手行為的 hook 都取得 gateway', () => {
    const users = files.filter((f) => readFileSync(f, 'utf8').includes('getCheckupGateway()'));
    // 14 個原本直接握手的 hook 全部改走 seam
    expect(users.length).toBeGreaterThanOrEqual(14);
  });
});

describe('gateway seam · hook 整合', () => {
  let fake: FakeGateway;

  beforeEach(() => {
    fake = createFakeGateway({
      http: {
        '/api/analyze': { content: [{ text: '[]' }] },
        '/api/brain': { content: [] },
        '/api/research': { reports: [] },
      },
      tables: {
        holding_meta_overrides: [{ code: '2330', industry: '半導體' }],
        target_price_history: [{ id: 1, firm: 'X', target: 1000 }],
      },
      userId: 'user-1',
    });
    setCheckupGateway(fake);
  });

  afterEach(() => {
    resetCheckupGateway();
    vi.restoreAllMocks();
  });

  it('useMetaOverrides 只透過 gateway 讀資料並訂閱 auth / realtime', async () => {
    const { useMetaOverrides } = await import('@/checkup/hooks/useMetaOverrides.js');
    const { result, unmount } = renderHook(() => useMetaOverrides());

    await waitFor(() => expect(result.current.overrides['2330']).toBeTruthy());
    expect(fake.calls.db.some((c) => c.table === 'holding_meta_overrides')).toBe(true);
    await waitFor(() => expect(fake.calls.realtime).toHaveLength(1));
    expect(fake.calls.realtime[0]).toMatchObject({
      table: 'holding_meta_overrides',
      filter: 'user_id=eq.user-1',
    });

    unmount();
    await waitFor(() => expect(fake.openSubscriptions()).toBe(0));
  });

  it('useTargetPriceHistory 走 gateway.db 並帶 user 條件', async () => {
    const mod = await import('@/checkup/hooks/useTargetPriceHistory.js');
    mod.invalidateTargetPriceHistoryCache();
    const { result } = renderHook(() => mod.useTargetPriceHistory('2330'));

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    const eqArgs = fake.calls.db.filter((c) => c.op === 'eq').map((c) => c.args);
    expect(eqArgs).toContainEqual(['user_id', 'user-1']);
    expect(eqArgs).toContainEqual(['code', '2330']);
  });

  it('api hook 的 http 呼叫可被攔截與斷言', async () => {
    const { useSaveHoldingsToCloud } = await import('@/checkup/hooks/api/useCloudSync.js');
    const { result } = renderHook(() => useSaveHoldingsToCloud(), { wrapper: QueryWrapper });

    await act(async () => {
      await (result.current.mutateAsync as any)({ portfolioId: 'me', holdings: [{ code: '2330' }] });
    });

    expect(fake.calls.http).toHaveLength(1);
    expect(fake.calls.http[0]).toMatchObject({
      method: 'POST',
      body: { action: 'save-holdings', data: { holdings: [{ code: '2330' }] } },
    });
  });

  it('http 失敗會以 CheckupGatewayError 冒泡到 hook', async () => {
    setCheckupGateway(createFakeGateway({ http: {} })); // 未註冊 → 失敗
    const { useSaveHoldingsToCloud } = await import('@/checkup/hooks/api/useCloudSync.js');
    const { result } = renderHook(() => useSaveHoldingsToCloud(), { wrapper: QueryWrapper });

    await expect(
      act(async () => {
        await (result.current.mutateAsync as any)({ portfolioId: 'me', holdings: [] });
      }),
    ).rejects.toMatchObject({ name: 'CheckupGatewayError' });
  });
});

// ── react-query wrapper ───────────────────────────────────────────────
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function QueryWrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
}
