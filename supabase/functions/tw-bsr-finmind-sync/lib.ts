// tw-bsr-finmind-sync/lib.ts
// 純邏輯（無 side effect），從 index.ts 抽出以便 unit test。
// 這些函式一律不能依賴 supa/env/Date.now() 以外的全域狀態。
//
// 日期／交易日 helpers 已遷至 _shared/tradingDate.ts，讓 tw-chips-detail 共用。
// 這裡 re-export 保相容（lib_test.ts 與 index.ts 皆從本檔匯入）。
export {
  taipeiNowFrom,
  toIsoDate,
  addDays,
  isWeekday,
  rollBackToWeekday,
  isAfterCloseAt,
  decideEffectiveDate,
} from '../_shared/tradingDate.ts';

export { aggregate } from '../_shared/finmindBsrAggregate.ts';
export type { FinmindRow, Aggregated } from '../_shared/finmindBsrAggregate.ts';

// ============ 失敗退避決策 ============
/** M4：門檻降至 1，只要有一筆分點即視為 done；<5 由前端加「低品質」標記。 */
export const DONE_BROKER_THRESHOLD = 1;
export const LOW_QUALITY_BROKER_THRESHOLD = 5;

/**
 * 失敗後 next_run 與 status：對齊 index.ts 中 worker 失敗分支。
 * - attempts >= max_attempts → failed，不再排程
 * - 否則 pending，next_run_at = now + min(120, 2^attempts * 5) 分鐘
 */
export function decideFailureRetry(opts: {
  attempts: number;
  maxAttempts: number;
  nowMs: number;
}): { status: 'pending' | 'failed'; nextRunAt: string | null; backoffMinutes: number } {
  const backoffMinutes = Math.min(120, Math.pow(2, opts.attempts) * 5);
  const shouldFail = opts.attempts >= opts.maxAttempts;
  return {
    status: shouldFail ? 'failed' : 'pending',
    nextRunAt: shouldFail ? null : new Date(opts.nowMs + backoffMinutes * 60_000).toISOString(),
    backoffMinutes,
  };
}

// ============ Quota 拒絕（admission gate）專用轉移 ============
/**
 * quota 拒絕不是「這檔股票抓不到」，而是「這一輪沒配額」。
 * 若照一般失敗路徑走，attempts 會被吃掉、五輪後直接 failed，
 * 而 partial unique index 會讓該 stock/date 永遠無法重新入列（飢餓）。
 */
export function isQuotaRejection(error?: string | null): boolean {
  return typeof error === 'string' && error.startsWith('finmind_admission_');
}

/**
 * quota 拒絕的合法轉移：status 回 pending、延後 15~60 分、attempts 抵銷回 claim 前的值。
 *
 * claim_bsr_queue_jobs 會在 claim 當下做 `attempts = attempts + 1`，並 RETURNING 更新後的列，
 * 因此 worker 手上的 job.attempts 已經是「claim 後」的值；抵銷 = attempts - 1，
 * 並以 GREATEST(...,0) 防負值（真正的扣減在 SQL 端原子完成，此處僅供決策與測試）。
 */
export function decideQuotaDeferral(opts: {
  attempts: number;
  nowMs: number;
  jitter?: number;
}): {
  status: 'pending';
  attemptsAfter: number;
  delayMinutes: number;
  nextRunAt: string;
  lastError: 'quota_deferred';
} {
  const j = Math.min(Math.max(opts.jitter ?? 0, 0), 1);
  const delayMinutes = 15 + Math.floor(j * 45); // 15~60 分鐘
  return {
    status: 'pending',
    attemptsAfter: Math.max(0, (opts.attempts ?? 0) - 1),
    delayMinutes,
    nextRunAt: new Date(opts.nowMs + delayMinutes * 60_000).toISOString(),
    lastError: 'quota_deferred',
  };
}


// ============ Build 1f：token 優先的 stable partition ============
/** recovery token job 的辨識標記（由 recover_quota_failed_bsr_jobs 寫入 last_error）。 */
export const RECOVERY_TOKEN_MARK = 'quota_recovery_token';

export function isRecoveryTokenJob(job: { last_error?: string | null } | null | undefined): boolean {
  return !!job && job.last_error === RECOVERY_TOKEN_MARK;
}

/**
 * Stable partition：所有 recovery token job 移到最前面，token 之間、non-token 之間
 * 的相對順序都保持不變。
 *
 * 為什麼要在 Edge 再做一次：DB 端 claim_bsr_queue_jobs 已用 `ORDER BY bucket` 保證
 * token 在第一列，但 PostgREST/驅動層對 SETOF 回傳順序不做契約保證。worker 是
 * 「共享 index 依序取件」，token 若落在陣列尾端且 budgetMs 先到，就會整輪被餓死。
 * 這裡是防禦性保險；production 每次 invocation 最多 1 個 token 由 DB 保證，
 * 但本函式對「意外多個 token」仍必須是 stable partition，不是只提前第一個。
 */
export function partitionTokenFirst<T extends { last_error?: string | null }>(jobs: T[]): T[] {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  const tokens: T[] = [];
  const rest: T[] = [];
  for (const j of jobs) {
    if (isRecoveryTokenJob(j)) tokens.push(j);
    else rest.push(j);
  }
  return tokens.concat(rest);
}
