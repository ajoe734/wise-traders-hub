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
import { fetchWithRetry, isRetryExhausted, recordRetryFailure } from "../_shared/retryFetch.ts";
import {
  classifyBackfillError,
  createRunLogger,
  type BackfillImpact,
  type RunLogger,
} from "../_shared/backfillErrors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FINMIND_URL = "https://api.finmindtrade.com/api/v4/data";
const FINMIND_TOKEN = Deno.env.get("FINMIND_TOKEN") ?? "";

interface Body {
  mode?: "worker" | "manual";
  batch_size?: number;
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
      policy: { maxAttempts: 3, baseDelayMs: 1000, timeoutMs: 30_000 },
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

/** Materialize every date in the range after facts were written. */
async function materializeRange(
  supa: SupabaseClient,
  start: string,
  end: string,
): Promise<{ materialized: number; errors: string[] }> {
  const startD = new Date(start);
  const endD = new Date(end);
  let materialized = 0;
  const errors: string[] = [];
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const { error } = await supa.rpc("materialize_bsr_daily_from_fact", { _trade_date: iso });
    if (error) {
      errors.push(`${iso}:${error.message}`);
    } else {
      materialized += 1;
    }
  }
  return { materialized, errors };
}

async function processChipFact(supa: SupabaseClient, job: Job, log: RunLogger) {
  // BSR 只吃單日（帶 end_date 上游直接 400），因此逐日展開查詢。
  const dates = enumerateTradingDates(job.start_date, job.end_date);
  const rows: FinmindRow[] = [];
  const failedDates: string[] = [];
  const dayErrors: string[] = [];
  const codeTally: Record<string, number> = {};
  for (const date of dates) {
    try {
      const dayRows = await fetchFinmind<FinmindRow>(supa, {
        dataset: "TaiwanStockTradingDailyReport",
        data_id: job.stock_id,
        start_date: date,
      }, job, "bsr_backfill_day");
      rows.push(...dayRows);
    } catch (e) {
      const c = classifyBackfillError(e);
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
    }
  }

  const impact: BackfillImpact = {
    dataset: job.dataset,
    stock_id: job.stock_id,
    start_date: job.start_date,
    end_date: job.end_date,
    days_total: dates.length,
    days_ok: dates.length - failedDates.length,
    days_failed: failedDates.length,
    failed_dates: failedDates.slice(0, 20),
    rows_fetched: rows.length,
  };

  if (dayErrors.length > 0) {
    // 全數失敗才算 job 失敗，避免單日缺料把整段區間標成 failed
    if (rows.length === 0) {
      log.log("error", "chip_fact_all_days_failed", `${job.stock_id} 0/${dates.length} days`, {
        job_id: job.id,
        impact,
        code_tally: codeTally,
      });
      throw new Error(`chip_fact_all_days_failed:${dayErrors[0].split(":").slice(1).join(":")}`);
    }
    log.log("warn", "chip_fact_partial", `${job.stock_id} ${impact.days_ok}/${dates.length} days`, {
      job_id: job.id,
      impact,
      code_tally: codeTally,
    });
  }

  if (rows.length === 0) {
    log.log("info", "chip_fact_empty", `${job.stock_id} empty_response`, { job_id: job.id, impact });
    return { ok: true, rows: 0, stocks: 0, materialized: 0, days: dates.length, note: "empty_response", impact };
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

  const { materialized, errors } = await materializeRange(supa, job.start_date, job.end_date);
  impact.materialized_dates = materialized;
  if (errors.length > 0) {
    impact.materialize_failed_dates = errors.slice(0, 20);
    log.log("warn", "materialize_partial", `${job.stock_id} ${errors.length} dates failed`, {
      job_id: job.id,
      impact,
    });
    if (materialized === 0) throw new Error(`materialize_failed:${errors[0]}`);
  }

  return { ok: true, rows: rows.length, facts: facts.length, materialized, impact };
}

async function processInstitutional(supa: SupabaseClient, job: Job, log: RunLogger) {
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
  }, job, "institutional_backfill_range");

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

async function processFundamentals(supa: SupabaseClient, job: Job, log: RunLogger) {
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
      }, job, "fundamental_revenue_backfill");

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
      }, job, "fundamental_fs_backfill");

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

async function processOne(supa: SupabaseClient, job: Job, log: RunLogger) {
  const t0 = Date.now();
  log.log("info", "job_start", `${job.dataset} ${job.stock_id} ${job.start_date}..${job.end_date}`, {
    job_id: job.id,
    dataset: job.dataset,
    stock_id: job.stock_id,
    start_date: job.start_date,
    end_date: job.end_date,
    attempts: job.attempts,
    source_hint: job.source_hint,
  });
  try {
    let out;
    if (job.dataset === "chip_fact") {
      out = await processChipFact(supa, job, log);
    } else if (job.dataset === "institutional_daily") {
      out = await processInstitutional(supa, job, log);
    } else if (job.dataset === "fundamentals") {
      out = await processFundamentals(supa, job, log);
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
    const batchSize = Math.max(1, Math.min(10, body.batch_size ?? 1));
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
        _batch_size: batchSize,
      });
      if (error) throw error;
      jobs = (data ?? []) as Job[];
    }

    if (jobs.length === 0) {
      log.log("info", "no_jobs", "queue empty", {});
      await log.flush();
      return jsonResponse({ ok: true, mode, processed: 0, run_id: runId });
    }

    const results: Array<{ job_id: number; status: string; code?: string; result: unknown }> = [];
    const codeTally: Record<string, number> = {};
    for (const job of jobs) {
      const outcome = await processOne(supa, job, log);
      let status: string;
      let code: string | undefined;
      if (outcome.ok) {
        status = "done";
        await supa.rpc("backfill_job_set_done", { _id: job.id, _status: "done" });
      } else {
        code = (outcome as { code?: string }).code;
        // retryable → 放回 pending 由下一輪重試；不可重試才標 failed
        status = (outcome as { retryable?: boolean }).retryable ? "pending" : "failed";
        codeTally[code ?? "INTERNAL"] = (codeTally[code ?? "INTERNAL"] ?? 0) + 1;
        await supa.rpc("backfill_job_set_failed", {
          _id: job.id,
          _error: `${code ?? "INTERNAL"}:${(outcome as { error?: string }).error ?? "unknown"}`.slice(0, 500),
        });
      }
      results.push({ job_id: job.id, status, code, result: outcome });
    }

    const failed = results.filter((r) => r.status !== "done");
    log.log(failed.length ? "warn" : "info", "run_summary", `${jobs.length - failed.length}/${jobs.length} done`, {
      processed: jobs.length,
      done: jobs.length - failed.length,
      failed: failed.length,
      code_tally: codeTally,
      affected: results.map((r) => ({ job_id: r.job_id, status: r.status, code: r.code ?? null })),
    });

    await supa.from("data_source_refresh_logs").insert({
      source_key: "backfill_worker",
      status: "done",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      row_count: jobs.length,
      metadata: {
        run_id: runId,
        trigger_source: body.trigger_source ?? "manual",
        code_tally: codeTally,
        results: results.map((r) => ({ job_id: r.job_id, status: r.status, code: r.code ?? null })),
      },
    });

    await log.flush();

    return jsonResponse({
      ok: true,
      mode,
      run_id: runId,
      processed: jobs.length,
      failed: failed.length,
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
