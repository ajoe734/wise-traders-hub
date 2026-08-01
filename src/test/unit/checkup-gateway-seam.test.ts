/**
 * Checkup Gateway seam 守衛 + hook 層整合測試。
 *
 * 契約（ADR-0004）：
 *  1. `src/checkup/hooks/**` 與 `src/checkup/components/**`（含持倉抽屜 freecheckup）
 *     不得直接 `fetch()`、不得 import supabase client、
 *     不得直接 `functions.invoke()` / `.rpc()` —— 一律走 `getCheckupGateway()`。
 *  2. `src/checkup/lib|contexts/**` 尚有既存直連檔，以 LEGACY 白名單凍結，只能變少不能變多。
 *  3. 換上 fake gateway 後，hook 的對外握手可被完整攔截與斷言，
 *     測試環境不會有任何真實網路 / DB 呼叫。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  createFakeGateway,
  setCheckupGateway,
  resetCheckupGateway,
  type FakeGateway,
} from '@/checkup/lib/gateway';

const HOOKS_DIR = 'src/checkup/hooks';
/** 受守衛區：hooks + 所有 checkup 元件（持倉抽屜 freecheckup 在此） */
const GUARDED_DIRS = [HOOKS_DIR, 'src/checkup/components'];
/** 觀察區：仍有既存直連的目錄，靠白名單凍結 */
const LEGACY_DIRS = ['src/checkup/lib', 'src/checkup/contexts'];
/** 只有 gateway adapter 自己可以碰 supabase client / fetch */
const GATEWAY_IMPL = 'src/checkup/lib/gateway';

/**
 * 既存直連檔白名單（技術債，只能變少）。
 * 新增檔案一律不得加進來 —— 請改走 getCheckupGateway()。
 */
const LEGACY_DIRECT_CLIENTS = [
  'src/checkup/contexts/CheckupModeContext.jsx',
  'src/checkup/lib/authoritativeQuotes.ts',
  'src/checkup/lib/edgeInvoke.js',
  'src/checkup/lib/knowledgeBase.js',
  'src/checkup/lib/missingPriceClient.js',
];

const RE_SUPABASE_CLIENT = /from\s+['"][^'"]*integrations\/supabase\/client/;
const RE_FETCH = /(^|[^.\w])fetch\s*\(/;
const RE_INVOKE = /functions\s*\.\s*invoke\s*\(/;
const RE_RPC = /(^|[^\w])(supabase|client)\s*\.\s*rpc\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
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

const norm = (p: string) => p.split('\\').join('/');
const guardedFiles = GUARDED_DIRS.flatMap((d) => walk(d)).map(norm);
const legacyFiles = LEGACY_DIRS.flatMap((d) => walk(d))
  .map(norm)
  .filter((f) => !f.startsWith(GATEWAY_IMPL));
const offenders = (files: string[], re: RegExp) =>
  files.filter((f) => re.test(readFileSync(f, 'utf8')));

describe('gateway seam · 靜態守衛（hooks + 元件）', () => {
  it('掃描到所有 checkup hooks 與元件', () => {
    expect(walk(HOOKS_DIR).length).toBeGreaterThan(40);
    expect(guardedFiles.filter((f) => f.includes('/components/freecheckup/')).length).toBeGreaterThan(10);
  });

  it('沒有任何 hook / 元件直接 import supabase client', () => {
    expect(offenders(guardedFiles, RE_SUPABASE_CLIENT)).toEqual([]);
  });

  it('沒有任何 hook / 元件直接呼叫 fetch()', () => {
    expect(offenders(guardedFiles, RE_FETCH)).toEqual([]);
  });

  it('沒有任何 hook / 元件直接呼叫 functions.invoke()', () => {
    expect(offenders(guardedFiles, RE_INVOKE)).toEqual([]);
  });

  it('沒有任何 hook / 元件直接呼叫 supabase.rpc()', () => {
    expect(offenders(guardedFiles, RE_RPC)).toEqual([]);
  });

  it('持倉抽屜籌碼面的回補握手走 gateway hook', () => {
    // 候選 C：元件只認 useChipsLifecycle，回補 hook 由生命週期模組持有。
    const src = readFileSync('src/checkup/components/freecheckup/ChipsSection.tsx', 'utf8');
    expect(src).toContain('useChipsLifecycle');
    const lifecycle = readFileSync('src/checkup/hooks/useChipsLifecycle.ts', 'utf8');
    expect(lifecycle).toContain('useChipsBackfill');
    const hook = readFileSync('src/checkup/hooks/useChipsBackfill.ts', 'utf8');
    expect(hook).toContain('getCheckupGateway()');
    expect(hook).toContain("gateway.rpc<number>('enqueue_bsr_backfill'");
    expect(hook).toContain("gateway.invoke('tw-institutional-daily-sync'");
  });


  it('有握手行為的 hook 都取得 gateway', () => {
    const users = walk(HOOKS_DIR).filter((f) =>
      readFileSync(f, 'utf8').includes('getCheckupGateway()'),
    );
    // 14 個原本直接握手的 hook + useChipsBackfill；
    // useTwChipsDetail 的握手已下沉到 lib/chipsRepository.ts（候選 A 的唯一取數 seam）。
    expect(users.length).toBeGreaterThanOrEqual(14);
    expect(readFileSync('src/checkup/lib/chipsRepository.ts', 'utf8')).toContain('getCheckupGateway()');
  });

});

describe('gateway seam · legacy 白名單（只能變少）', () => {
  it('lib / contexts 的直連 supabase client 檔案未增加', () => {
    const found = offenders(legacyFiles, RE_SUPABASE_CLIENT).sort();
    const unexpected = found.filter((f) => !LEGACY_DIRECT_CLIENTS.includes(f));
    expect(unexpected).toEqual([]);
  });

  it('白名單沒有殘留已修好的項目', () => {
    const found = new Set(offenders(legacyFiles, RE_SUPABASE_CLIENT));
    const stale = LEGACY_DIRECT_CLIENTS.filter((f) => !found.has(f));
    expect(stale).toEqual([]);
  });
});

describe('gateway seam · hook 整合', () => {
  let fake: FakeGateway;

  beforeEach(() => {
    fake = createFakeGateway({
      http: {
        'checkup-analyze': { content: [{ text: '[]' }] },
        'checkup-brain': { content: [] },
        'checkup-research': { reports: [] },
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
