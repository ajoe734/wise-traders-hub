// useTwChipsDetail — 抽屜私有查詢：台股籌碼面（三大法人 + BSR）
//
// 架構（候選 A + E）：
//   - 取數一律經 `src/checkup/lib/chipsRepository.ts`（唯一 seam），本檔不組 URL、不解析、不分類錯誤。
//   - 快取／去重／跨元件共享交給 TanStack Query，本檔不再自建 Map + TTL。
//   - 失效語意由後端 `stamp_ver` 決定（候選 E）：每 60 秒打一次極輕量 stamp 探針，
//     stamp 沒變就完全不下載 payload；stamp 一變立刻重抓。牆鐘 TTL 只保留給
//     「顯示更新於 N 分鐘前 / stale」與探針失敗時的保底重抓。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFreshness } from '../lib/freshness';
import { trackEvent } from '@/lib/trafficTracker';
import {
  fetchChipsPayload,
  fetchChipsStamp,
  classifyChipsError,
  isTaiwanStockCode,
  isTaiwanChipEligible,
  type ChipsError,
  type ChipsFetchResult,
  type TwChipsPayload,
} from '../lib/chipsRepository';

export {
  isTaiwanStockCode,
  isTaiwanChipEligible,
  classifyChipsError,
};
export type {
  TwChipsPayload,
  ChipsError,
  ChipsErrorKind,
  InstitutionalWindow,
  InstitutionalDailyPoint,
  BsrBroker,
  BsrWindow,
  BsrConcentrationPoint,
  ReadinessState,
  WindowReadinessPayload,
} from '../lib/chipsRepository';

export const TTL_MS = 5 * 60 * 1000;
/** stamp 探針間隔：新資料最慢 60 秒內就會出現在抽屜。 */
export const STAMP_POLL_MS = 60_000;

/** 過期自動重抓的節流參數 */
export const AUTO_BASE_BACKOFF_MS = 30_000;
export const AUTO_MAX_BACKOFF_MS = 5 * 60_000;
export const AUTO_MAX_FAILURES = 4;

/**
 * idle       = 新鮮，無動作
 * refreshing = 偵測到過期，正在自動重抓
 * failed     = 自動重抓失敗，退避中會再試
 * exhausted  = 連續失敗達上限，停手改由使用者手動
 * paused     = 分頁在背景，暫停自動重抓（回前景立即補抓）
 */
export type AutoRefreshState = 'idle' | 'refreshing' | 'failed' | 'exhausted' | 'paused';

function isViewAsActive(): boolean {
  try {
    return !!sessionStorage.getItem('view-as-session-v1');
  } catch { return false; }
}

export const chipsQueryKey = (stockCode: string) => ['tw-chips', stockCode] as const;
const stampQueryKey = (stockCode: string) => ['tw-chips-stamp', stockCode] as const;

