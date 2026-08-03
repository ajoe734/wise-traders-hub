// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// backfill-worker
// P5: Gap-Driven Opportunistic Backfill worker — 從 backfill_job_queue 領取 job，
// 使用 FinMind date-range API（1 call = 1 stock 的一段日期）回填籌碼面、三大法人、基本面。

import { serviceClient, type SupabaseClient } from '../_shared/supabaseClients.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkKillSwitch } from "../_shared/killSwitch.ts";
import { admitFinmind } from "../_shared/finmindAdmission.ts";
import { aggregate as aggregateBsr, type FinmindRow } from "../_shared/finmindBsrAggregate.ts";
import { enumerateTradingDates } from "../_shared/backfillDates.ts";
import { getTwHolidaysCached } from "../_shared/twTradingCalendar.ts";
import { fetchWithRetry, isRetryExhausted, recordRetryFailure } from "../_shared/retryFetch.ts";
import {
  classifyBackfillError,
  createRunLogger,
  type BackfillImpact,
  type RunLogger,
} from "../_shared/backfillErrors.ts";
import {
  CallBudget,
  FINMIND_MAX_ATTEMPTS_PER_CALL,
  MAX_FINMIND_CALLS_PER_RUN,
  MAX_FINMIND_HTTP_ATTEMPTS_PER_RUN,
  deriveRunStatus,
  isQuotaExhaustion,
  materializeArgs,
  planChipFactDates,
  resolveCallBudget,
  resolveNextStart,
} from "../_shared/backfillWorkerPlan.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FINMIND_URL = "https://api.finmindtrade.com/api/v4/data";
const FINMIND_TOKEN = Deno.env.get("FINMIND_TOKEN") ?? "";

interface Body {
  mode?: "worker" | "manual";
  /** 一次最多領幾個 job（不是 API call 上限）。 */
  batch_size?: number;
  /** 本次 run 的 FinMind upstream call 硬上限（夾在 1..MAX_FINMIND_CALLS_PER_RUN）。 */
  call_budget?: number;
  job_id?: number;
  trigger_source?: string;
}

interface Job {
  id: number;
  dataset: string;
  stock_id: string;
  start_date: string;
  end_date: string;
  source_hint: string;
  attempts: number;
  payload: Record<string, unknown>;
}

async function fetchFinmind<T = unknown>(
  supa: SupabaseClient,
  params: Record<string, string>,
  job: Job,
  kind: string,
  budget?: CallBudget,
): Promise<T[]> {
  const pool = job.dataset === "chip_fact" || job.dataset === "institutional_daily"
    ? "backfill"
    : "backfill";
  const admit = await admitFinmind(supa, {
    pool,
    kind,
    stockId: job.stock_id,
    cost: 1,
    circuitSource: "finmind_bsr",
  });
  if (!admit.granted) {
    throw new Error(`admission_rejected:${admit.reason}:pool=${pool}`);
  }

  const p = new URLSearchParams(params);
  if (FINMIND_TOKEN) p.set("token", FINMIND_TOKEN);
  let res: Response;
  try {
    res = await fetchWithRetry(`${FINMIND_URL}?${p}`, {
      headers: { Accept: "application/json" },
    }, {
      source: "finmind_bsr",
      // maxAttempts 必須與 FINMIND_MAX_ATTEMPTS_PER_CALL 一致，
      // 否則 CallBudget 推導的 HTTP attempts 上限會失真。
      policy: { maxAttempts: FINMIND_MAX_ATTEMPTS_PER_CALL, baseDelayMs: 1000, timeoutMs: 30_000 },
      // 每一次真實 HTTP attempt（含 retry）都計入 run 的硬上限。
      onAttempt: () => budget?.recordHttpAttempt(),
    });
  } catch (e) {

    if (isRetryExhausted(e)) {
      // 重試上限用盡：落地可追溯狀態後，以 canonical 前綴往上拋給 classifyBackfillError
      await recordRetryFailure(supa as any, e as any, {
        fn: "backfill-worker",
        stage: "upstream_retry_exhausted",
        extra: { job_id: job.id, dataset: job.dataset, stock_id: job.stock_id, kind },
      });
      throw new Error(`finmind_retry_exhausted:${(e as Error).message}`);
    }
    throw e;
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`finmind_http_${res.status}:${text.slice(0, 200)}`);
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`finmind_bad_json:${text.slice(0, 200)}`); }
  if (j?.status !== 200 && !Array.isArray(j?.data)) {
    throw new Error(`finmind_api_${j?.status ?? "unknown"}:${String(j?.msg ?? "").slice(0, 200)}`);
  }
  return Array.isArray(j.data) ? (j.data as T[]) : [];
}

