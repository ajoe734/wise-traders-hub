/**
 * useChipsAutoBackfill — reducer 接上 React 副作用的整合測試（C3）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChipsAutoBackfill } from '@/checkup/hooks/useChipsAutoBackfill';
import { AUTO_BACKFILL_TIMEOUT_MS } from '@/checkup/lib/chipsBackfillMachine';

function setup(overrides: Record<string, unknown> = {}) {
  const requestBackfill = vi.fn();
  const onTimeout = vi.fn();
  const base = {
    stockCode: '2330',
    hasData: true,
    sparse: true,
    eligible: true,
    syncStatus: 'idle',
    satisfied: false,
    requestBackfill,
    onTimeout,
    ...overrides,
  };
  const view = renderHook((props: typeof base) => useChipsAutoBackfill(props), {
    initialProps: base,
  });
  return { ...view, requestBackfill, onTimeout, base };
}

describe('useChipsAutoBackfill', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('稀疏時自動排入一次並停在 triggered', () => {
    const { result, requestBackfill, rerender, base } = setup();
    expect(requestBackfill).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('triggered');

    act(() => rerender({ ...base }));
    expect(requestBackfill).toHaveBeenCalledTimes(1);
  });

  it('不符條件時不排入', () => {
    const { result, requestBackfill } = setup({ syncStatus: 'running' });
    expect(requestBackfill).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });

  it('補滿後轉 ready，且逾時計時器被清掉不會誤報', () => {
    const { result, rerender, base, onTimeout } = setup();
    act(() => rerender({ ...base, satisfied: true, sparse: false }));
    expect(result.current.phase).toBe('ready');
    act(() => vi.advanceTimersByTime(AUTO_BACKFILL_TIMEOUT_MS + 1000));
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('30 分鐘未補滿 → timeout 並回報 elapsed', () => {
    const { result, onTimeout } = setup();
    act(() => vi.advanceTimersByTime(AUTO_BACKFILL_TIMEOUT_MS));
    expect(result.current.phase).toBe('timeout');
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout.mock.calls[0][0].stockCode).toBe('2330');
    expect(onTimeout.mock.calls[0][0].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('換股後重置 phase，新股票各自排一次、切回不重排', () => {
    const { result, rerender, base, requestBackfill } = setup();
    act(() => rerender({ ...base, stockCode: '2454' }));
    expect(requestBackfill).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('triggered');

    act(() => rerender({ ...base, stockCode: '2330' }));
    expect(requestBackfill).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('idle');
  });

  it('沒有股票代號時完全不動作', () => {
    const { result, requestBackfill } = setup({ stockCode: null });
    expect(requestBackfill).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });
});
