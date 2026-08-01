// 抽屜籌碼：新鮮度 + 版本化失效（候選 A/E 後）
//   - 取數走 chipsRepository，快取走 TanStack Query
//   - 過期時先問 stamp 探針；stamp 沒變 → 不下載 payload，只重置新鮮度
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const textMock = vi.fn();

vi.mock('../../lib/gateway', () => ({
  getCheckupGateway: () => ({
    functionsUrl: () => 'https://fn.test',
    http: { text: (...a: any[]) => textMock(...a) },
  }),
}));
vi.mock('@/lib/trafficTracker', () => ({ trackEvent: vi.fn() }));

import { useTwChipsDetail, AUTO_MAX_FAILURES } from '../useTwChipsDetail';

const PAYLOAD = {
  stock_id: '2330',
  as_of: '2026-07-31',
  institutional: { d1: null, d5: null, d20: null, d60: null },
  bsr: { d5: null, d20: null, d60: null },
  bsr_as_of: null,
  _cache_meta: { cache: 'miss', stamp_ver: '2026-07-31:t1|2026-07-31' },
};

let stampVer = '2026-07-31:t1|2026-07-31';

const payloadCalls = () => textMock.mock.calls.filter((c) => !String(c[0]).includes('stamp_only')).length;
const stampCalls = () => textMock.mock.calls.filter((c) => String(c[0]).includes('stamp_only')).length;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('抽屜籌碼新鮮度', () => {
  beforeEach(() => {
    textMock.mockReset();
    stampVer = '2026-07-31:t1|2026-07-31';
    textMock.mockImplementation(async (url: string) =>
      String(url).includes('stamp_only')
        ? JSON.stringify({ stock_id: '2330', stamp_ver: stampVer, chips_as_of: null, inst_as_of: null })
        : JSON.stringify(PAYLOAD),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('提供隨時鐘推進的 ageMs，讓「更新於 N 分鐘前」不會凍住', async () => {
    const { result } = renderHook(() => useTwChipsDetail('2330', true), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    const first = result.current.ageMs ?? 0;

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000); });

    expect((result.current.ageMs ?? 0) - first).toBeGreaterThanOrEqual(2 * 60 * 1000);
    // 3 分鐘未過 TTL → 不該重抓 payload
    expect(payloadCalls()).toBe(1);
  });

  it('過期時 stamp 沒變 → 不下載 payload，只把 stale 收回 false', async () => {
    const { result } = renderHook(() => useTwChipsDetail('2317', true), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(payloadCalls()).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });

    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(payloadCalls()).toBe(1);
    expect(stampCalls()).toBeGreaterThan(0);
    expect(result.current.autoState).toBe('idle');
  });

  it('stamp 變了 → 立刻重抓完整 payload', async () => {
    const { result } = renderHook(() => useTwChipsDetail('2454', true), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(payloadCalls()).toBe(1);

    stampVer = '2026-08-01:t2|2026-08-01';
    await act(async () => { await vi.advanceTimersByTimeAsync(70 * 1000); });

    await waitFor(() => expect(payloadCalls()).toBe(2));
  });

  it('分頁在背景時暫停自動重抓，回到前景立刻補抓', async () => {
    const { result } = renderHook(() => useTwChipsDetail('2603', true), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());

    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const baseline = stampCalls();
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });

    expect(result.current.autoState).toBe('paused');
    expect(stampCalls()).toBe(baseline);

    spy.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(stampCalls()).toBeGreaterThan(baseline));
    spy.mockRestore();
  });


  it('自動重抓連續失敗會退避，達上限後停手改由使用者手動', async () => {
    const { result } = renderHook(() => useTwChipsDetail('3008', true), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());

    textMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    for (let i = 0; i < AUTO_MAX_FAILURES + 2; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });
    }

    await waitFor(() => expect(result.current.autoState).toBe('exhausted'));
    const callsAtStop = textMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
    expect(textMock.mock.calls.length).toBe(callsAtStop);
  });
});
