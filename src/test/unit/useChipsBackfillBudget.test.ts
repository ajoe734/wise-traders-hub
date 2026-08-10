/**
 * useChipsBackfill：module-level 去重 + attempt budget。
 * lazy 回補只是 fallback，抽屜反覆開關不得造成 job storm。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const invoke = vi.fn();
const rpc = vi.fn();

vi.mock('@/checkup/lib/gateway', () => ({
  getCheckupGateway: () => ({ invoke, rpc }),
}));

import {
  useChipsBackfill,
  __resetChipsBackfillBudget,
  MAX_ATTEMPTS_PER_STOCK,
} from '@/checkup/hooks/useChipsBackfill';

describe('useChipsBackfill budget', () => {
  beforeEach(() => {
    __resetChipsBackfillBudget();
    invoke.mockReset().mockResolvedValue({ ok: true });
    rpc.mockReset().mockResolvedValue(5);
  });
  afterEach(() => __resetChipsBackfillBudget());

  it('同一檔最多送 MAX_ATTEMPTS_PER_STOCK 次，超出回 budget_exhausted 且不再打後端', async () => {
    const { result } = renderHook(() => useChipsBackfill('3017'));
    for (let i = 0; i < MAX_ATTEMPTS_PER_STOCK; i += 1) {
      await act(async () => { await result.current.requestBackfill(); });
    }
    expect(rpc).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_STOCK);

    let last: unknown;
    await act(async () => { last = await result.current.requestBackfill(); });
    expect(last).toMatchObject({ ok: false, skipped: 'budget_exhausted' });
    expect(rpc).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_STOCK);
  });

  it('預算跨元件掛載共用：重新掛載不會重置', async () => {
    const a = renderHook(() => useChipsBackfill('4583'));
    await act(async () => { await a.result.current.requestBackfill(); });
    a.unmount();

    const b = renderHook(() => useChipsBackfill('4583'));
    await act(async () => { await b.result.current.requestBackfill(); });
    let third: unknown;
    await act(async () => { third = await b.result.current.requestBackfill(); });

    expect(third).toMatchObject({ skipped: 'budget_exhausted' });
    expect(rpc).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_STOCK);
  });

  it('in-flight 期間的第二次呼叫回 in_flight，不重複打後端', async () => {
    let release!: (v: unknown) => void;
    rpc.mockImplementation(() => new Promise((r) => { release = r; }));
    invoke.mockImplementation(() => new Promise((r) => { setTimeout(() => r({}), 0); }));

    const { result } = renderHook(() => useChipsBackfill('6862'));
    let firstPromise!: Promise<unknown>;
    act(() => { firstPromise = result.current.requestBackfill() as Promise<unknown>; });

    let second: unknown;
    await act(async () => { second = await result.current.requestBackfill(); });
    expect(second).toMatchObject({ skipped: 'in_flight' });
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => { release(3); await firstPromise; });
  });

  it('不同代號各自獨立計算預算', async () => {
    const a = renderHook(() => useChipsBackfill('1503'));
    const b = renderHook(() => useChipsBackfill('1717'));
    await act(async () => { await a.result.current.requestBackfill(); });
    await act(async () => { await b.result.current.requestBackfill(); });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('沒有代號時回 null，不打後端', async () => {
    const { result } = renderHook(() => useChipsBackfill(null));
    let r: unknown = 'x';
    await act(async () => { r = await result.current.requestBackfill(); });
    expect(r).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