export function useTwChipsDetail(stockCode: string | undefined | null, enabled = true) {
  const qc = useQueryClient();
  const code = stockCode ? String(stockCode).trim() : '';
  const valid = !!enabled && !!code && isTaiwanStockCode(code);

  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  );
  const sourceRef = useRef<'drawer_open' | 'manual_refetch' | 'reconnect' | 'auto_stale'>('drawer_open');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── 主查詢：payload ────────────────────────────────────────────
  const query = useQuery<ChipsFetchResult, unknown>({
    queryKey: chipsQueryKey(code),
    enabled: valid && online,
    // 失效由 stamp 探針決定，不用牆鐘讓 Query 自行判 stale。
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      fetchChipsPayload(code, {
        signal,
        telemetry: { source: sourceRef.current, isViewAs: isViewAsActive() },
      }),
  });

  const data = query.data?.payload ?? null;
  const stampVer = query.data?.stampVer ?? null;
  const fetchedAt = query.data ? query.dataUpdatedAt || null : null;

  // ── L1 命中／未命中 telemetry（快取漏斗契約，見 src/lib/chipsCacheFunnel.ts）──
  const prevStockRef = useRef<string | null>(null);
  useEffect(() => {
    if (!valid) return;
    const prev = prevStockRef.current;
    prevStockRef.current = code;
    const state = qc.getQueryState(chipsQueryKey(code));
    const isViewAs = isViewAsActive();
    const source = sourceRef.current;
    if (state?.data) {
      trackEvent('chips_memory_hit', {
        stock_code: code, source,
        age_ms: state.dataUpdatedAt ? Date.now() - state.dataUpdatedAt : null,
        is_view_as: isViewAs,
      });
    } else {
      trackEvent('chips_memory_miss', {
        stock_code: code, source,
        reason: prev && prev !== code ? 'stock_switch' : 'no_entry',
        age_ms: null, is_view_as: isViewAs,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, valid]);

  // ── 錯誤：離線優先，其餘由 repository 分類 ─────────────────────
  const error: ChipsError | null = useMemo(() => {
    if (!valid) return null;
    if (!online) {
      return { kind: 'offline', message: 'offline', reason: '目前離線，恢復連線後將自動重試' };
    }
    if (!query.error) return null;
    return classifyChipsError(query.error, (query.error as any)?.status);
  }, [valid, online, query.error]);

  useEffect(() => {
    if (valid && !online) {
      trackEvent('chips_fetch_error', {
        stock_code: code, source: sourceRef.current, error_code: 'offline',
        had_cache: !!data, is_view_as: isViewAsActive(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, valid, code]);

  // 上線後補抓一次
  const wasOfflineRef = useRef(!online);
  useEffect(() => {
    if (!valid) return;
    if (online && wasOfflineRef.current) {
      sourceRef.current = 'reconnect';
      query.refetch();
    }
    wasOfflineRef.current = !online;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, valid]);

  // ── 候選 E：stamp 探針 ────────────────────────────────────────
  const stampQuery = useQuery({
    queryKey: stampQueryKey(code),
    enabled: valid && online && visible && !!query.data,
    retry: false,
    staleTime: STAMP_POLL_MS / 2,
    gcTime: 10 * 60 * 1000,
    // 探針一旦失敗就停止輪詢，避免上游異常時每分鐘打一次；
    // 後續由使用者手動重整或分頁 refocus 重新啟動。
    refetchInterval: (q: any) => (q?.state?.status === 'error' ? false : STAMP_POLL_MS),
    refetchOnWindowFocus: true,
    queryFn: ({ signal }) => fetchChipsStamp(code, { signal }),
  });

  const probedStamp = stampQuery.data?.stamp_ver ?? null;
  useEffect(() => {
    if (!valid || !probedStamp || !stampVer) return;
    if (probedStamp === stampVer) return;
    sourceRef.current = 'auto_stale';
    trackEvent('chips_stamp_changed', {
      stock_code: code, from: stampVer, to: probedStamp, is_view_as: isViewAsActive(),
    });
    query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probedStamp, stampVer, valid, code]);

  /**
   * 版本化 revalidate：先問 stamp，沒變就只把「更新於」時間往前推，
   * 完全不下載 payload；變了或探針失敗才抓完整資料。
   */
  const revalidate = useCallback(async (): Promise<{ ok: boolean; downloaded: boolean }> => {
    if (!valid) return { ok: true, downloaded: false };
    const currentStamp = qc.getQueryData<ChipsFetchResult>(chipsQueryKey(code))?.stampVer ?? null;
    if (currentStamp) {
      try {
        const probe = await fetchChipsStamp(code);
        qc.setQueryData(stampQueryKey(code), probe);
        if (probe.stamp_ver && probe.stamp_ver === currentStamp) {
          // 版本沒變 → 資料仍然是最新的，只需重置新鮮度計時。
          qc.setQueryData<ChipsFetchResult>(chipsQueryKey(code), (prev) => (prev ? { ...prev } : prev));
          trackEvent('chips_stamp_unchanged', {
            stock_code: code, stamp_ver: probe.stamp_ver, is_view_as: isViewAsActive(),
          });
          return { ok: true, downloaded: false };
        }
      } catch {
        // 探針失敗 → 保底走完整重抓
      }
    }
    const res = await qc.fetchQuery<ChipsFetchResult>({
      queryKey: chipsQueryKey(code),
      queryFn: ({ signal }) =>
        fetchChipsPayload(code, {
          signal,
          telemetry: { source: sourceRef.current, isViewAs: isViewAsActive() },
        }),
      staleTime: 0,
      retry: false,
    }).then(() => ({ ok: true, downloaded: true }))
      .catch(() => ({ ok: false, downloaded: true }));
    return res;
  }, [qc, code, valid]);

  const refetch = useCallback((opts?: { auto?: boolean }) => {
    sourceRef.current = opts?.auto ? 'auto_stale' : 'manual_refetch';
    if (opts?.auto) return revalidate();
    return query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revalidate, query.refetch]);

  // 新鮮度單一資料源（src/checkup/lib/freshness.ts）：內建 ticker，
  // 抽屜開著不動也會隨時鐘把 stale / ageMs 推進，不再凍在打開那一刻。
  const { ageMs, label: ageLabel, clock: fetchedAtClock, stale } = useFreshness(fetchedAt, TTL_MS);

  // ── 過期自動重抓（保底；stamp 探針才是主力）───────────────────
  //   1. 只在 stale（> TTL）且已有一次成功結果、線上、分頁可見時觸發。
  //   2. 失敗以指數退避（30s → 60s → 120s → 上限 5 分鐘），連續 4 次失敗後停手改由使用者手動。
  //   3. 分頁隱藏時暫停（顯示 PAUSED），切回前景若已過期立即補抓一次。
  const [autoState, setAutoState] = useState<AutoRefreshState>('idle');
  const [nextAutoAt, setNextAutoAt] = useState<number | null>(null);
  const autoFailuresRef = useRef(0);
  const lastAutoAtRef = useRef(0);

  useEffect(() => {
    if (!valid) return;
    if (!stale || query.isFetching || !fetchedAt) return;
    if (!online) return;
    if (autoFailuresRef.current >= AUTO_MAX_FAILURES) { setAutoState('exhausted'); return; }
    if (!visible) { setAutoState('paused'); return; }

    const backoff = autoFailuresRef.current === 0
      ? 0
      : Math.min(AUTO_BASE_BACKOFF_MS * 2 ** (autoFailuresRef.current - 1), AUTO_MAX_BACKOFF_MS);
    const dueAt = Math.max(lastAutoAtRef.current + backoff, Date.now());
    setNextAutoAt(backoff > 0 ? dueAt : null);

    const delay = Math.max(0, dueAt - Date.now());
    const t = setTimeout(() => {
      lastAutoAtRef.current = Date.now();
      setAutoState('refreshing');
      trackEvent('chips_auto_refetch', {
        stock_code: code,
        age_ms: ageMs,
        failures: autoFailuresRef.current,
        is_view_as: isViewAsActive(),
      });
      sourceRef.current = 'auto_stale';
      void revalidate().then((r) => {
        if (r.ok) {
          autoFailuresRef.current = 0;
          setNextAutoAt(null);
          setAutoState('idle');
        } else {
          autoFailuresRef.current += 1;
          setAutoState(autoFailuresRef.current >= AUTO_MAX_FAILURES ? 'exhausted' : 'failed');
        }
      });
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, query.isFetching, fetchedAt, online, visible, valid, code, ageMs, revalidate]);

  return {
    data,
    loading: valid ? query.isFetching && !data : false,
    error,
    fetchedAt,
    ageMs, ageLabel, fetchedAtClock,
    online, stale, refetch,
    stampVer,
    autoState, nextAutoAt, autoFailures: autoFailuresRef.current,
  };
}