/**
 * 只 materialize「本次真的抓到資料的日期」，且限定該 stock_id。
 * 不再對 job 整段區間逐日重算全市場（會 statement timeout 並拖垮 DB）。
 */
async function materializeDates(
  supa: SupabaseClient,
  stockId: string,
  dates: Iterable<string>,
): Promise<{ materialized: number; errors: string[] }> {
  let materialized = 0;
  const errors: string[] = [];
  for (const args of materializeArgs(stockId, dates)) {
    const { error } = await supa.rpc("materialize_bsr_daily_from_fact", args);
    if (error) {
      errors.push(`${args._trade_date}:${error.message}`);
    } else {
      materialized += 1;
    }
  }
  return { materialized, errors };
}

async function processChipFact(supa: SupabaseClient, job: Job, log: RunLogger, budget: CallBudget) {
  // BSR 只吃單日（帶 end_date 上游直接 400），因此逐日展開查詢。
  // 非交易日（週末＋國定假日＋自動偵測的臨時休市）直接跳過，不燒配額。
  const holidays = await getTwHolidaysCached(supa);
  const allDates = enumerateTradingDates(job.start_date, job.end_date, holidays);
  // checkpoint/resume：一次只吃 call budget 允許的天數，其餘寫回 job 續跑。
  const plan = planChipFactDates(allDates, budget.remaining);
  const dates = plan.take;
  const rows: FinmindRow[] = [];
  const okDates: string[] = [];
  const failedDates: string[] = [];
  const dayErrors: string[] = [];
  const codeTally: Record<string, number> = {};
  let quotaStopped = false;
  let firstFailedDate: string | null = null;
  let stoppedIndex = dates.length; // 已「處理過」的日期數（含失敗那一天）
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    if (budget.take(1) === 0) { quotaStopped = true; stoppedIndex = i; break; }
    try {
      const dayRows = await fetchFinmind<FinmindRow>(supa, {
        dataset: "TaiwanStockTradingDailyReport",
        data_id: job.stock_id,
        start_date: date,
      }, job, "bsr_backfill_day", budget);
      rows.push(...dayRows);
      okDates.push(date);
    } catch (e) {
      const c = classifyBackfillError(e);
      if (isQuotaExhaustion((e as Error)?.message)) {
        // 配額 / kill-switch / circuit：停手，剩下的日期留給下一輪，不要把整段燒成 failed。
        quotaStopped = true;
        stoppedIndex = i;
        log.log("warn", "chip_fact_quota_stop", `${job.stock_id} ${date} ${c.code}`, {
          job_id: job.id, stock_id: job.stock_id, trade_date: date, code: c.code, detail: c.detail,
        });
        break;
      }
      codeTally[c.code] = (codeTally[c.code] ?? 0) + 1;
      failedDates.push(date);
      dayErrors.push(`${date}:${c.code}:${c.detail.slice(0, 120)}`);
      log.log("warn", "chip_fact_day_failed", `${job.stock_id} ${date} ${c.code}`, {
        job_id: job.id,
        stock_id: job.stock_id,
        trade_date: date,
        code: c.code,
        retryable: c.retryable,
        upstream_status: c.upstreamStatus ?? null,
        detail: c.detail,
      });
      // 非 quota 的單日失敗：立刻停止，next_start 指回這一天，
      // 否則 checkpoint 會越過失敗日期造成永久漏資料。
      firstFailedDate = date;
      stoppedIndex = i;
      break;
    }
  }

  const unprocessedDates = [...dates.slice(stoppedIndex), ...plan.remaining]
    .filter((d) => d !== firstFailedDate);
  // checkpoint：失敗日期優先；否則指向第一個尚未處理的交易日。
  const nextStart: string | null = resolveNextStart(firstFailedDate, unprocessedDates);


  const impact: BackfillImpact = {
    dataset: job.dataset,
    stock_id: job.stock_id,
    start_date: job.start_date,
    end_date: job.end_date,
    days_total: allDates.length,
    days_ok: okDates.length,
    days_failed: failedDates.length,
    failed_dates: failedDates.slice(0, 20),
    rows_fetched: rows.length,
  };
  (impact as Record<string, unknown>).days_attempted = dates.length;
  (impact as Record<string, unknown>).next_start = nextStart;
  (impact as Record<string, unknown>).quota_stopped = quotaStopped;

  if (dayErrors.length > 0) {
    // 全數失敗才算 job 失敗，避免單日缺料把整段區間標成 failed
    if (rows.length === 0 && !quotaStopped) {
      log.log("error", "chip_fact_all_days_failed", `${job.stock_id} 0/${dates.length} days`, {
        job_id: job.id,
        impact,
        code_tally: codeTally,
      });
      throw new Error(`chip_fact_all_days_failed:${dayErrors[0].split(":").slice(1).join(":")}`);
    }
    log.log("warn", "chip_fact_partial", `${job.stock_id} ${okDates.length}/${dates.length} days`, {
      job_id: job.id,
      impact,
      code_tally: codeTally,
    });
  }

  if (rows.length === 0) {
    log.log("info", "chip_fact_empty", `${job.stock_id} ${quotaStopped ? "quota_stop" : "empty_response"}`, { job_id: job.id, impact });
    return {
      ok: true, rows: 0, stocks: 0, materialized: 0, days: dates.length,
      note: quotaStopped ? "quota_stop" : "empty_response",
      next_start: nextStart, quota_stopped: quotaStopped, impact,
    };
  }

  const agg = aggregateBsr(rows);
  const nowIso = new Date().toISOString();
  const facts = agg.map((r) => ({
    stock_id: r.stock_id,
    trade_date: r.trade_date,
    broker_id: r.broker_id,
    broker_name: r.broker_name,
    source: "finmind_per_stock",
    buy_shares: r.buy_shares,
    sell_shares: r.sell_shares,
    avg_buy_price: r.avg_buy_price,
    avg_sell_price: r.avg_sell_price,
    ingested_at: nowIso,
  }));

  const CHUNK = 500;
  for (let i = 0; i < facts.length; i += CHUNK) {
    const { error } = await supa.from("tw_chip_fact")
      .upsert(facts.slice(i, i + CHUNK), { onConflict: "stock_id,trade_date,broker_id,source" });
    if (error) throw new Error(`chip_fact_upsert:${error.message}`);
  }
  impact.rows_written = facts.length;

  // 只 materialize 實際寫入資料的日期（且限定本 stock_id）。
  const writtenDates = new Set(facts.map((f) => String(f.trade_date)));
  const { materialized, errors } = await materializeDates(supa, job.stock_id, writtenDates);
  impact.materialized_dates = materialized;
  if (errors.length > 0) {
    impact.materialize_failed_dates = errors.slice(0, 20);
    log.log("warn", "materialize_partial", `${job.stock_id} ${errors.length} dates failed`, {
      job_id: job.id,
      impact,
    });
    if (materialized === 0) throw new Error(`materialize_failed:${errors[0]}`);
  }

  return {
    ok: true, rows: rows.length, facts: facts.length, materialized,
    next_start: nextStart, quota_stopped: quotaStopped, impact,
  };
}


