// FinMind 全域限流器（原子 reservation 版本）。
//
// 保證：
//   任何併發下，實際發出的 FinMind API 呼叫在滑動 60 分鐘視窗內 ≤ FINMIND_HOURLY_LIMIT。
//
// 機制：
//   fetch 前先呼叫 reserve_bsr_api_quota RPC，DB 內以 pg_advisory_xact_lock 序列化
//   「檢查用量 + 寫入 reservation」為原子操作。只有拿到 reservation 才能發 fetch。
//   fetch 結束後（成功／429／錯誤）都必須以 settle_bsr_reservation 結算；
//   若 fetch 從未真正送出（例如 client 端例外），則以 release_bsr_reservation 釋放。
//
// Lease / expiry：reservation 有 _lease_seconds（預設 30 秒），超過即由後續 reserve
// 或 purge_expired_bsr_reservations 自動回收，防止 worker crash 造成永久占用。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const FINMIND_HOURLY_LIMIT = Number(Deno.env.get('FINMIND_HOURLY_LIMIT') ?? 1500);
export const FINMIND_API_NAME = 'finmind';
// Lease 蓄意設短：FinMind fetch abort timeout = 20s，多留 5s 給 settle/network。
// 越短，crash / hang 時額度回收越快。任何實際超過 25s 的 worker 都會被自動回收。
export const DEFAULT_LEASE_SECONDS = 25;

export interface RateLimitStatus {
  used: number;
  remaining: number;
  allowed: boolean;
  limit: number;
}

export interface Reservation {
  id: number;
  used: number;
  remaining: number;
}

