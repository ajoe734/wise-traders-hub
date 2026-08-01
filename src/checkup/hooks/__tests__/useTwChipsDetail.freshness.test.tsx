// Phase 1 feedback loop（/skill:diagnosing-bugs）：抽屜「資料新鮮度」＋過期自動重抓
// 症狀 1：抽屜開著不動，`stale` 是 render 期用 Date.now() 算的，沒有 ticker → 永遠凍住。
// 症狀 2：即使判定過期，也沒有任何機制去重抓，使用者只能自己按重新整理。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

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
};

describe('抽屜籌碼新鮮度', () => {
  beforeEach(() => {
    textMock.mockReset();
    textMock.mockResolvedValue(JSON.stringify(PAYLOAD));
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('提供隨時鐘推進的 ageMs，讓「更新於 N 分鐘前」不會凍住', async () => {
    const { result } = renderHook(() => useTwChipsDetail('2330', true));
    await waitFor(() => expect(result.current.data).toBeTruthy());
    const first = result.current.ageMs ?? 0;

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000); });

    expect((result.current.ageMs ?? 0) - first).toBeGreaterThanOrEqual(2 * 60 * 1000);
    // 3 分鐘未過 TTL → 不該自動重抓
    expect(textMock).toHaveBeenCalledTimes(1);
  });

  it('超過 TTL 會自動重抓，並把 stale 收回 false', async () => {
    const { result } = renderHook(() => useTwChipsDetail('2317', true));
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(textMock).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });

    await waitFor(() => expect(textMock).toHaveBeenCalledTimes(2));
    expect(result.current.stale).toBe(false);
    expect(result.current.autoState).toBe('idle');
  });

  it('分頁在背景時暫停自動重抓，回到前景立刻補抓', async () => {
    const { result } = renderHook(() => useTwChipsDetail('2454', true));
    await waitFor(() => expect(result.current.data).toBeTruthy());

    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });

    expect(result.current.autoState).toBe('paused');
    expect(textMock).toHaveBeenCalledTimes(1);

    spy.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(textMock).toHaveBeenCalledTimes(2));
    spy.mockRestore();
  });

  it('自動重抓連續失敗會退避，達上限後停手改由使用者手動', async () => {
    const { result } = renderHook(() => useTwChipsDetail('3008', true));
    await waitFor(() => expect(result.current.data).toBeTruthy());

    textMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });
    await waitFor(() => expect(result.current.error).toBeTruthy());

    // 退避推進：連續失敗到上限
    for (let i = 0; i < AUTO_MAX_FAILURES + 1; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });
    }

    expect(result.current.autoState).toBe('exhausted');
    const callsAtStop = textMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
    expect(textMock.mock.calls.length).toBe(callsAtStop);
  });
});
