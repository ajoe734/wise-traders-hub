/**
 * 投組加權估值指數 —— 自動更新排程（PORTFOLIO_VALUATION_AUTOREFRESH_V1）回歸測試。
 *
 * 鎖死行為：
 *   1. 固定間隔會背景重抓 RPC。
 *   2. 分頁隱藏時不打 RPC。
 *   3. 分頁重新可見且距上次成功 >= 5 分鐘時補抓。
 *   4. 背景重抓失敗不清空既有數字（status 維持 ready）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  usePortfolioValuation,
  PORTFOLIO_VALUATION_REFRESH_MS,
  PORTFOLIO_VALUATION_VISIBLE_STALE_MS,
} from '@/checkup/hooks/usePortfolioValuation';

const HOLDINGS = [{ code: '2330', value: 1000 }];

function snapshotRow() {
  return {
    symbol: '2330',
    asOf: '2026-09-18',
    pe: 12,
    pb: 3,
    dividendYield: 2,
    peers: [
      { symbol: 'A', pe: 8, pb: 2, dividendYield: 1 },
      { symbol: 'B', pe: 10, pb: 3, dividendYield: 2 },
      { symbol: 'C', pe: 12, pb: 4, dividendYield: 3 },
      { symbol: 'D', pe: 14, pb: 5, dividendYield: 4 },
      { symbol: 'E', pe: 16, pb: 6, dividendYield: 5 },
    ],
  };
}

function fakeGateway(impl: () => any) {
  const rpc = vi.fn(async () => impl());
  return { gateway: { rpc } as any, rpc };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('usePortfolioValuation 自動更新排程', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('固定間隔會背景重抓一次', async () => {
    const { gateway, rpc } = fakeGateway(() => [snapshotRow()]);
    const { result } = renderHook(() =>
      usePortfolioValuation(HOLDINGS, { injectedGateway: gateway }),
    );
    await act(async () => { await Promise.resolve(); });
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(PORTFOLIO_VALUATION_REFRESH_MS);
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  });

  it('分頁隱藏時不打 RPC', async () => {
    const { gateway, rpc } = fakeGateway(() => [snapshotRow()]);
    renderHook(() => usePortfolioValuation(HOLDINGS, { injectedGateway: gateway }));
    await act(async () => { await Promise.resolve(); });
    expect(rpc).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    await act(async () => {
      vi.advanceTimersByTime(PORTFOLIO_VALUATION_REFRESH_MS * 3);
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('分頁重新可見且距上次成功超過門檻時補抓', async () => {
    let now = 1_000_000;
    const { gateway, rpc } = fakeGateway(() => [snapshotRow()]);
    renderHook(() =>
      usePortfolioValuation(HOLDINGS, { injectedGateway: gateway, now: () => now }),
    );
    await act(async () => { await Promise.resolve(); });
    expect(rpc).toHaveBeenCalledTimes(1);

    now += PORTFOLIO_VALUATION_VISIBLE_STALE_MS + 1;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('剛抓過就切回分頁不會重複打 RPC', async () => {
    let now = 1_000_000;
    const { gateway, rpc } = fakeGateway(() => [snapshotRow()]);
    renderHook(() =>
      usePortfolioValuation(HOLDINGS, { injectedGateway: gateway, now: () => now }),
    );
    await act(async () => { await Promise.resolve(); });

    now += 1000;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('背景重抓失敗時保留既有數字，不打成錯誤態', async () => {
    let fail = false;
    const { gateway } = fakeGateway(() => {
      if (fail) throw new Error('network down');
      return [snapshotRow()];
    });
    const { result } = renderHook(() =>
      usePortfolioValuation(HOLDINGS, { injectedGateway: gateway }),
    );
    await act(async () => { await Promise.resolve(); });
    const before = result.current.result;
    expect(result.current.status).toBe('ready');

    fail = true;
    await act(async () => {
      vi.advanceTimersByTime(PORTFOLIO_VALUATION_REFRESH_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.result).toEqual(before);
  });
});
