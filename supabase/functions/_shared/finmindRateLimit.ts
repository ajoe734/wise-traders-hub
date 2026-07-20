// FinMind 全域限流器：以 tw_bsr_api_usage 為滑動視窗（過去 60 分鐘）。
// 上限預設 1,500 次/小時（FinMind 免費層 600/hr、Sponsor 1800/hr 的安全裕度）。
// 收到 HTTP 429 時，caller 應依 Retry-After 指數退避並呼叫 recordCall(...,rateLimited=true)。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const FINMIND_HOURLY_LIMIT = Number(Deno.env.get('FINMIND_HOURLY_LIMIT') ?? 1500);
export const FINMIND_API_NAME = 'finmind';

export interface RateLimitStatus {
  used: number;
  remaining: number;
  allowed: boolean;
  limit: number;
}

export async function checkRateLimit(
  supa: SupabaseClient,
  limit: number = FINMIND_HOURLY_LIMIT,
): Promise<RateLimitStatus> {
  const { data, error } = await supa.rpc('check_bsr_rate_limit', {
    _limit: limit,
    _api: FINMIND_API_NAME,
  });
  if (error) {
    // fail-open with warning：DB 掛了不該擋住所有抓取，但把 remaining 設為 0 提示 caller 節制
    console.warn('[rateLimit] check failed:', error.message);
    return { used: 0, remaining: limit, allowed: true, limit };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    used: Number(row?.used ?? 0),
    remaining: Number(row?.remaining ?? limit),
    allowed: Boolean(row?.allowed ?? true),
    limit,
  };
}

export async function recordCall(
  supa: SupabaseClient,
  opts: { success: boolean; rateLimited?: boolean } = { success: true },
): Promise<void> {
  const { error } = await supa.rpc('record_bsr_api_call', {
    _api: FINMIND_API_NAME,
    _success: opts.success,
    _rate_limited: Boolean(opts.rateLimited),
  });
  if (error) console.warn('[rateLimit] record failed:', error.message);
}

/**
 * 對單一 fetch 加上限流檢查 + 429 指數退避。
 * - 呼叫前若額度用盡：throw RateLimitExhaustedError（caller 應把工作 requeue）
 * - 收到 429：按 Retry-After（或退避）等待後最多重試 maxRetries 次
 */
export class RateLimitExhaustedError extends Error {
  constructor(public status: RateLimitStatus) {
    super(`finmind rate limit exhausted (used ${status.used}/${status.limit})`);
    this.name = 'RateLimitExhaustedError';
  }
}

export async function fetchWithRateLimit(
  supa: SupabaseClient,
  url: string,
  init: RequestInit = {},
  opts: { maxRetries?: number; baseBackoffMs?: number } = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseBackoff = opts.baseBackoffMs ?? 2000;

  const status = await checkRateLimit(supa);
  if (!status.allowed) throw new RateLimitExhaustedError(status);

  let attempt = 0;
  while (true) {
    const res = await fetch(url, init);
    if (res.status !== 429) {
      await recordCall(supa, { success: res.ok, rateLimited: false });
      return res;
    }
    // 429：讀 Retry-After（秒），無則指數退避
    const retryAfterHeader = res.headers.get('retry-after');
    const retrySec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const waitMs = Number.isFinite(retrySec) && retrySec > 0
      ? retrySec * 1000
      : baseBackoff * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
    await recordCall(supa, { success: false, rateLimited: true });
    attempt += 1;
    if (attempt > maxRetries) return res; // 讓 caller 看到 429
    console.warn(`[rateLimit] 429 backoff ${waitMs}ms (attempt ${attempt}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}
