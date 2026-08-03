// supabase/functions/_shared/backfillWorkerPlan.ts
//
// backfill-worker 的純規劃邏輯單一資料源（不碰網路 / DB，方便單元測試）。
//
// 設計約束（2026-08-03 FinMind 歷史回填修復 + 二輪 review）：
//   1. 真正的硬上限是「實際 HTTP attempts」，不是 logical call 數。
//      fetchWithRetry 每個 logical call 最多打 FINMIND_MAX_ATTEMPTS_PER_CALL 次，
//      因此 logical 上限 = MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN / FINMIND_MAX_ATTEMPTS_PER_CALL。
//   2. chip_fact 逐交易日呼叫，長區間必須 checkpoint/resume；遇到失敗日期不得越過。
//   3. materialize 只針對「實際抓到資料的日期 + 該 stock_id」。
//   4. 全失敗不得記為 done；純 quota/budget 安全釋放記為 skipped（不假綠也不假故障）。

/** 每個 logical FinMind call 允許的最大 HTTP attempts（與 fetchWithRetry policy 綁定）。 */
export const FINMIND_MAX_ATTEMPTS_PER_CALL = 3;

/** 單次 worker run 允許的「實際 HTTP attempts」硬上限。 */
export const MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN = 30;

/** 由 HTTP attempts 上限推導出的 logical call 硬上限（10）。 */
export const MAX_FINMIND_CALLS_PER_RUN = Math.floor(
  MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN / FINMIND_MAX_ATTEMPTS_PER_CALL,
);

/** 未指定時的預設 call budget（保守值，對應每小時排程）。 */
export const DEFAULT_FINMIND_CALLS_PER_RUN = 8;

/** 把外部輸入的 call budget 夾在 1..MAX_FINMIND_CALLS_PER_RUN。 */
export function resolveCallBudget(requested?: unknown): number {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FINMIND_CALLS_PER_RUN;
  return Math.min(MAX_FINMIND_CALLS_PER_RUN, Math.max(1, Math.floor(n)));
}

export interface ChipFactPlan {
  /** 本輪要抓的交易日（長度 ≤ budget）。 */
  take: string[];
  /** 尚未處理的交易日；非空代表要 checkpoint/resume。 */
  remaining: string[];
  /** resume 用的下一段起日；null 代表本 job 已跑完。 */
  nextStart: string | null;
}

/** 依照剩餘 call budget 切出本輪要抓的交易日，其餘留給下一輪。 */
export function planChipFactDates(dates: string[], budget: number): ChipFactPlan {
  const safeBudget = Math.max(0, Math.floor(budget));
  const take = dates.slice(0, safeBudget);
  const remaining = dates.slice(take.length);
  return { take, remaining, nextStart: remaining.length > 0 ? remaining[0] : null };
}

/**
 * 決定 checkpoint 的 next_start：
 *   - 有失敗日期 → 一律指回「第一個失敗日期」，下一輪從該日重跑（不得越過造成永久漏資料）。
 *   - 沒有失敗 → 指向第一個尚未處理的日期。
 *   - 都沒有 → null（job 完成）。
 */
export function resolveNextStart(
  firstFailedDate: string | null,
  unprocessedDates: string[],
): string | null {
  if (firstFailedDate) return firstFailedDate;
  return unprocessedDates.length > 0 ? unprocessedDates[0] : null;
}

export type CheckpointReason = 'budget' | 'quota' | 'date_failure';

export type DateFetchResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; code: string; detail: string; quota?: boolean };

export interface ChipFactDateBatch<T> {
  rows: T[];
  ok_dates: string[];
  next_start: string | null;
  checkpoint_reason: CheckpointReason | null;
  failed_date: string | null;
  error_code: string | null;
  error_detail: string | null;
}

/** 逐日執行；任何失敗立刻停止，且不得越過失敗日期。 */
export async function runChipFactDateBatch<T>(
  dates: string[],
  fetchDate: (date: string) => Promise<DateFetchResult<T>>,
): Promise<ChipFactDateBatch<T>> {
  const rows: T[] = [];
  const okDates: string[] = [];
  for (const date of dates) {
    const result = await fetchDate(date);
    if (result.ok) {
      rows.push(...result.rows);
      okDates.push(date);
      continue;
    }
    return {
      rows,
      ok_dates: okDates,
      next_start: date,
      checkpoint_reason: result.quota ? 'quota' : 'date_failure',
      failed_date: result.quota ? null : date,
      error_code: result.code,
      error_detail: result.detail,
    };
  }
  return {
    rows,
    ok_dates: okDates,
    next_start: null,
    checkpoint_reason: null,
    failed_date: null,
    error_code: null,
    error_detail: null,
  };
}

