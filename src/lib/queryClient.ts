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
