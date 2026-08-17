/**
 * chipsRepository — 抽屜籌碼資料的**唯一取數 seam**（候選 A）。
 *
 * 契約：
 *   - 任何取得 `tw-chips-detail` 資料的路徑都必須經過本檔，禁止元件／hook 自行組 URL。
 *   - 本模組只負責「打 endpoint、解析、丟結構化錯誤、記 telemetry」。
 *   - 快取、退避、背景重抓、focus 重抓一律由呼叫端的 TanStack Query 設定負責，
 *     不要在這裡放任何 Map / TTL / setTimeout。
 *
 * 深度：介面只有三個函式（fetchChipsPayload / fetchChipsStamp / classifyChipsError），
 * 背後藏著 anon JWT 選擇、timeout、abort 串接、錯誤分類與 6 種事件。
 */
import { getCheckupGateway } from './gateway';
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

export type ReadinessState = 'ready' | 'filling' | 'upstream_exhausted' | 'no_data';
export interface WindowReadinessPayload {
  window_days: 1 | 5 | 10 | 20 | 60;
  state: ReadinessState;
  have: number;
  need: number;
  oldest_available: string | null;
  newest_available: string | null;
  detail: string;
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
    /** 1／10 日為後加視窗；舊快取／舊 payload 可能沒有這兩個 key。 */
    d1?: BsrWindow | null;
    d5: BsrWindow | null;
    d10?: BsrWindow | null;
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
   * M1 readiness：每個視窗（1/5/10/20/60）的顯示狀態，由後端 seriesReadiness.ts 單一判定。
   * UI 只讀這裡決定「畫線 / 補齊中 / 上游不足 / 暫無資料」，不再自行 count 有效點。
   */
  readiness?: {
    institutional: Partial<Record<'1' | '5' | '10' | '20' | '60', WindowReadinessPayload>>;
    bsr_concentration: Partial<Record<'1' | '5' | '10' | '20' | '60', WindowReadinessPayload>>;
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
  _cache_meta?: { cache?: string; stamp_ver?: string; served_at?: string };
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

/** repository 丟出的統一錯誤；`chips` 屬性已是分類完成的 ChipsError。 */
export class ChipsRequestError extends Error {
  readonly chips: ChipsError;
  readonly status?: number;
  constructor(chips: ChipsError, status?: number, cause?: unknown) {
    super(chips.message);
    this.name = 'ChipsRequestError';
    this.chips = chips;
    this.status = status;
    (this as any).cause = cause;
  }
}

export function classifyChipsError(err: unknown, status?: number): ChipsError {
  if (err instanceof ChipsRequestError) return err.chips;
  const msg = (err as Error)?.message || String(err);
  const name = (err as Error)?.name || '';
  const causeMsg = String(((err as any)?.cause as Error | undefined)?.message ?? '');
  const hay = `${name} ${msg} ${causeMsg}`.toLowerCase();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { kind: 'offline', message: msg, reason: '目前離線，恢復連線後可自動重試' };
  }
  if (name === 'AbortError' || hay.includes('aborterror') || hay.includes('timeout') || hay.includes('timedout')) {
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
  if (
    hay.includes('failed to fetch') ||
    hay.includes('networkerror') ||
    hay.includes('load failed') ||
    hay.includes('err_') ||
    !status // 無 HTTP status = 根本沒連上，一律歸類為網路異常而非 unknown
  ) {
    return { kind: 'network', message: msg, reason: '網路連線失敗，請重試' };
  }
  return { kind: 'unknown', status, message: msg, reason: msg.slice(0, 80) || '未知錯誤' };
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

export const CHIPS_REQUEST_TIMEOUT_MS = 15_000;
export const CHIPS_STAMP_TIMEOUT_MS = 8_000;
export const CHIPS_BATCH_TIMEOUT_MS = 30_000;
export const CHIPS_BATCH_MAX_STOCKS = 30;

/**
 * Preview / harness-only endpoint 切換。
 * production build 未設此變數 → 仍走舊 `tw-chips-detail`（不改變真實使用者行為）。
 * 設為 `tw-chips-detail-v2` 時走 side-by-side read-only endpoint。
 */
export const CHIPS_FN = (import.meta.env?.VITE_CHIPS_ENDPOINT as string | undefined) || 'tw-chips-detail';


/** 公開市場資料 endpoint 一律用 publishable anon JWT，避免殘留 user JWT 造成 401。 */
function anonHeaders(): Record<string, string> {
  return {
    apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || '',
    Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
  };
}

async function requestText(
  path: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number; method?: string; body?: string },
): Promise<{ text: string; durationMs: number }> {
  const gw = getCheckupGateway();
  const url = `${gw.functionsUrl()}${path}`;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts?.signal?.addEventListener('abort', onAbort);
  const timeoutId = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? CHIPS_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  const init: RequestInit = {
    signal: ctrl.signal,
    headers: {
      ...anonHeaders(),
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    method: opts?.method ?? 'GET',
    ...(opts?.body ? { body: opts.body } : {}),
  };

  try {
    const text = await gw.http.text(url, init);
    return { text, durationMs: Date.now() - startedAt };
  } catch (err: any) {
    const status: number | undefined = err?.status;
    const detail = String(err?.body ?? err?.message ?? err?.name ?? '').slice(0, 120);
    const wrapped = new Error(`chips ${status ?? 0}: ${detail}`);
    (wrapped as any).name = err?.name ?? wrapped.name;
    (wrapped as any).cause = err;
    throw new ChipsRequestError(classifyChipsError(wrapped, status), status, err);
  } finally {
    clearTimeout(timeoutId);
    opts?.signal?.removeEventListener('abort', onAbort);
  }
}


export interface ChipsFetchResult {
  payload: TwChipsPayload;
  /** 後端資料版本戳（`_cache_meta.stamp_ver`）；候選 E 用它取代牆鐘 TTL。 */
  stampVer: string | null;
  bytes: number;
  durationMs: number;
}

export interface ChipsStamp {
  stock_id: string;
  /** `chipsAsOf:chipsUpdatedAt|instAsOf` 組合；後端與前端共用同一組字串。 */
  stamp_ver: string;
  chips_as_of: string | null;
  inst_as_of: string | null;
}

export interface ChipsTelemetryContext {
  source?: string;
  isViewAs?: boolean;
}

/** 取完整籌碼 payload。錯誤一律是 ChipsRequestError。 */
export async function fetchChipsPayload(
  stockId: string,
  opts?: { signal?: AbortSignal; telemetry?: ChipsTelemetryContext },
): Promise<ChipsFetchResult> {
  const source = opts?.telemetry?.source ?? 'unknown';
  const isViewAs = !!opts?.telemetry?.isViewAs;
  trackEvent('chips_fetch_start', { stock_code: stockId, source, is_view_as: isViewAs });
  try {
    const { text, durationMs } = await requestText(
      `/tw-chips-detail?stock_id=${encodeURIComponent(stockId)}`,
      { signal: opts?.signal },
    );
    const payload = JSON.parse(text) as TwChipsPayload;
    const stampVer = payload?._cache_meta?.stamp_ver ?? null;
    trackEvent('chips_fetch_done', {
      stock_code: stockId,
      source,
      duration_ms: durationMs,
      payload_bytes: text.length,
      bsr_freshness_status: payload?.bsr_freshness_status ?? null,
      edge_cache: payload?._cache_meta?.cache ?? null,
      stamp_ver: stampVer,
      bsr_source: payload?.bsr_source ?? null,
      is_view_as: isViewAs,
    });
    return { payload, stampVer, bytes: text.length, durationMs };
  } catch (err) {
    const chips = classifyChipsError(err, (err as ChipsRequestError)?.status);
    trackEvent('chips_fetch_error', {
      stock_code: stockId,
      source,
      error_code: chips.kind,
      status: chips.status ?? null,
      is_view_as: isViewAs,
    });
    throw err instanceof ChipsRequestError ? err : new ChipsRequestError(chips);
  }
}

/**
 * 候選 E：極輕量版本探針。只讀後端最新 rollup / institutional 的 as_of，
 * 不下載完整 payload。stamp 沒變 → 前端不需要重抓。
 */
export async function fetchChipsStamp(
  stockId: string,
  opts?: { signal?: AbortSignal },
): Promise<ChipsStamp> {
  const { text } = await requestText(
    `/tw-chips-detail?stock_id=${encodeURIComponent(stockId)}&stamp_only=1`,
    { signal: opts?.signal, timeoutMs: CHIPS_STAMP_TIMEOUT_MS },
  );
  const json = JSON.parse(text) as Partial<ChipsStamp>;
  return {
    stock_id: String(json.stock_id ?? stockId),
    stamp_ver: String(json.stamp_ver ?? ''),
    chips_as_of: json.chips_as_of ?? null,
    inst_as_of: json.inst_as_of ?? null,
  };
}

export interface ChipsBatchResult {
  results: Record<string, TwChipsPayload>;
  errors: Record<string, string>;
  count: number;
  failed: number;
  servedAt: string;
}

function normalizeStockCodes(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  const out: string[] = [];
  for (const c of codes) {
    const code = String(c ?? '').trim();
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * 候選 D：批次取得多檔籌碼 payload。單一響應的形狀與逐檔 tw-chips-detail 完全相同，
 * 前端可用來預先填滿各股的 TanStack Query 快取，避免抽屜開啟時 N+1 個別握手。
 */
export async function fetchChipsBatch(
  stockIds: string[] | null | undefined,
  opts?: { signal?: AbortSignal; telemetry?: ChipsTelemetryContext },
): Promise<ChipsBatchResult> {
  const source = opts?.telemetry?.source ?? 'unknown';
  const isViewAs = !!opts?.telemetry?.isViewAs;
  const ids = normalizeStockCodes(stockIds)
    .filter((c) => isTaiwanStockCode(c))
    .slice(0, CHIPS_BATCH_MAX_STOCKS);

  if (!ids.length) {
    return { results: {}, errors: {}, count: 0, failed: 0, servedAt: '' };
  }

  trackEvent('chips_batch_fetch_start', { count: ids.length, source, is_view_as: isViewAs });
  try {
    const { text, durationMs } = await requestText('/tw-chips-detail', {
      signal: opts?.signal,
      timeoutMs: CHIPS_BATCH_TIMEOUT_MS,
      method: 'POST',
      body: JSON.stringify({ stock_ids: ids }),
    });
    const json = JSON.parse(text) as Partial<ChipsBatchResult> & { served_at?: string };
    const results = json.results ?? {};
    const errors = json.errors ?? {};
    trackEvent('chips_batch_fetch_done', {
      count: ids.length,
      returned: Object.keys(results).length,
      failed: Object.keys(errors).length,
      source,
      duration_ms: durationMs,
      payload_bytes: text.length,
      is_view_as: isViewAs,
    });
    return {
      results,
      errors,
      count: Object.keys(results).length,
      failed: Object.keys(errors).length,
      servedAt: json.served_at ?? json.servedAt ?? new Date().toISOString(),
    };
  } catch (err) {
    const chips = classifyChipsError(err, (err as ChipsRequestError)?.status);
    trackEvent('chips_batch_fetch_error', {
      count: ids.length,
      source,
      error_code: chips.kind,
      status: chips.status ?? null,
      is_view_as: isViewAs,
    });
    throw err instanceof ChipsRequestError ? err : new ChipsRequestError(chips);
  }
}

/** 候選 D：單股預載（hover 用）。失敗靜默，不該打斷使用者操作。 */
export async function prefetchChipsPayload(
  stockId: string,
  opts?: { signal?: AbortSignal; telemetry?: ChipsTelemetryContext },
): Promise<ChipsFetchResult | null> {
  if (!isTaiwanStockCode(stockId)) return null;
  try {
    const res = await fetchChipsBatch([stockId], { ...opts, telemetry: { source: opts?.telemetry?.source ?? 'hover_prefetch', isViewAs: opts?.telemetry?.isViewAs } });
    const payload = res.results[stockId];
    if (!payload) return null;
    const stampVer = payload?._cache_meta?.stamp_ver ?? null;
    return { payload, stampVer, bytes: 0, durationMs: 0 };
  } catch {
    return null;
  }
}