async function processInstitutional(supa: SupabaseClient, job: Job, log: RunLogger, budget?: CallBudget) {
  interface RawInst {
    date: string;
    name: string;
    buy: number;
    sell: number;
  }
  const rows = await fetchFinmind<RawInst>(supa, {
    dataset: "TaiwanStockInstitutionalInvestorsBuySell",
    data_id: job.stock_id,
    start_date: job.start_date,
    end_date: job.end_date,
  }, job, "institutional_backfill_range", budget);

  const byDate = new Map<string, { fBuy: number; fSell: number; tBuy: number; tSell: number; dBuy: number; dSell: number }>();
  for (const r of rows) {
    const d = String(r.date || "");
    if (!d) continue;
    const cur = byDate.get(d) || { fBuy: 0, fSell: 0, tBuy: 0, tSell: 0, dBuy: 0, dSell: 0 };
    const name = String(r.name || "");
    const buy = Number(r.buy || 0);
    const sell = Number(r.sell || 0);
    if (name.startsWith("Foreign_Investor") || name === "Foreign_Dealer_Self") {
      cur.fBuy += buy; cur.fSell += sell;
    } else if (name === "Investment_Trust") {
      cur.tBuy += buy; cur.tSell += sell;
    } else if (name.startsWith("Dealer")) {
      cur.dBuy += buy; cur.dSell += sell;
    }
    byDate.set(d, cur);
  }

  const upserts = Array.from(byDate.entries()).map(([date, v]) => {
    const foreign_net = v.fBuy - v.fSell;
    const trust_net = v.tBuy - v.tSell;
    const dealer_net = v.dBuy - v.dSell;
    return {
      stock_id: job.stock_id,
      trade_date: date,
      foreign_net,
      trust_net,
      dealer_net,
      total_net: foreign_net + trust_net + dealer_net,
      raw: { source: "finmind_backfill_range", job_id: job.id },
    };
  });

  const impact: BackfillImpact = {
    dataset: job.dataset,
    stock_id: job.stock_id,
    start_date: job.start_date,
    end_date: job.end_date,
    rows_fetched: rows.length,
    rows_written: upserts.length,
  };

  if (upserts.length === 0) {
    log.log("info", "institutional_empty", `${job.stock_id} empty_response`, { job_id: job.id, impact });
    return { ok: true, rows: 0, note: "empty_response", impact };
  }

  const { error } = await supa.from("tw_institutional_daily")
    .upsert(upserts, { onConflict: "stock_id,trade_date" });
  if (error) throw new Error(`institutional_upsert:${error.message}`);

  return { ok: true, rows: upserts.length, raw_rows: rows.length, impact };
}

