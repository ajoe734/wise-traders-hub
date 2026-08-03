// supabase/functions/_shared/backfillWorkerPlan.ts
//
// backfill-worker 的純規劃邏輯單一資料源（不碰網路 / DB，方便單元測試）。
//
// 設計約束（來自 2026-08-03 FinMind 歷史回填修復）：
//   1. 一次 worker run 的 FinMind upstream call 數有硬上限，不能用 job 數當 call budget。
//   2. chip_fact 逐交易日呼叫，長區間必須 checkpoint/resume，不能跑完整 60 天才失敗重來。
//   3. materialize 只針對「實際抓到資料的日期 + 該 stock_id」。
//   4. 全失敗 / 部分失敗不得記為 done。

/** 單次 worker run 允許的 FinMind upstream call 硬上限（不可調高超過此值）。 */
export const MAX_FINMIND_CALLS_PER_RUN = 24;

/** 未指定時的預設 call budget（保守值，對應每小時排程）。 */
export const DEFAULT_FINMIND_CALLS_PER_RUN = 12;

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

/** 追蹤一次 run 的 call 消耗。 */
export class CallBudget {
  readonly limit: number;
  private used = 0;
  constructor(limit: number) {
    this.limit = Math.min(MAX_FINMIND_CALLS_PER_RUN, Math.max(1, Math.floor(limit)));
  }
  get spent(): number { return this.used; }
  get remaining(): number { return Math.max(0, this.limit - this.used); }
  get exhausted(): boolean { return this.remaining <= 0; }
  /** 取用 n 個名額；不足時回傳實際可用數。 */
  take(n = 1): number {
    const got = Math.min(this.remaining, Math.max(0, Math.floor(n)));
    this.used += got;
    return got;
  }
}

export type JobOutcomeStatus = 'done' | 'pending' | 'failed' | 'partial';

/** 把成功抓到資料的日期集合轉成 materialize 呼叫參數（一律帶 _stock_ids）。 */
export function materializeArgs(stockId: string, dates: Iterable<string>): Array<{ _trade_date: string; _stock_ids: string[] }> {
  const uniq = Array.from(new Set(Array.from(dates))).filter(Boolean).sort();
  return uniq.map((d) => ({ _trade_date: d, _stock_ids: [stockId] }));
}

/** 整體 run 的 refresh log status：全成功 done、全失敗 failed、其餘 partial。 */
export function deriveRunStatus(
  results: Array<{ status: string }>,
): 'done' | 'partial' | 'failed' | 'skipped' {
  if (results.length === 0) return 'skipped';
  const ok = results.filter((r) => r.status === 'done').length;
  if (ok === results.length) return 'done';
  if (ok === 0) return 'failed';
  return 'partial';
}

/** admission/quota 用完的錯誤：必須回 pending，不可標 failed、不可卡 running。 */
export function isQuotaExhaustion(errOrCode: unknown): boolean {
  const s = typeof errOrCode === 'string' ? errOrCode : String((errOrCode as Error)?.message ?? errOrCode ?? '');
  return /admission_rejected|daily_exhausted|kill_switch_off|circuit_open|quota|budget_exhausted/i.test(s);
}
