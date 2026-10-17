import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFundamentalsCache } from '../../../supabase/functions/_shared/fundamentalsCache';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const keys = ['TaiwanStockFinancialStatements:9876:2020-01-01', 'TaiwanStockBalanceSheet:9876:2020-01-01', 'TaiwanStockPrice:9876:2020-01-01', 'TaiwanStockShareholding:9876:2020-01-01'];
const ttl = 6 * 3600000;
describe('財報服務實際使用的 isolate 快取', () => {
  afterEach(() => vi.useRealTimers());
  it.each(keys)('%s 跨日新請求不共用舊在途回應，舊請求不清除新請求', async (key) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T15:59:59Z'));
    const cached = createFundamentalsCache(); const meter = { cacheHits: 0 };
    const old = deferred<number>(); const fresh = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise).mockResolvedValue(99);
    const first = cached(key, ttl, meter, load);
    vi.setSystemTime(new Date('2026-11-14T16:00:01Z'));
    const second = cached(key, ttl, meter, load);
    old.resolve(4); await first;
    const third = cached(key, ttl, meter, load);
    fresh.resolve(7);
    expect(await second).toBe(7); expect(await third).toBe(7);
    expect(await cached(key, ttl, meter, load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it.each(keys)('%s 跨日才完成的回應不能延長新日快取', async (key) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T15:59:59Z'));
    const cached = createFundamentalsCache(); const meter = { cacheHits: 0 }; const old = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(7);
    const first = cached(key, ttl, meter, load);
    vi.setSystemTime(new Date('2026-11-14T16:00:01Z')); old.resolve(4); await first;
    expect(await cached(key, ttl, meter, load)).toBe(7); expect(load).toHaveBeenCalledTimes(2);
  });
  it('一小時從請求開始計時，失敗不快取，成功同日共用', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T00:00:00Z'));
    const cached = createFundamentalsCache(); const meter = { cacheHits: 0 }; const first = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('quota')).mockResolvedValue(7);
    const pending = cached(keys[0], ttl, meter, load);
    vi.setSystemTime(Date.now() + 1000); first.resolve(4); await pending;
    expect(await cached(keys[0], ttl, meter, load)).toBe(4);
    vi.setSystemTime(new Date('2026-11-14T01:00:00Z'));
    await expect(cached(keys[0], ttl, meter, load)).rejects.toThrow('quota');
    expect(await cached(keys[0], ttl, meter, load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it.each(keys)('%s 新回應先完成、舊回應後抵達，不覆蓋新快取', async (key) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T15:59:59Z'));
    const cached = createFundamentalsCache(); const meter = { cacheHits: 0 }; const old = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(7);
    const first = cached(key, ttl, meter, load);
    vi.setSystemTime(new Date('2026-11-14T16:00:01Z'));
    expect(await cached(key, ttl, meter, load)).toBe(7);
    old.resolve(4); await first;
    expect(await cached(key, ttl, meter, load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it.each(['official:TWSE', 'official:TPEx'])('%s 不受財報日界限制，仍依名錄 TTL', async (key) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T15:59:59Z'));
    const cached = createFundamentalsCache(); const meter = { cacheHits: 0 }; const old = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(7);
    const first = cached(key, 12 * 3600000, meter, load);
    vi.setSystemTime(Date.now() + 2000); const second = cached(key, 12 * 3600000, meter, load);
    old.resolve(4); expect(await first).toBe(4); expect(await second).toBe(4);
    expect(load).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-15T03:59:59Z'));
    expect(await cached(key, 12 * 3600000, meter, load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(2);
  });
});