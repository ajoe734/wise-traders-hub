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

