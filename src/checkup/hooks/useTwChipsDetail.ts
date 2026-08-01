// useTwChipsDetail — 抽屜私有查詢：台股籌碼面（三大法人 + BSR）
// 呼叫公開市場資料 endpoint `tw-chips-detail`；SWR 5 分鐘快取。
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCheckupGateway } from '../lib/gateway';
import { useFreshness } from '../lib/freshness';
import { trackEvent } from '@/lib/trafficTracker';


export interface InstitutionalWindow {
  foreign_net: number;
  trust_net: number;
  dealer_net: number;
  total_net: number;
  days_covered: number;
}

export interface BsrBroker {
  broker_id: string;
  name: string;
  net: number;
}

export interface BsrWindow {
  top_buy: BsrBroker[];
  top_sell: BsrBroker[];
  concentration_ratio: number | null;
}

export interface InstitutionalDailyPoint {
  date: string;
  foreign_net: number;
  trust_net: number;
  dealer_net: number;
  total_net: number;
}

export interface BsrConcentrationPoint {
  date: string;
  concentration_ratio: number | null;
  top_net: number;
}

export interface TwChipsPayload {
  stock_id: string;
  as_of: string | null;
  as_of_lag_days?: number | null;

  institutional: {
    d1: InstitutionalWindow | null;
    d5: InstitutionalWindow | null;
    d20: InstitutionalWindow | null;
    d60: InstitutionalWindow | null;
  };
  bsr: {
    d5: BsrWindow | null;
    d20: BsrWindow | null;
    d60: BsrWindow | null;
  };
  bsr_as_of: string | null;
  bsr_as_of_lag_days?: number | null;
  /** rollup = 正式 5/20/60 日窗；raw_fallback = 只有 d5，來自 raw complete data；null = 無資料 */
  bsr_source?: 'rollup' | 'raw_fallback' | null;
  /** P4：本次使用的 BSR 資料來源日期（可能因回溯而早於 bsr_as_of） */
  bsr_source_date?: string | null;
  /** P4：true 表示 BSR 至少有一個視窗是從過去日期回溯補齊 */
  bsr_fallback_used?: boolean;
  /** 收盤後預期最新可用 BSR 交易日（Asia/Taipei；不含國定假日） */
  bsr_expected_date?: string | null;
  /** chosen as_of 與 expected_date 的 weekday 差；越大表示越延遲 */
  bsr_lag_weekdays?: number | null;
  /**
   * 前端渲染唯一語意來源：
   *   fresh        = 資料日期 >= 預期日期
   *   syncing      = 尚未 fresh、queue pending/running
   *   sync_failed  = 尚未 fresh、queue failed/dead
   *   lagging      = 有資料但落後預期（用來顯示「顯示 MM/DD 資料」）
   *   not_queued   = 未 queue 且無資料（會由 ensure_bsr_queued 補上）
   *   no_data      = 完全沒資料
   *   ineligible   = ETF／權證等不支援
   */
  bsr_freshness_status?:
    | 'ineligible'
    | 'fresh'
    | 'syncing'
    | 'sync_failed'
    | 'lagging'
    | 'not_queued'
    | 'no_data';
  bsr_completeness_threshold?: number;
  bsr_last_failure?: {
    trade_date: string;
    error_code: string;
    attempts: number;
    next_retry_at?: string | null;
    backoff_seconds?: number | null;
    consecutive_failures?: number | null;
    last_successful_as_of?: string | null;
    lookback_from?: string | null;
    lookback_to?: string | null;
    lookback_days?: number | null;
  } | null;
  bsr_sync_status?: {
    eligible: boolean;
    ineligible_reason: 'invalid_stock_id' | 'missing_instrument' | 'unsupported_asset_type' | null;
    asset_class?: string | null;
    queued: boolean;
    status: 'pending' | 'running' | 'failed' | 'dead' | 'not_queued' | 'ineligible';
    next_run_at: string | null;
    attempts: number;
    max_attempts: number;
    error_code: string | null;
    retryable: boolean;
  };
  series?: {
    institutional_daily: InstitutionalDailyPoint[];
    bsr_concentration: BsrConcentrationPoint[];
  };
  /**
   * M1 readiness：每個視窗（5/20/60）的顯示狀態，由後端 seriesReadiness.ts 單一判定。
   * UI 只讀這裡決定「畫線 / 補齊中 / 上游不足 / 暫無資料」，不再自行 count 有效點。
   */
  readiness?: {
    institutional: Record<'5' | '20' | '60', WindowReadinessPayload>;
    bsr_concentration: Record<'5' | '20' | '60', WindowReadinessPayload>;
    /** P3：BSR 快照是否已封存；sealed_at 存在時為 true */
    sealed?: boolean;
    sealed_at?: string | null;
    sealed_by_lane?: string | null;
  };
  /** PR-8：上游熔斷狀態。any_open=true → 前端 5 態機直接進 upstream_outage */
  upstream_circuit?: {
    any_open: boolean;
    sources: Record<string, {
      state: 'closed' | 'open' | 'half_open';
      disabled_until: string | null;
      consecutive_failures: number;
      last_error_code: string | null;
    }>;
  };
  /** P3：後端快照狀態（sealed / partial / stale / missing / ineligible） */
  snapshot_state?: 'sealed' | 'partial' | 'stale' | 'missing' | 'ineligible';
  snapshot_status?: {
    trade_date: string;
    status: string;
    sealed_at: string | null;
    sealed_by_lane: string | null;
    lane_a_status: string | null;
    lane_b_status: string | null;
    lane_c_status: string | null;
    coverage_stocks: number;
    coverage_brokers: number;
    updated_at: string;
  } | null;
  source: string;
  fetched_at: string;
  /** Phase-2: 本次回應是否命中 request coalescing（同 isolate 併發去重） */
  coalesced?: boolean;
}


