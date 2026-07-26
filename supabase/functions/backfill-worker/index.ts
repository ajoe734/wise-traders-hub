// backfill-worker
// P5: Gap-Driven Opportunistic Backfill worker — 從 backfill_job_queue 領取 job，
// 使用 FinMind date-range API（1 call = 1 stock 的一段日期）回填籌碼面、三大法人、基本面。

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkKillSwitch } from "../_shared/killSwitch.ts";
import { admitFinmind } from "../_shared/finmindAdmission.ts";
import { aggregate as aggregateBsr, type FinmindRow } from "../tw-bsr-finmind-sync/lib.ts";

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
  supa: ReturnType<typeof createClient>,
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
  const res = await fetch(`${FINMIND_URL}?${p}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json" },
  });
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
  supa: ReturnType<typeof createClient>,
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

async function processChipFact(supa: ReturnType<typeof createClient>, job: Job) {
  const rows = await fetchFinmind<FinmindRow>(supa, {
    dataset: "TaiwanStockTradingDailyReport",
    data_id: job.stock_id,
    start_date: job.start_date,
    end_date: job.end_date,
  }, job, "bsr_backfill_range");

  if (rows.length === 0) {
    return { ok: true, rows: 0, stocks: 0, materialized: 0, note: "empty_response" };
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
    net_shares: r.net_shares,
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

  const { materialized, errors } = await materializeRange(supa, job.start_date, job.end_date);
  if (errors.length > 0) {
    console.warn(`[backfill-worker] materialize errors for ${job.stock_id}:`, errors.slice(0, 5));
  }

  return { ok: true, rows: rows.length, facts: facts.length, materialized };
}

async function processInstitutional(supa: ReturnType<typeof createClient>, job: Job) {
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

  if (upserts.length === 0) {
    return { ok: true, rows: 0, note: "empty_response" };
  }

  const { error } = await supa.from("tw_institutional_daily")
    .upsert(upserts, { onConflict: "stock_id,trade_date" });
  if (error) throw new Error(`institutional_upsert:${error.message}`);

  return { ok: true, rows: upserts.length, raw_rows: rows.length };
}

async function processFundamentals(supa: ReturnType<typeof createClient>, job: Job) {
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
        dataset: "TaiwanStockRevenue",
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

  return { ok: true, results };
}

async function processOne(supa: ReturnType<typeof createClient>, job: Job) {
  console.log(`[backfill-worker] processing job ${job.id}: ${job.dataset} ${job.stock_id} ${job.start_date}..${job.end_date}`);
  try {
    if (job.dataset === "chip_fact") {
      return await processChipFact(supa, job);
    } else if (job.dataset === "institutional_daily") {
      return await processInstitutional(supa, job);
    } else if (job.dataset === "fundamentals") {
      return await processFundamentals(supa, job);
    } else {
      throw new Error(`unknown_dataset:${job.dataset}`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.warn(`[backfill-worker] job ${job.id} failed:`, msg);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return corsPreflight();

  const body: Body = await req.json().catch(() => ({} as Body));
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    const killSwitch = await checkKillSwitch(supa, "backfill_worker");
    if (!killSwitch) {
      return json({ ok: true, skipped: true, reason: "kill_switch_off" });
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
      if (!data) return json({ ok: false, error: "job_not_found" }, 404);
      jobs = [data as unknown as Job];
    } else {
      const { data, error } = await supa.rpc("claim_backfill_jobs", {
        _batch_size: batchSize,
      });
      if (error) throw error;
      jobs = (data ?? []) as Job[];
    }

    if (jobs.length === 0) {
      return json({ ok: true, mode, processed: 0, run_id: runId });
    }

    const results: Array<{ job_id: number; status: string; result: unknown }> = [];
    for (const job of jobs) {
      const outcome = await processOne(supa, job);
      let status: string;
      if (outcome.ok) {
        status = "done";
        await supa.rpc("backfill_job_set_done", { _id: job.id, _status: "done" });
      } else {
        status = outcome.error?.startsWith("admission_rejected") ? "pending" : "failed";
        await supa.rpc("backfill_job_set_failed", {
          _id: job.id,
          _error: outcome.error ?? "unknown",
        });
      }
      results.push({ job_id: job.id, status, result: outcome });
    }

    await supa.from("data_source_refresh_logs").insert({
      source_key: "backfill_worker",
      status: "done",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      row_count: jobs.length,
      metadata: { run_id: runId, trigger_source: body.trigger_source ?? "manual", results: results.map((r) => ({ job_id: r.job_id, status: r.status })) },
    });

    return json({
      ok: true,
      mode,
      run_id: runId,
      processed: jobs.length,
      results,
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error("[backfill-worker] error:", msg);
    try {
      await supa.from("data_source_refresh_logs").insert({
        source_key: "backfill_worker",
        status: "error",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        metadata: { run_id: runId, error: msg.slice(0, 500) },
      });
    } catch { /* noop */ }
    return errorResponse(msg, 500);
  }
}

Deno.serve(handler);
