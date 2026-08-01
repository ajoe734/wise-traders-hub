// deno-lint-ignore-file no-explicit-any
// _shared/retryFetch.ts
// 外部 API（FinMind / TWSE / TPEx / Yahoo …）統一的自動重試 + 指數退避層。
//
// 為什麼：每個同步器各自 `await fetch(...)`，遇到 429 / 502 / 連線中斷就直接失敗，
// 失敗原因散落在 console。這裡把「重試策略」與「超過上限後的可追溯失敗狀態」
// 收斂成單一資料源：
//   - 指數退避 + 抖動（jitter），並優先遵守上游 Retry-After
//   - 只重試暫時性錯誤（408/425/429/5xx、網路錯誤、timeout）
//   - 超過上限 → 丟出 RetryExhaustedError（code = UPSTREAM_RETRY_EXHAUSTED），
//     內含 source / attempts / lastStatus / 每次嘗試的時間軸
//   - recordRetryFailure() 把該狀態寫進 function_run_logs + data_source_health

export interface RetryPolicy {
  /** 總嘗試次數（含第一次）。 */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** 0~1，實際延遲 = delay * (1 ± jitterRatio*rand)。 */
  jitterRatio: number;
  /** 單次請求 abort 預算。 */
  timeoutMs: number;
  /** 遵守 Retry-After 的上限，避免上游要求我們睡太久。 */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitterRatio: 0.3,
  timeoutMs: 30_000,
  maxRetryAfterMs: 30_000,
};

/** 429 / 408 / 425 / 5xx 視為暫時性；其餘（400/401/403/404…）不重試。 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** 網路層錯誤（連線重置、DNS、abort/timeout）視為暫時性。 */
export function isRetryableNetworkError(err: unknown): boolean {
  const name = (err as Error)?.name ?? '';
  const msg = String((err as Error)?.message ?? err ?? '');
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  return /timed? ?out|network|connection (reset|refused|closed)|ECONNRESET|ENOTFOUND|EAI_AGAIN|stream (closed|error)|http2|tls/i
    .test(msg);
}

/** Retry-After 支援秒數與 HTTP-date 兩種格式；無效回 null。 */
export function parseRetryAfter(header: string | null, nowMs: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return ms >= 0 ? ms : null;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

/**
 * 第 attempt 次失敗後應等待多久（attempt 從 1 起算）。
 * 純函式，方便測試：rand 可注入。
 */
export function computeBackoffDelay(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  retryAfterMs: number | null = null,
  rand: () => number = Math.random,
): number {
  if (retryAfterMs != null && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, policy.maxRetryAfterMs);
  }
  const exp = policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(exp, policy.maxDelayMs);
  // 對稱抖動：capped * (1 ± jitterRatio)
  const jitter = capped * policy.jitterRatio * (rand() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

export interface RetryAttemptInfo {
  attempt: number;
  status?: number;
  error?: string;
  waitedMs?: number;
  elapsedMs: number;
}

export const RETRY_EXHAUSTED_CODE = 'UPSTREAM_RETRY_EXHAUSTED';

export class RetryExhaustedError extends Error {
  readonly code = RETRY_EXHAUSTED_CODE;
  constructor(
    readonly source: string,
    readonly attempts: RetryAttemptInfo[],
    readonly lastStatus: number | null,
    readonly lastDetail: string,
    readonly url: string,
  ) {
    super(
      `retry_exhausted:${source}:attempts=${attempts.length}:` +
        `status=${lastStatus ?? 'network'}:${lastDetail.slice(0, 200)}`,
    );
    this.name = 'RetryExhaustedError';
  }

  get totalWaitMs(): number {
    return this.attempts.reduce((s, a) => s + (a.waitedMs ?? 0), 0);
  }

  /** 可直接寫進 jsonb 的可追溯失敗狀態。 */
  toTrace(): Record<string, unknown> {
    return {
      code: this.code,
      source: this.source,
      url: redactUrl(this.url),
      attempts: this.attempts.length,
      last_status: this.lastStatus,
      last_detail: this.lastDetail.slice(0, 300),
      total_wait_ms: this.totalWaitMs,
      timeline: this.attempts,
    };
  }
}

/** 移除 token / key 等敏感 query 參數，日誌才能安全落地。 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/token|key|secret|password|signature/i.test(k)) u.searchParams.set(k, '***');
    }
    return u.toString();
  } catch {
    return url.replace(/([?&](token|key|secret)=)[^&]*/gi, '$1***');
  }
}

