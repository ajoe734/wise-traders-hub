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

export { FinmindRow, Aggregated, aggregate } from '../_shared/finmindBsrAggregate.ts';

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
