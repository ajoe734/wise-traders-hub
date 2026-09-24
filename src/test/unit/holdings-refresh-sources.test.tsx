/**
 * 持倉看板刷新根因修復回歸（2026-09-24）。
 *  - 報價造成市值變動：0 次估值 RPC。
 *  - 兩個估值實例同時掛載：共 1 次 RPC。
 *  - 代碼集合改變：只接受最新回應，舊回應晚到被丟棄。
 *  - pending_close 退避序列 1→2→5→15→30 分鐘。
 *  - 閒置 1／5／30 分鐘估值 RPC 次數符合 30 分鐘排程。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePortfolioValuation, PORTFOLIO_VALUATION_REFRESH_MS } from '@/checkup/hooks/usePortfolioValuation';
import { __resetPeerMediansCache, fetchPeerMedians, PEER_MEDIANS_MAX_ENTRIES, __peerMediansCacheSize } from '@/checkup/lib/peerMediansCache';
import { nextCloseRetryDelay } from '@/checkup/lib/closeAlignment';

const row = (symbol: string, asOf = '2026-09-23') => ({ symbol, asOf, pe: 10, pb: 2, dividendYield: 3, peers: [] });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('持倉刷新來源', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetPeerMediansCache();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('報價變動（市值改變）不重打估值 RPC', async () => {
    const rpc = vi.fn(async (_n: string, a: any) => a._symbols.map((s: string) => row(s)));
    const gw = { rpc } as any;
    const { rerender, result } = renderHook(({ h }) => usePortfolioValuation(h, { injectedGateway: gw }), {
      initialProps: { h: [{ code: '2330', value: 1000 }, { code: '2317', value: 500 }] },
    });
    await act(flush);
    expect(rpc).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 5; i++) {
      rerender({ h: [{ code: '2330', value: 1000 + i * 7 }, { code: '2317', value: 500 - i }] });
      await act(flush);
    }
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ready');
  });

  it('兩個實例同時掛載共用 1 次 RPC', async () => {
    const rpc = vi.fn(async (_n: string, a: any) => a._symbols.map((s: string) => row(s)));
    const gw = { rpc } as any;
    const h = [{ code: '2330', value: 1000 }];
    renderHook(() => usePortfolioValuation(h, { injectedGateway: gw }));
    renderHook(() => usePortfolioValuation(h, { injectedGateway: gw }));
    await act(flush);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('連續新增兩檔：舊回應晚到被丟棄', async () => {
    const resolvers: Array<() => void> = [];
    const rpc = vi.fn((_n: string, a: any) => new Promise<any[]>((res) => {
      resolvers.push(() => res(a._symbols.map((s: string) => row(s, s === '2454' ? '2026-09-20' : '2026-09-23'))));
    }));
    const gw = { rpc } as any;
    const { rerender, result } = renderHook(({ h }) => usePortfolioValuation(h, { injectedGateway: gw }), {
      initialProps: { h: [{ code: '2330', value: 1 }] as any[] },
    });
    rerender({ h: [{ code: '2330', value: 1 }, { code: '2317', value: 1 }] });
    rerender({ h: [{ code: '2330', value: 1 }, { code: '2317', value: 1 }, { code: '2454', value: 1 }] });
    expect(rpc).toHaveBeenCalledTimes(3);
    await act(async () => { resolvers[2](); await flush(); });
    expect(result.current.asOf).toBe('2026-09-20');
    await act(async () => { resolvers[0](); resolvers[1](); await flush(); });
    expect(result.current.asOf).toBe('2026-09-20');
    expect(result.current.result?.coverage ?? 1).toBeDefined();
  });

  it('閒置 1/5/30 分鐘：只有 30 分鐘時背景重抓一次', async () => {
    const rpc = vi.fn(async (_n: string, a: any) => a._symbols.map((s: string) => row(s)));
    renderHook(() => usePortfolioValuation([{ code: '2330', value: 1 }], { injectedGateway: { rpc } as any }));
    await act(flush);
    await act(async () => { vi.advanceTimersByTime(60_000); await flush(); });
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(4 * 60_000); await flush(); });
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(PORTFOLIO_VALUATION_REFRESH_MS - 5 * 60_000); await flush(); });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('快取有上限', async () => {
    const rpc = vi.fn(async () => []);
    const gw = { rpc } as any;
    for (let i = 0; i < PEER_MEDIANS_MAX_ENTRIES + 4; i++) await fetchPeerMedians(gw, [String(1000 + i)]);
    expect(__peerMediansCacheSize()).toBe(PEER_MEDIANS_MAX_ENTRIES);
  });

  it('pending_close 退避序列', () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => nextCloseRetryDelay(n) / 60000)).toEqual([1, 2, 5, 15, 30, 30]);
  });
});