export interface FetchWithRetryOptions {
  /** 追蹤用的上游名稱，例如 'finmind_bsr'、'twse_t86'。 */
  source: string;
  policy?: Partial<RetryPolicy>;
  /** 覆寫「此狀態碼是否重試」判斷。 */
  retryOnStatus?: (status: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  rand?: () => number;
  now?: () => number;
  onAttempt?: (info: RetryAttemptInfo) => void;
  /**
   * F3：給了 supa 就自動把「終局結果」寫進 data_source_health（熔斷器），
   * 呼叫端不必再各自記錄，避免部分來源有統計、部分沒有。
   * `healthSource` 預設等於 `source`。
   */
  health?: {
    supa: { from: (t: string) => any } | null;
    healthSource?: string;
    /** 測試用覆寫。 */
    record?: (source: string, ok: boolean, latencyMs: number, code?: string) => Promise<void>;
  };
}

async function recordHealthOutcome(
  opts: FetchWithRetryOptions,
  ok: boolean,
  latencyMs: number,
  code?: string,
): Promise<void> {
  const h = opts.health;
  if (!h) return;
  const source = h.healthSource ?? opts.source;
  try {
    if (h.record) { await h.record(source, ok, latencyMs, code); return; }
    if (!h.supa) return;
    const { recordCircuit } = await import('./circuitBreaker.ts');
    await recordCircuit(h.supa as any, source, ok, latencyMs, code);
  } catch (e) {
    console.warn('[retryFetch] health_record_failed', (e as Error).message);
  }
}


const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 帶自動重試 / 指數退避的 fetch。
 *  - 成功（或不可重試的狀態碼）→ 直接回傳 Response（呼叫端仍需檢查 res.ok）
 *  - 用盡 maxAttempts → throw RetryExhaustedError
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchWithRetryOptions,
): Promise<Response> {
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...(opts.policy ?? {}) };
  const sleep = opts.sleep ?? defaultSleep;
  const doFetch = opts.fetchImpl ?? fetch;
  const rand = opts.rand ?? Math.random;
  const now = opts.now ?? Date.now;
  const retryOnStatus = opts.retryOnStatus ?? isRetryableStatus;

  const attempts: RetryAttemptInfo[] = [];
  const started = now();
  let lastStatus: number | null = null;
  let lastDetail = '';

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    let res: Response | null = null;
    let netErr: unknown = null;
    try {
      const signal = init.signal ?? AbortSignal.timeout(policy.timeoutMs);
      res = await doFetch(url, { ...init, signal });
    } catch (e) {
      netErr = e;
    }

    if (res && !retryOnStatus(res.status)) {
      attempts.push({ attempt, status: res.status, elapsedMs: now() - started });
      opts.onAttempt?.(attempts[attempts.length - 1]);
      await recordHealthOutcome(
        opts,
        res.ok,
        now() - started,
        res.ok ? undefined : `http_${res.status}`,
      );
      return res;
    }

    if (res) {
      lastStatus = res.status;
      lastDetail = `http_${res.status}`;
    } else {
      if (!isRetryableNetworkError(netErr)) {
        // 非暫時性的 client 端錯誤（例如 URL 格式錯）→ 不重試，原樣往上拋
        await recordHealthOutcome(opts, false, now() - started, 'NON_RETRYABLE_ERROR');
        throw netErr;
      }
      lastStatus = null;
      lastDetail = String((netErr as Error)?.message ?? netErr).slice(0, 300);
    }

    const isLast = attempt >= policy.maxAttempts;
    const retryAfterMs = res ? parseRetryAfter(res.headers.get('retry-after'), now()) : null;
    const waitedMs = isLast ? 0 : computeBackoffDelay(attempt, policy, retryAfterMs, rand);
    const info: RetryAttemptInfo = {
      attempt,
      ...(lastStatus != null ? { status: lastStatus } : {}),
      ...(res ? {} : { error: lastDetail }),
      waitedMs,
      elapsedMs: now() - started,
    };
    attempts.push(info);
    opts.onAttempt?.(info);

    // Response body 不消費會洩漏連線
    if (res) { try { await res.body?.cancel(); } catch { /* ignore */ } }

    if (isLast) break;
    console.warn(
      `[retryFetch] ${opts.source} attempt ${attempt}/${policy.maxAttempts} ` +
        `failed (${lastDetail}) → backoff ${waitedMs}ms`,
    );
    await sleep(waitedMs);
  }

  await recordHealthOutcome(opts, false, now() - started, RETRY_EXHAUSTED_CODE);
  throw new RetryExhaustedError(opts.source, attempts, lastStatus, lastDetail, url);
}

/** 型別守衛，供呼叫端分類錯誤。 */
export function isRetryExhausted(e: unknown): e is RetryExhaustedError {
  return e instanceof RetryExhaustedError ||
    (typeof e === 'object' && e != null && (e as { code?: string }).code === RETRY_EXHAUSTED_CODE);
}

interface MinimalSupa {
  from: (t: string) => any;
}

export interface RetryFailureContext {
  fn: string;
  runId?: string;
  stage?: string;
  /** data_source_health.source；預設用 err.source。 */
  healthSource?: string;
  extra?: Record<string, unknown>;
}

/**
 * 把「重試用盡」寫成可追溯狀態：
 *   1) function_run_logs 一列 error（含完整 attempt timeline）
 *   2) data_source_health 走 circuit breaker，last_error_code = UPSTREAM_RETRY_EXHAUSTED
 * 永不 throw。
 */
export async function recordRetryFailure(
  supa: MinimalSupa | null,
  err: RetryExhaustedError,
  ctx: RetryFailureContext,
): Promise<void> {
  const trace = err.toTrace();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    fn: ctx.fn,
    stage: ctx.stage ?? 'upstream_retry_exhausted',
    ...trace,
    ...(ctx.extra ?? {}),
  });
  console.error(line);
  if (!supa) return;
  try {
    await supa.from('function_run_logs').insert({
      fn: ctx.fn,
      run_id: ctx.runId ?? crypto.randomUUID(),
      level: 'error',
      stage: ctx.stage ?? 'upstream_retry_exhausted',
      msg: `${err.source} retry exhausted after ${err.attempts.length} attempts`,
      payload: { ...trace, ...(ctx.extra ?? {}) },
    });
  } catch (e) {
    console.warn('[retryFetch] run_log_insert_failed', (e as Error).message);
  }
  try {
    const { recordCircuit } = await import('./circuitBreaker.ts');
    await recordCircuit(
      supa,
      ctx.healthSource ?? err.source,
      false,
      err.attempts[err.attempts.length - 1]?.elapsedMs ?? 0,
      RETRY_EXHAUSTED_CODE,
    );
  } catch (e) {
    console.warn('[retryFetch] circuit_record_failed', (e as Error).message);
  }
}