export type ReadinessState = 'ready' | 'filling' | 'upstream_exhausted' | 'no_data';
export interface WindowReadinessPayload {
  window_days: 5 | 20 | 60;
  state: ReadinessState;
  have: number;
  need: number;
  oldest_available: string | null;
  newest_available: string | null;
  detail: string;
}

const CACHE = new Map<string, { data: TwChipsPayload; ts: number }>();
const TTL_MS = 5 * 60 * 1000;

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


// 台股代碼判定：4-6 位純數字（2330、00878、911616 等）
export function isTaiwanStockCode(code: string | undefined | null): boolean {
  if (!code) return false;
  return /^\d{4,6}[A-Z]?$/.test(String(code).trim());
}

/**
 * 分點（BSR）資料可用性判定。
 * FinMind 的 TaiwanStockTradingDailyReport 僅覆蓋一般個股，
 * ETF / 權證 / 受益憑證 / 可轉債 / DR 皆無分點資料 → 不入 sync 佇列、UI 直接顯示提示。
 * 規則：4 碼、首位為 1-9 之個股（如 1101、2330、6285、9958）才視為 chip-eligible。
 */
export function isTaiwanChipEligible(code: string | undefined | null): boolean {
  if (!code) return false;
  return /^[1-9]\d{3}$/.test(String(code).trim());
}

export type ChipsErrorKind =
  | 'network'
  | 'offline'
  | 'timeout'
  | 'auth'
  | 'server'
  | 'not_found'
  | 'unknown';

export interface ChipsError {
  kind: ChipsErrorKind;
  status?: number;
  message: string;
  reason: string; // 使用者可讀
}

function classifyError(err: unknown, status?: number): ChipsError {
  const msg = (err as Error)?.message || String(err);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { kind: 'offline', message: msg, reason: '目前離線，恢復連線後可自動重試' };
  }
  if (msg.includes('AbortError') || msg.includes('timeout')) {
    return { kind: 'timeout', status, message: msg, reason: '請求逾時，請稍後重試' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'auth', status, message: msg, reason: '登入或權限失效，請重新登入' };
  }
  if (status === 404) {
    return { kind: 'not_found', status, message: msg, reason: '此代號無籌碼資料' };
  }
  if (status && status >= 500) {
    return { kind: 'server', status, message: msg, reason: '伺服器暫時無法回應（TWSE 可能異常）' };
  }
  if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror')) {
    return { kind: 'network', message: msg, reason: '網路連線失敗，請重試' };
  }
  return { kind: 'unknown', status, message: msg, reason: msg.slice(0, 80) || '未知錯誤' };
}