async function processFundamentals(supa: SupabaseClient, job: Job, log: RunLogger, budget?: CallBudget) {
  const missingDatasets = Array.isArray(job.payload?.missing_datasets)
    ? (job.payload.missing_datasets as string[])
    : ["monthly_revenue"];

  const results: { dataset: string; inserted: number }[] = [];

  for (const dataset of missingDatasets) {
    if (dataset === "monthly_revenue" || dataset === "revenue") {
      interface RawRev {
        date: string;
        revenue: number;
        revenue_month: string;
        revenue_year?: number;
      }
      const rows = await fetchFinmind<RawRev>(supa, {
        dataset: "TaiwanStockMonthRevenue",
        data_id: job.stock_id,
        start_date: job.start_date,
        end_date: job.end_date,
      }, job, "fundamental_revenue_backfill", budget);

      const upserts = rows.map((r) => ({
        stock_id: job.stock_id,
        report_date: r.date,
        dataset: "monthly_revenue",
        data: r as unknown as object,
        source: "finmind",
      }));
      if (upserts.length > 0) {
        const { error } = await supa.from("stock_fundamentals")
          .upsert(upserts, { onConflict: "stock_id,report_date,dataset" });
        if (error) throw new Error(`fundamental_upsert:${error.message}`);
      }
      results.push({ dataset: "monthly_revenue", inserted: upserts.length });
    } else if (dataset === "financial_statements") {
      interface RawFs {
        date: string;
        [k: string]: unknown;
      }
      const rows = await fetchFinmind<RawFs>(supa, {
        dataset: "TaiwanStockFinancialStatements",
        data_id: job.stock_id,
        start_date: job.start_date,
        end_date: job.end_date,
      }, job, "fundamental_fs_backfill", budget);

      const upserts = rows.map((r) => ({
        stock_id: job.stock_id,
        report_date: r.date,
        dataset: "financial_statements",
        data: r as unknown as object,
        source: "finmind",
      }));
      if (upserts.length > 0) {
        const { error } = await supa.from("stock_fundamentals")
          .upsert(upserts, { onConflict: "stock_id,report_date,dataset" });
        if (error) throw new Error(`fundamental_upsert:${error.message}`);
      }
      results.push({ dataset: "financial_statements", inserted: upserts.length });
    } else {
      results.push({ dataset, inserted: 0 });
    }
  }

  const impact: BackfillImpact = {
    dataset: job.dataset,
    stock_id: job.stock_id,
    start_date: job.start_date,
    end_date: job.end_date,
    rows_written: results.reduce((n, r) => n + r.inserted, 0),
  };
  log.log("info", "fundamentals_done", `${job.stock_id} ${impact.rows_written} rows`, {
    job_id: job.id,
    impact,
    results,
  });
  return { ok: true, results, impact };
}