/** 追蹤一次 run 的 logical call 與實際 HTTP attempt 消耗。 */
export class CallBudget {
  readonly limit: number;
  readonly attemptLimit: number;
  private used = 0;
  private attempts = 0;
  constructor(limit: number, attemptLimit: number = MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN) {
    this.limit = Math.min(MAX_FINMIND_CALLS_PER_RUN, Math.max(1, Math.floor(limit)));
    this.attemptLimit = Math.max(1, Math.floor(attemptLimit));
  }
  get spent(): number { return this.used; }
  /** 實際打出去的 HTTP attempts（含 retry）。 */
  get httpAttempts(): number { return this.attempts; }
  get attemptsRemaining(): number { return Math.max(0, this.attemptLimit - this.attempts); }
  /** 尚可發放的 logical call 名額：同時受 logical 與 attempt 上限限制。 */
  get remaining(): number {
    const byLogical = Math.max(0, this.limit - this.used);
    const byAttempts = Math.floor(this.attemptsRemaining / FINMIND_MAX_ATTEMPTS_PER_CALL);
    return Math.min(byLogical, byAttempts);
  }
  get exhausted(): boolean { return this.remaining <= 0; }
  /** 取用 n 個 logical 名額；不足時回傳實際可用數。 */
  take(n = 1): number {
    const got = Math.min(this.remaining, Math.max(0, Math.floor(n)));
    this.used += got;
    return got;
  }
  /** fetchWithRetry 每一次真實 HTTP attempt 都要回報。 */
  recordHttpAttempt(): void { this.attempts += 1; }
  snapshot(): { logical_calls: number; actual_http_attempts: number; call_budget: number; attempt_budget: number } {
    return {
      logical_calls: this.used,
      actual_http_attempts: this.attempts,
      call_budget: this.limit,
      attempt_budget: this.attemptLimit,
    };
  }
}

export type JobOutcomeStatus = 'done' | 'pending' | 'failed' | 'partial' | 'skipped';

/** 把成功抓到資料的日期集合轉成 materialize 呼叫參數（一律帶 _stock_ids）。 */
export function materializeArgs(stockId: string, dates: Iterable<string>): Array<{ _trade_date: string; _stock_ids: string[] }> {
  const uniq = Array.from(new Set(Array.from(dates))).filter(Boolean).sort();
  return uniq.map((d) => ({ _trade_date: d, _stock_ids: [stockId] }));
}

/**
 * 整體 run 的 refresh log status：
 *   - 全成功 → done
 *   - 有成功也有其他 → partial
 *   - 沒有成功但全是 pending/skipped（budget/quota 安全釋放）→ skipped
 *   - 其餘（含任何 failed）→ failed
 */
export function deriveRunStatus(
  results: Array<{ status: string }>,
): 'done' | 'partial' | 'failed' | 'skipped' {
  if (results.length === 0) return 'skipped';
  if (results.some((r) => r.status === 'partial')) return 'partial';
  const ok = results.filter((r) => r.status === 'done').length;
  if (ok === results.length) return 'done';
  if (ok > 0) return 'partial';
  const safeRelease = results.every((r) => r.status === 'pending' || r.status === 'skipped');
  return safeRelease ? 'skipped' : 'failed';
}

export interface WorkerResultSummaryInput {
  job_id: number;
  status: string;
  checkpoint_reason?: CheckpointReason | null;
  code?: string | null;
  failed_date?: string | null;
}

/** 只有 budget checkpoint 算成功；date failure 必須保持 partial。 */
export function summarizeWorkerRun(results: WorkerResultSummaryInput[]): {
  runStatus: 'done' | 'partial' | 'failed' | 'skipped';
  failed: WorkerResultSummaryInput[];
  errorMessage: string | null;
} {
  const normalized = results.map((r) => {
    if (r.status === 'done') return { status: 'done' };
    if (r.status === 'checkpoint') {
      if (r.checkpoint_reason === 'date_failure') return { status: 'partial' };
      if (r.checkpoint_reason === 'quota') return { status: 'skipped' };
      return { status: 'done' };
    }
    if (r.status === 'pending' && isQuotaExhaustion(r.code ?? '')) return { status: 'skipped' };
    return { status: r.status === 'pending' ? 'failed' : r.status };
  });
  const runStatus = deriveRunStatus(normalized);
  const failed = results.filter((_r, i) => normalized[i]?.status !== 'done' && normalized[i]?.status !== 'skipped');
  const errorMessage = failed.length > 0
    ? `${failed.length}/${results.length} jobs partial/failed: ${failed.map((r) =>
      `${r.job_id}:${r.code ?? r.status}${r.failed_date ? `@${r.failed_date}` : ''}`
    ).join(',').slice(0, 400)}`
    : null;
  return { runStatus, failed, errorMessage };
}

/** admission/quota 用完的錯誤：必須回 pending，不可標 failed、不可卡 running。 */
export function isQuotaExhaustion(errOrCode: unknown): boolean {
  const s = typeof errOrCode === 'string' ? errOrCode : String((errOrCode as Error)?.message ?? errOrCode ?? '');
  return /admission_rejected|daily_exhausted|kill_switch_off|circuit_open|quota|budget_exhausted/i.test(s);
}