/** Read-only 讀取（含 in-flight reservation），僅供監控 / dashboard 使用。 */
export async function checkRateLimit(
  supa: SupabaseClient,
  limit: number = FINMIND_HOURLY_LIMIT,
): Promise<RateLimitStatus> {
  const { data, error } = await supa.rpc('check_bsr_rate_limit', {
    _limit: limit,
    _api: FINMIND_API_NAME,
  });
  if (error) {
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

export class RateLimitExhaustedError extends Error {
  constructor(public status: { used: number; limit: number }) {
    super(`finmind rate limit exhausted (used ${status.used}/${status.limit})`);
    this.name = 'RateLimitExhaustedError';
  }
}

/**
 * 嘗試原子預留一格額度；失敗時回傳 null。
 * @param tier tier1 = 最高優先（持倉即時），tier2 = 缺口，tier3 = 歷史回填。
 *             DB 端 `bsr_check_tier_admission` 會依據 tier 保底做 elastic share 准入。
 *             當 admission 拒絕時，本函式回傳 null（與額度耗盡等價，caller 走 fallback）。
 */
export async function reserveQuota(
  supa: SupabaseClient,
  limit: number = FINMIND_HOURLY_LIMIT,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
  correlationId?: string | null,
  tier?: 1 | 2 | 3 | null,
): Promise<Reservation | null> {
  // Elastic-share admission：先問「這個 tier 現在准不准」，被高層擠壓時不 reserve。
  if (tier != null) {
    const { data: adm, error: admErr } = await supa.rpc('bsr_check_tier_admission', {
      _api: FINMIND_API_NAME,
      _tier: tier,
      _limit: limit,
    });
    if (admErr) {
      console.warn('[rateLimit] tier admission check failed, allow-through:', admErr.message);
    } else {
      const row = Array.isArray(adm) ? adm[0] : adm;
      if (row && !row.allowed) {
        console.warn(
          `[rateLimit] tier${tier} denied (${row.reason}) used=${row.hourly_used}/${limit}`,
        );
        return null;
      }
    }
  }

  const { data, error } = await supa.rpc('reserve_bsr_api_quota', {
    _limit: limit,
    _api: FINMIND_API_NAME,
    _lease_seconds: leaseSeconds,
    _correlation_id: correlationId ?? null,
    _tier: tier ?? null,
  });
  if (error) {
    // Fail-CLOSED：DB 出問題時寧可擋下也不冒著超額被 FinMind 封鎖的風險。
    console.error('[rateLimit] reserve failed, deny by default:', error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.granted) return null;
  return {
    id: Number(row.reservation_id),
    used: Number(row.used),
    remaining: Number(row.remaining),
  };
}

export async function settleReservation(
  supa: SupabaseClient,
  id: number,
  opts: { success: boolean; rateLimited?: boolean },
): Promise<void> {
  const { error } = await supa.rpc('settle_bsr_reservation', {
    _reservation_id: id,
    _success: opts.success,
    _rate_limited: Boolean(opts.rateLimited),
  });
  if (error) console.warn('[rateLimit] settle failed:', error.message);
}

export async function releaseReservation(
  supa: SupabaseClient,
  id: number,
): Promise<void> {
  const { error } = await supa.rpc('release_bsr_reservation', { _reservation_id: id });
  if (error) console.warn('[rateLimit] release failed:', error.message);
}

/**
 * 對單一 fetch 加上原子預留 + 429 指數退避。
 *   - 呼叫前若無額度可預留：throw RateLimitExhaustedError（不會打出去）
 *   - 收到 429：先結算當前 reservation，指數退避後重新 reserve 再重試（每次重試都是獨立 reservation）
 *   - fetch 途中拋錯：release 掉當前 reservation，避免額度浪費
 */
export async function fetchWithRateLimit(
  supa: SupabaseClient,
  url: string,
  init: RequestInit = {},
  opts: {
    maxRetries?: number;
    baseBackoffMs?: number;
    limit?: number;
    leaseSeconds?: number;
    correlationId?: string | null;
    tier?: 1 | 2 | 3 | null;
  } = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseBackoff = opts.baseBackoffMs ?? 2000;
  const limit = opts.limit ?? FINMIND_HOURLY_LIMIT;
  const lease = opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const cid = opts.correlationId ?? null;
  const tier = opts.tier ?? null;

  let reservation = await reserveQuota(supa, limit, lease, cid, tier);
  if (!reservation) {
    throw new RateLimitExhaustedError({ used: limit, limit });
  }

  // Finally-scoped safety：只要離開這個函式時 reservation 還未被結算（settled=false），
  // 一律 release 一次；即使 settle RPC 拋錯、上層 caller 沒接 catch、或 runtime 意外中止，
  // 都不會讓 reservation 永遠占著額度。
  let settled = false;
  const safeSettle = async (opts: { success: boolean; rateLimited?: boolean }) => {
    try { await settleReservation(supa, reservation.id, opts); }
    finally { settled = true; }
  };

  try {
    let attempt = 0;
    while (true) {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (e) {
        await safeSettle({ success: false, rateLimited: false });
        throw e;
      }

      if (res.status !== 429) {
        await safeSettle({ success: res.ok, rateLimited: false });
        return res;
      }

      await safeSettle({ success: false, rateLimited: true });
      attempt += 1;
      if (attempt > maxRetries) return res;

      const retryAfterHeader = res.headers.get('retry-after');
      const retrySec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const waitMs = Number.isFinite(retrySec) && retrySec > 0
        ? retrySec * 1000
        : baseBackoff * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
      console.warn(`[rateLimit] 429 backoff ${waitMs}ms (attempt ${attempt}/${maxRetries}) cid=${cid ?? '-'}`);
      await new Promise((r) => setTimeout(r, waitMs));

      const next = await reserveQuota(supa, limit, lease, cid);
      if (!next) {
        throw new RateLimitExhaustedError({ used: limit, limit });
      }
      reservation = next;
      settled = false;
    }
  } finally {
    // 任何未 settle 的殘留 reservation 一律 release，避免額度洩漏
    if (!settled) {
      try { await releaseReservation(supa, reservation.id); }
      catch (e) { console.warn('[rateLimit] finally release failed:', (e as Error).message); }
    }
  }
}