export function useTwChipsDetail(stockCode: string | undefined | null, enabled = true) {
  const [data, setData] = useState<TwChipsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChipsError | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const inflight = useRef<AbortController | null>(null);
  const autoSourceRef = useRef(false);
  const [manualBump, setManualBump] = useState(0);

  // 離線 / 上線監聽（上線時自動重試）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => {
      setOnline(true);
      setManualBump((n) => n + 1); // 觸發重取
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Track stockCode transitions for telemetry `reason` classification.
  const prevStockRef = useRef<string | null | undefined>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!stockCode || !isTaiwanStockCode(stockCode)) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const isViewAs = isViewAsActive();
    const prevStock = prevStockRef.current;
    prevStockRef.current = stockCode;
    const source: 'drawer_open' | 'manual_refetch' | 'reconnect' | 'auto_stale' =
      autoSourceRef.current ? 'auto_stale'
      : attempt > 0 ? 'manual_refetch'
      : manualBump > 0 ? 'reconnect'
      : 'drawer_open';

    // 離線時：若有 cache 就顯示 cache + offline error；否則 offline error
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const cached = CACHE.get(stockCode);
      if (cached) {
        setData(cached.data);
        setFetchedAt(cached.ts);
      }
      setError({ kind: 'offline', message: 'offline', reason: '目前離線，恢復連線後將自動重試' });
      setLoading(false);
      trackEvent('chips_fetch_error', {
        stock_code: stockCode, source, error_code: 'offline',
        had_cache: !!cached, is_view_as: isViewAs,
      });
      return;
    }

    // 讀快取
    const cached = CACHE.get(stockCode);
    const cacheAge = cached ? Date.now() - cached.ts : null;
    if (cached && cacheAge !== null && cacheAge < TTL_MS && manualBump === 0 && attempt === 0) {
      setData(cached.data);
      setFetchedAt(cached.ts);
      setError(null);
      setLoading(false);
      trackEvent('chips_memory_hit', {
        stock_code: stockCode, source, age_ms: cacheAge, is_view_as: isViewAs,
      });
      return;
    }

    const missReason: string = !cached ? 'no_entry'
      : (attempt > 0 || manualBump > 0) ? 'manual_refetch'
      : (cacheAge !== null && cacheAge >= TTL_MS) ? 'ttl_expired'
      : (prevStock && prevStock !== stockCode) ? 'stock_switch'
      : 'unknown';

    trackEvent('chips_memory_miss', {
      stock_code: stockCode, source, reason: missReason,
      age_ms: cacheAge, is_view_as: isViewAs,
    });
    trackEvent('chips_fetch_start', {
      stock_code: stockCode, source, is_view_as: isViewAs,
    });

    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => ctrl.abort(), 15000);
    const startedAt = Date.now();

    (async () => {
      let status: number | undefined;
      try {
        const gw = getCheckupGateway();
        const url = `${gw.functionsUrl()}/tw-chips-detail?stock_id=${encodeURIComponent(stockCode)}`;
        // tw-chips-detail 只回公開市場籌碼資料，不依賴使用者身份。
        // 固定用 publishable anon JWT，避免 demo/匿名模式或瀏覽器殘留 stale user JWT
        // 觸發後端 auth.getUser() 的「missing sub claim」401，造成抽屜白屏。
        let rawText: string;
        try {
          rawText = await gw.http.text(url, {
            signal: ctrl.signal,
            headers: {
              apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || '',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
          });
          status = 200;
        } catch (err: any) {
          status = err?.status;
          throw new Error(`chips ${err?.status ?? 0}: ${String(err?.body ?? err?.message ?? '').slice(0, 120)}`);
        }

        const json = JSON.parse(rawText) as TwChipsPayload & {
          _cache_meta?: { cache?: string; stamp_ver?: string };
        };
        // Race guard: ignore stale response if stockCode changed while inflight.
        if (prevStockRef.current !== stockCode) return;
        const now = Date.now();
        CACHE.set(stockCode, { data: json, ts: now });
        setData(json);
        setFetchedAt(now);
        setError(null);
        setAttempt(0);
        autoSourceRef.current = false;
        trackEvent('chips_fetch_done', {
          stock_code: stockCode, source,
          duration_ms: now - startedAt,
          payload_bytes: rawText.length,
          bsr_freshness_status: (json as any)?.bsr_freshness_status ?? null,
          edge_cache: (json as any)?._cache_meta?.cache ?? null,
          stamp_ver: (json as any)?._cache_meta?.stamp_ver ?? null,
          bsr_source: (json as any)?.bsr_source ?? null,
          is_view_as: isViewAs,
        });
      } catch (err) {
        if ((err as any).name === 'AbortError' && !ctrl.signal.aborted) return;
        // 保留舊 cache 資料當降級顯示
        const cached2 = CACHE.get(stockCode);
        if (cached2) {
          setData(cached2.data);
          setFetchedAt(cached2.ts);
        }
        const classified = classifyError(err, status);
        setError(classified);
        trackEvent('chips_fetch_error', {
          stock_code: stockCode, source,
          error_code: classified.kind, status: status ?? null,
          duration_ms: Date.now() - startedAt,
          had_cache: !!cached2, is_view_as: isViewAs,
        });
      } finally {
        window.clearTimeout(timeoutId);
        if (inflight.current === ctrl) inflight.current = null;
        setLoading(false);
      }
    })();

    return () => {
      window.clearTimeout(timeoutId);
      ctrl.abort();
    };
  }, [stockCode, enabled, manualBump, attempt]);

  const refetch = useCallback((opts?: { auto?: boolean }) => {
    if (opts?.auto) autoSourceRef.current = true;
    if (stockCode) CACHE.delete(stockCode);
    setAttempt((n) => n + 1);
  }, [stockCode]);

  // 新鮮度單一資料源（src/checkup/lib/freshness.ts）：內建 ticker，
  // 抽屜開著不動也會隨時鐘把 stale / ageMs 推進，不再凍在打開那一刻。
  const { ageMs, label: ageLabel, clock: fetchedAtClock, stale } = useFreshness(fetchedAt, TTL_MS);

  // ── 過期自動重抓 ─────────────────────────────────────────────
  // 規則（避免打爆 edge function）：
  //   1. 只在 stale（> TTL）且已有一次成功結果、線上、分頁可見時觸發。
  //   2. 失敗以指數退避（30s → 60s → 120s → 上限 5 分鐘），連續 4 次失敗後停手改由使用者手動。
  //   3. 分頁隱藏時暫停（顯示 PAUSED），切回前景若已過期立即補抓一次。
  const [autoState, setAutoState] = useState<AutoRefreshState>('idle');
  const [nextAutoAt, setNextAutoAt] = useState<number | null>(null);
  const autoFailuresRef = useRef(0);
  const lastAutoAtRef = useRef(0);
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 每次成功抓到新資料 → 重置退避
  useEffect(() => {
    if (fetchedAt && !error) {
      autoFailuresRef.current = 0;
      setNextAutoAt(null);
      setAutoState('idle');
    }
  }, [fetchedAt, error]);

  useEffect(() => {
    if (!enabled || !stockCode || !isTaiwanStockCode(stockCode)) return;
    if (!stale || loading || !fetchedAt) return;
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
        stock_code: stockCode,
        age_ms: ageMs,
        failures: autoFailuresRef.current,
        is_view_as: isViewAsActive(),
      });
      refetch({ auto: true });
    }, delay);
    return () => clearTimeout(t);
  }, [stale, loading, fetchedAt, online, visible, enabled, stockCode, ageMs, refetch]);

  // 自動重抓失敗 → 記一次失敗、進入退避
  const lastErrorRef = useRef<ChipsError | null>(null);
  useEffect(() => {
    if (error && error !== lastErrorRef.current && autoState === 'refreshing') {
      autoFailuresRef.current += 1;
      setAutoState(autoFailuresRef.current >= AUTO_MAX_FAILURES ? 'exhausted' : 'failed');
    }
    lastErrorRef.current = error;
  }, [error, autoState]);

  return {
    data, loading, error, fetchedAt, ageMs, ageLabel, fetchedAtClock, online, stale, refetch,
    autoState, nextAutoAt, autoFailures: autoFailuresRef.current,
  };
}



