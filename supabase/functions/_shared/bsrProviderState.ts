/**
 * bsrProviderState — 券商分點（BSR）上游狀態的**唯一分類器**（Plan v2 §2.2）。
 *
 * 為什麼要這支：
 *   舊行為只看 queue.status，pending 就叫「同步中／下輪自動重試」。但 production 實測
 *   FinMind 回的是 HTTP 400 `Your level is register. Please update your user level.`
 *   —— 這是永久的方案／資格拒絕，不是暫時性錯誤，backoff 再久也不會好。
 *   反過來，其他 400（參數／日期／代號錯）不能被當成永久拒絕而讓 worker 永遠停手。
 *
 * 因此狀態拆三類：
 *   terminal_provider_rejected —— 只有 **exact 已知永久簽章** 才算，worker 可停止重試。
 *   retryable                 —— 明確 429 / 5xx / timeout / network。
 *   unknown_degraded          —— 判不出來：UI 不承諾恢復時間，但 worker 仍可有限次重試。
 *
 * 這支是 pure function：不打 DB、不打網路、不寫 log，worker（Stage B）與
 * tw-chips-detail-v2（Stage A）共用同一份，避免兩邊語意再度漂移。
 *
 * 安全：輸入允許帶 raw upstream 字串（僅供 pattern matching），輸出**只有** enum 與
 * 白名單 code，永不回傳 raw body、token、URL。
 */

export type BsrProviderState =
  | 'ineligible'
  | 'terminal_provider_rejected'
  | 'retryable'
  | 'unknown_degraded'
  | 'fresh'
  | 'stale_no_error';

/** 對外安全代碼白名單（payload 只能出現這些值）。 */
export const BSR_PROVIDER_CODES = [
  'ineligible',
  'provider_plan_rejected',
  'upstream_rate_limited',
  'upstream_5xx',
  'upstream_timeout',
  'upstream_network',
  'unclassified',
  'ok',
  'stale',
] as const;

export type BsrProviderCode = typeof BSR_PROVIDER_CODES[number];

export interface BsrProviderInput {
  eligible: boolean;
  /** 已落地的最新 BSR 日期（YYYY-MM-DD），無資料為 null */
  bsrAsOf: string | null;
  /** 期望交易日（YYYY-MM-DD） */
  expectedDate: string | null;
  queueStatus: 'pending' | 'running' | 'failed' | 'skipped' | 'done' | null;
  /** tw_bsr_fetch_failures.last_error / queue.last_error；僅供分類，**不得外流** */
  lastErrorRaw: string | null;
  /** tw_bsr_fetch_failures.error_class（Stage B 之後才會有值） */
  persistedErrorClass: string | null;
  attempts: number;
  maxAttempts: number;
}

export interface BsrProviderVerdict {
  state: BsrProviderState;
  code: BsrProviderCode;
  /** worker 是否可再排程（unknown_degraded 在 attempts 未達上限時仍為 true） */
  retryable: boolean;
  /** 有無舊資料可顯示（決定 UI 要不要講「顯示前次成功資料」） */
  hasStaleData: boolean;
  /** UI 是否可承諾「自動重試 / next_retry_at」 */
  nextRetryAllowed: boolean;
}

/** 已知的永久拒絕簽章（正規化後比對）。新增前必須有 production 實例佐證。 */
const TERMINAL_SIGNATURES: RegExp[] = [
  /your level is register/,
  /please update your user level/,
  /sponsor level required/,
  /upgrade your (account|plan|level)/,
];