async function processOne(supa: SupabaseClient, job: Job, log: RunLogger, budget: CallBudget) {
  const t0 = Date.now();
  log.log("info", "job_start", `${job.dataset} ${job.stock_id} ${job.start_date}..${job.end_date}`, {
    job_id: job.id,
    dataset: job.dataset,
    stock_id: job.stock_id,
    start_date: job.start_date,
    end_date: job.end_date,
    attempts: job.attempts,
    source_hint: job.source_hint,
    budget_remaining: budget.remaining,
  });
  try {
    let out;
    if (job.dataset === "chip_fact") {
      out = await processChipFact(supa, job, log, budget);
    } else if (job.dataset === "institutional_daily") {
      if (budget.take(1) === 0) throw new Error("budget_exhausted:no_call_slot");
      out = await processInstitutional(supa, job, log, budget);
    } else if (job.dataset === "fundamentals") {
      const need = Array.isArray(job.payload?.missing_datasets) ? (job.payload.missing_datasets as string[]).length : 1;
      if (budget.take(need) < need) throw new Error("budget_exhausted:no_call_slot");
      out = await processFundamentals(supa, job, log, budget);
    } else {
      throw new Error(`unknown_dataset:${job.dataset}`);
    }
    log.log("info", "job_done", `${job.dataset} ${job.stock_id}`, {
      job_id: job.id,
      ms: Date.now() - t0,
      impact: (out as { impact?: BackfillImpact }).impact ?? null,
    });
    return out as Record<string, unknown> & { ok: true };
  } catch (err) {
    const c = classifyBackfillError(err);
    log.log("error", "job_failed", `${job.dataset} ${job.stock_id} ${c.code}`, {
      job_id: job.id,
      ms: Date.now() - t0,
      code: c.code,
      retryable: c.retryable,
      upstream_status: c.upstreamStatus ?? null,
      detail: c.detail,
      impact: {
        dataset: job.dataset,
        stock_id: job.stock_id,
        start_date: job.start_date,
        end_date: job.end_date,
      } satisfies BackfillImpact,
    });
    return { ok: false as const, error: c.detail.slice(0, 500), code: c.code, retryable: c.retryable };
  }
}

