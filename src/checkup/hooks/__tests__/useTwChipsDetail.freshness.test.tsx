// Phase 1 feedback loop（/skill:diagnosing-bugs）：抽屜「資料新鮮度」
// 症狀：抽屜開著不動，`stale` 與「更新於 N 分鐘前」是 render 期用 Date.now() 算的，
// 沒有 ticker → 時間過去也不會 re-render，使用者永遠看到剛開抽屜那一刻的新鮮度。
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


import { useTwChipsDetail } from '../useTwChipsDetail';

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

  it('抽屜開著超過 TTL 後，stale 會自己翻成 true（不需任何互動）', async () => {
    const { result } = renderHook(() => useTwChipsDetail('2330', true));
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.stale).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });

    expect(result.current.stale).toBe(true);
  });

  it('提供隨時鐘推進的 ageMs，讓「更新於 N 分鐘前」不會凍住', async () => {
    const { result } = renderHook(() => useTwChipsDetail('2330', true));
    await waitFor(() => expect(result.current.data).toBeTruthy());
    const first = result.current.ageMs ?? 0;

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000); });

    expect((result.current.ageMs ?? 0) - first).toBeGreaterThanOrEqual(2 * 60 * 1000);
  });
});