/** 已持久化的 terminal error_class。 */
const TERMINAL_ERROR_CLASSES = new Set(['provider_plan_rejected']);

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\\"']/g, ' ')
    .replace(/[^a-z0-9_ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHttpStatus(norm: string): number | null {
  const m = norm.match(/http[_ ](\d{3})/);
  return m ? Number(m[1]) : null;
}

type ErrorVerdict = { state: 'terminal_provider_rejected' | 'retryable' | 'unknown_degraded'; code: BsrProviderCode };

/**
 * 只看錯誤字串／error_class 的分類（不含 eligibility 與新鮮度）。
 * 匯出供 worker（Stage B）在寫 failure row 時決定 error_class 用。
 */
export function classifyBsrError(
  lastErrorRaw: string | null,
  persistedErrorClass: string | null = null,
): ErrorVerdict | null {
  if (persistedErrorClass && TERMINAL_ERROR_CLASSES.has(persistedErrorClass)) {
    return { state: 'terminal_provider_rejected', code: 'provider_plan_rejected' };
  }
  if (!lastErrorRaw || !String(lastErrorRaw).trim()) return null;

  const norm = normalize(String(lastErrorRaw));
  const status = extractHttpStatus(norm);

  // terminal 只認 exact 簽章；且必須是 4xx（永久資格拒絕），不能拿 5xx 的錯誤內文誤判。
  const signatureHit = TERMINAL_SIGNATURES.some((re) => re.test(norm));
  if (signatureHit && (status === null || (status >= 400 && status < 500))) {
    return { state: 'terminal_provider_rejected', code: 'provider_plan_rejected' };
  }

  if (status === 429 || /rate[_ ]?limit/.test(norm)) {
    return { state: 'retryable', code: 'upstream_rate_limited' };
  }
  if (status !== null && status >= 500) {
    return { state: 'retryable', code: 'upstream_5xx' };
  }
  if (/timed? ?out|timeout|aborterror|abort error|deadline exceeded/.test(norm)) {
    return { state: 'retryable', code: 'upstream_timeout' };
  }
  if (/network|econnreset|socket|dns|fetch failed|connection (refused|reset)/.test(norm)) {
    return { state: 'retryable', code: 'upstream_network' };
  }

  // 其餘（含非簽章的 400／bad json／未知字串）一律 unknown_degraded：
  // UI 不承諾恢復時間，但 worker 仍可有限次重試。
  return { state: 'unknown_degraded', code: 'unclassified' };
}

/**
 * precedence（固定）：
 *   ineligible > terminal_provider_rejected > retryable > unknown_degraded > fresh > stale_no_error
 *
 * 注意：呼叫端若判定資料已是最新（bsrAsOf >= expectedDate），應把 lastErrorRaw 傳 null，
 * 避免歷史殘留錯誤覆蓋 fresh 狀態。
 */
export function classifyBsrProvider(input: BsrProviderInput): BsrProviderVerdict {
  const hasStaleData = !!input.bsrAsOf;

  if (!input.eligible) {
    return {
      state: 'ineligible',
      code: 'ineligible',
      retryable: false,
      hasStaleData,
      nextRetryAllowed: false,
    };
  }

  const err = classifyBsrError(input.lastErrorRaw, input.persistedErrorClass);

  if (err?.state === 'terminal_provider_rejected') {
    return {
      state: 'terminal_provider_rejected',
      code: err.code,
      retryable: false,
      hasStaleData,
      nextRetryAllowed: false,
    };
  }

  if (err?.state === 'retryable') {
    const queued = input.queueStatus === 'pending' || input.queueStatus === 'running';
    const underCap = Number(input.attempts || 0) < Number(input.maxAttempts || 5);
    return {
      state: 'retryable',
      code: err.code,
      retryable: underCap,
      hasStaleData,
      nextRetryAllowed: underCap && queued,
    };
  }

  if (err?.state === 'unknown_degraded') {
    const underCap = Number(input.attempts || 0) < Number(input.maxAttempts || 5);
    return {
      state: 'unknown_degraded',
      code: 'unclassified',
      // worker 仍可有限次重試；UI 一律不承諾。
      retryable: underCap,
      hasStaleData,
      nextRetryAllowed: false,
    };
  }

  // 沒有未解錯誤：看新鮮度
  const fresh = !!(input.bsrAsOf && input.expectedDate && input.bsrAsOf >= input.expectedDate);
  if (fresh) {
    return { state: 'fresh', code: 'ok', retryable: false, hasStaleData, nextRetryAllowed: false };
  }

  const queued = input.queueStatus === 'pending' || input.queueStatus === 'running';
  return {
    state: 'stale_no_error',
    code: 'stale',
    retryable: queued,
    hasStaleData,
    nextRetryAllowed: queued,
  };
}
