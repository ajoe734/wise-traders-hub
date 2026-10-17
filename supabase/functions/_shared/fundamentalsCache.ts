import { financialCacheValid } from './filingRefreshCore.ts';

/** Isolate-local request cache shared by financial datasets and official registries. */
export function createFundamentalsCache() {
  const cache = new Map<string, { at: number; value: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();
  return async function cached<T>(key: string, ttl: number, meter: { cacheHits: number }, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl && (key.startsWith('official:') || financialCacheValid(hit.at, Date.now()))) { meter.cacheHits++; return hit.value as T; }
    const running = inflight.get(key);
    if (running) { meter.cacheHits++; return running as Promise<T>; }
    const p = load().then((value) => { cache.set(key, { at: Date.now(), value }); return value; }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}