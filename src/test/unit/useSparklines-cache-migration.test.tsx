import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createFakeGateway, resetCheckupGateway, setCheckupGateway } from '@/checkup/lib/gateway';

const bars = (n: number, base = 1200) => Array.from({ length: n }, (_, i) => ({
  date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10),
  open: base + i, high: base + i + 5, low: base + i - 5, close: base + i + 2, volume: 1000 + i,
}));

describe('useSparklines cache v6 migration', () => {
  beforeEach(() => { localStorage.clear(); resetCheckupGateway(); });
  afterEach(() => resetCheckupGateway());

  it('既有 session 自動移除 v2 兩根並抓回 64 根完整資料', async () => {
    localStorage.setItem('lf.checkup.cache.sparkline.v2', JSON.stringify({
      legacy3491: { v: { ohlc: bars(2, 950), closes: [1100, 1100] }, t: Date.now() },
    }));
    const gateway = createFakeGateway();
    gateway.onInvoke('checkup-sparkline', async () => ({
      result: { '3491': { ohlc: bars(64), closes: bars(64).map((b) => b.close), complete: true } },
    }));
    setCheckupGateway(gateway);
    const mod = await import('@/checkup/hooks/useSparklines');
    mod.migrateSparklineCacheStorage();
    const { result } = renderHook(() => mod.useSparklines(['3491'], { pricesByCode: { '3491': 1265 } }));
    await waitFor(() => expect(result.current.sparklines['3491']?.ohlc).toHaveLength(64));
    expect(localStorage.getItem('lf.checkup.cache.sparkline.v2')).toBeNull();
    expect(gateway.calls.filter((c) => c.kind === 'invoke' && c.name === 'checkup-sparkline')).toHaveLength(1);
  });

  it('partial 是 fallback 但新 mount 強制回補；成功後 partial 被淘汰', async () => {
    const mod = await import('@/checkup/hooks/useSparklines');
    const key = mod.sparklineCacheKey('3491');
    mod.sparklineCache.clear();
    mod.sparklinePartialCache.set(key, { ohlc: bars(2), closes: [1202, 1203], complete: false });
    const gateway = createFakeGateway();
    gateway.onInvoke('checkup-sparkline', async () => ({
      result: { '3491': { ohlc: bars(64), closes: bars(64).map((b) => b.close), complete: true } },
    }));
    setCheckupGateway(gateway);
    const { result } = renderHook(() => mod.useSparklines(['3491']));
    expect(result.current.sparklines['3491']?.ohlc).toHaveLength(2);
    await waitFor(() => expect(result.current.sparklines['3491']?.ohlc).toHaveLength(64));
    expect(mod.sparklinePartialCache.get(key)).toBeNull();
  });

  it('切換標的不沿用前一檔，分別以 code key 寫入', async () => {
    const mod = await import('@/checkup/hooks/useSparklines');
    mod.sparklineCache.clear(); mod.sparklinePartialCache.clear();
    const gateway = createFakeGateway();
    gateway.onInvoke('checkup-sparkline', async ({ body }) => {
      const code = String((body as { codes: string[] }).codes[0]);
      return { result: { [code]: { ohlc: bars(64, code === '3491' ? 1200 : 600), complete: true } } };
    });
    setCheckupGateway(gateway);
    const { result, rerender } = renderHook(({ code }) => mod.useSparklines([code]), { initialProps: { code: '3491' } });
    await waitFor(() => expect(result.current.sparklines['3491']?.ohlc).toHaveLength(64));
    rerender({ code: '2330' });
    await waitFor(() => expect(result.current.sparklines['2330']?.ohlc).toHaveLength(64));
    expect(result.current.sparklines['3491']).toBeUndefined();
  });

  it('fresh session 無 cache 時只抓一次', async () => {
    const mod = await import('@/checkup/hooks/useSparklines');
    mod.sparklineCache.clear(); mod.sparklinePartialCache.clear(); mod.sparklineFailCache.clear();
    const gateway = createFakeGateway();
    gateway.onInvoke('checkup-sparkline', async () => ({ result: { '3491': { ohlc: bars(64), complete: true } } }));
    setCheckupGateway(gateway);
    const { result } = renderHook(() => mod.useSparklines(['3491']));
    await waitFor(() => expect(result.current.sparklines['3491']?.ohlc).toHaveLength(64));
    await act(async () => { await Promise.resolve(); });
    expect(gateway.calls.filter((c) => c.kind === 'invoke')).toHaveLength(1);
  });
});