import { requireCronKey, AuthError } from '../_shared/authGuard.ts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsPreflight();

  // AUTH: cron (Phase M-2 runtime enforcement)
  try { requireCronKey(req); }
  catch (e) {
    if (e instanceof AuthError) {
      return new Response(JSON.stringify({ error: e.message, code: e.code }), {
        status: e.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    throw e;
  }


  const body: Body = await req.json().catch(() => ({} as Body));
  const supa = serviceClient();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const log = createRunLogger(supa as never, "backfill-worker", runId, {
    trigger_source: body.trigger_source ?? "manual",
    mode: body.mode ?? "worker",
  });

  try {
    const killSwitch = await checkKillSwitch(supa, "backfill_worker");
    if (!killSwitch) {
      log.log("warn", "kill_switch", "backfill_worker disabled", {});
      await log.flush();
      return jsonResponse({ ok: true, skipped: true, reason: "kill_switch_off", run_id: runId });
    }

    const mode = body.mode ?? "worker";
    // call budget（不是 batch_size）才是真正的 FinMind upstream 上限。
    const budget = new CallBudget(resolveCallBudget(body.call_budget));
    // batch_size 只是「一次最多領幾個 job」，實際跑多少仍由 budget 決定。
    const maxJobs = Math.max(1, Math.min(10, body.batch_size ?? 3));
    let jobs: Job[] = [];

    if (mode === "manual" && body.job_id) {
      const { data, error } = await supa
        .from("backfill_job_queue")
        .select("*")
        .eq("id", body.job_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        log.log("error", "job_not_found", `job ${body.job_id}`, { job_id: body.job_id, code: "JOB_NOT_FOUND" });
        await log.flush();
        return jsonResponse({ ok: false, error: "job_not_found", code: "JOB_NOT_FOUND", run_id: runId }, { status: 404 });
      }
      jobs = [data as unknown as Job];
    } else {
      const { data, error } = await supa.rpc("claim_backfill_jobs", {
        _batch_size: maxJobs,
      });
      if (error) throw error;
      jobs = (data ?? []) as Job[];
    }

    if (jobs.length === 0) {
      log.log("info", "no_jobs", "queue empty", {});
      await log.flush();
      return jsonResponse({ ok: true, mode, processed: 0, run_id: runId, call_budget: budget.limit });
    }

    const results: Array<{ job_id: number; status: string; code?: string; result: unknown }> = [];
    const codeTally: Record<string, number> = {};

    /** 安全釋放：把 job 放回 pending，避免卡在 running。 */
    const releaseToPending = async (jobId: number, reason: string) => {
      const { error } = await supa
        .from("backfill_job_queue")
        .update({ status: "pending", next_run_at: new Date(Date.now() + 60_000).toISOString(), last_error: reason.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("id", jobId);
      if (error) log.log("warn", "release_failed", `${jobId} ${error.message}`, { job_id: jobId });
    };

    for (const job of jobs) {
      if (budget.exhausted) {
        // budget 用完：其餘已領取的 job 立即釋放回 pending（不可留在 running）。
        await releaseToPending(job.id, "BUDGET_EXHAUSTED:released_before_start");
        results.push({ job_id: job.id, status: "pending", code: "BUDGET_EXHAUSTED", result: { skipped: true } });
        codeTally.BUDGET_EXHAUSTED = (codeTally.BUDGET_EXHAUSTED ?? 0) + 1;
        continue;
      }
      const outcome = await processOne(supa, job, log, budget);
      let status: string;
      let code: string | undefined;
      if (outcome.ok) {
        const nextStart = (outcome as { next_start?: string | null }).next_start ?? null;
        if (nextStart) {
          // checkpoint / resume：本段已寫入，剩餘日期改由下一輪從 next_start 續跑。
          status = "checkpoint";
          const { error } = await supa
            .from("backfill_job_queue")
            .update({
              status: "pending",
              start_date: nextStart,
              attempts: 0,
              next_run_at: new Date(Date.now() + 60_000).toISOString(),
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          if (error) {
            log.log("warn", "checkpoint_failed", `${job.id} ${error.message}`, { job_id: job.id });
            await supa.rpc("backfill_job_set_done", { _id: job.id, _status: "done" });
            status = "done";
          }
        } else {
          status = "done";
          await supa.rpc("backfill_job_set_done", { _id: job.id, _status: "done" });
        }
      } else {
        code = (outcome as { code?: string }).code;
        const detail = (outcome as { error?: string }).error ?? "unknown";
        codeTally[code ?? "INTERNAL"] = (codeTally[code ?? "INTERNAL"] ?? 0) + 1;
        if (isQuotaExhaustion(`${code}:${detail}`)) {
          // 配額 / kill-switch / circuit：安全釋放回 pending，不計入 attempts。
          status = "pending";
          await releaseToPending(job.id, `${code ?? "QUOTA"}:${detail}`);
        } else {
          // retryable → 放回 pending 由下一輪重試；不可重試才標 failed
          status = (outcome as { retryable?: boolean }).retryable ? "pending" : "failed";
          await supa.rpc("backfill_job_set_failed", {
            _id: job.id,
            _error: `${code ?? "INTERNAL"}:${detail}`.slice(0, 500),
          });
        }
      }
      results.push({ job_id: job.id, status, code, result: outcome });
    }

    const okStatuses = new Set(["done", "checkpoint"]);
    const failed = results.filter((r) => !okStatuses.has(r.status));
    const runStatus = deriveRunStatus(results.map((r) => ({ status: okStatuses.has(r.status) ? "done" : r.status })));
    log.log(failed.length ? "warn" : "info", "run_summary", `${jobs.length - failed.length}/${jobs.length} ok`, {
      processed: jobs.length,
      done: jobs.length - failed.length,
      failed: failed.length,
      run_status: runStatus,
      calls_spent: budget.spent,
      call_budget: budget.limit,
      code_tally: codeTally,
      affected: results.map((r) => ({ job_id: r.job_id, status: r.status, code: r.code ?? null })),
    });

    await supa.from("data_source_refresh_logs").insert({
      source_key: "backfill_worker",
      // 表格 check constraint 允許 running/success/error/partial/skipped；
      // 細緻結果同時保留在 metadata.run_status，監控不得因部分失敗假綠。
      status: runStatus === "done" ? "success" : runStatus,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      row_count: jobs.length,
      error_message: failed.length
        ? `${failed.length}/${jobs.length} jobs failed: ${failed.map((f) => `${f.job_id}:${f.code ?? f.status}`).join(",").slice(0, 400)}`
        : null,
      metadata: {
        run_id: runId,
        run_status: runStatus,
        trigger_source: body.trigger_source ?? "manual",
        code_tally: codeTally,
        calls_spent: budget.spent,
        call_budget: budget.limit,
        max_calls_per_run: MAX_FINMIND_CALLS_PER_RUN,
        results: results.map((r) => ({ job_id: r.job_id, status: r.status, code: r.code ?? null })),
      },
    });


    await log.flush();

    return jsonResponse({
      ok: true,
      mode,
      run_id: runId,
      status: runStatus,
      processed: jobs.length,
      failed: failed.length,
      calls_spent: budget.spent,
      call_budget: budget.limit,
      code_tally: codeTally,
      results,
    });

  } catch (err) {
    const c = classifyBackfillError(err);
    const msg = (err as Error).message ?? String(err);
    log.log("error", "run_failed", c.code, { code: c.code, retryable: c.retryable, detail: c.detail });
    await log.flush();
    try {
      await supa.from("data_source_refresh_logs").insert({
        source_key: "backfill_worker",
        status: "error",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        metadata: { run_id: runId, error: msg.slice(0, 500), code: c.code, retryable: c.retryable },
      });
    } catch { /* noop */ }
    return errorResponse(`${c.code}:${msg}`, 500);
  }
}

Deno.serve(handler);
