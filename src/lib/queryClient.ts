import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

/**
 * Cache strategy for /app signal & journal content.
 *
 * - staleTime: 5 minutes — pages render cached data instantly on tab switch,
 *   while background refetch silently refreshes.
 * - gcTime: 24h — cached payloads survive a full day, so reloading after
 *   short offline periods still shows the last-known content.
 * - Realtime subscriptions on `expert_signals` invalidate the relevant
 *   queries the moment something is published / withdrawn (see
 *   `useSignalRealtimeInvalidation`).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

const STORAGE_KEY = "lf-app-cache-v1";

/**
 * 立即移除持久化快取。`queryClient.clear()` 只清記憶體，且 persister 的
 * throttle（1.5s）可能來不及寫回空快取 —— 登出／切換帳號後若馬上重新載入，
 * 舊帳號的訂閱狀態會被 rehydrate 回來。
 */
export function purgePersistedQueryCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage 不可用時忽略 */
  }
}

export const queryPersister =
  typeof window !== "undefined"
    ? createSyncStoragePersister({
        storage: window.localStorage,
        key: STORAGE_KEY,
        throttleTime: 1500,
      })
    : undefined;

/**
 * Query keys we want to persist to localStorage (signals + journals).
 * Anything outside this list stays memory-only to avoid bloating
 * localStorage with volatile data (prices, auth, etc.).
 */
export const PERSISTED_QUERY_PREFIXES = [
  "app-signals",
  "app-journals",
  "app-signal-detail",
  "app-journal-detail",
] as const;

export type PersistedQueryPrefix = (typeof PERSISTED_QUERY_PREFIXES)[number];
