// Simple in-memory TTL cache for upstream API responses.
// Edge function isolates are reused across requests, so this helps absorb
// burst load at close-of-market when many users hit the same endpoint.
// On cold start the cache is empty; that's acceptable.

interface Entry { value: unknown; expiresAt: number; }
const store = new Map<string, Entry>();

export function cacheGet<T = unknown>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  // Cheap eviction: if size > 500, drop expired entries.
  if (store.size > 500) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k);
    }
  }
}
