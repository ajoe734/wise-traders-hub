import { financialCacheValid } from './filingRefreshCore.ts';

/** Isolate-local request cache shared by financial datasets and official registries. */
export function createFundamentalsCache() {
  const cache = new Map<string, { at: number; value: unknown }>();
  const inflight = new Map<string, { at: number; promise: Promise<unknown> }>();
  return async function cached<T>(key: string, ttl: number, meter: { cacheHits: number }, load: () => Promise<T>): Promise<T> {
    const valid = (at: number) => {
      const now = Date.now();
      return now >= at && now - at < ttl && (key.startsWith('official:') || financialCacheValid(at, now));
    };
    const hit = cache.get(key);
    if (hit && valid(hit.at)) { meter.cacheHits++; return hit.value as T; }
    const running = inflight.get(key);
    if (running && valid(running.at)) { meter.cacheHits++; return running.promise as Promise<T>; }
    const requestedAt = Date.now();
    const p = load().then((value) => {
      if (inflight.get(key)?.promise === p && valid(requestedAt)) cache.set(key, { at: requestedAt, value });
      return value;
    }).finally(() => { if (inflight.get(key)?.promise === p) inflight.delete(key); });
    inflight.set(key, { at: requestedAt, promise: p });
    return p;
  };
}