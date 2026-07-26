// backfill-gap-orchestrator
// P5: Gap-Driven Opportunistic Backfill — 缺口掃描 + 通用回填佇列入列。
//
// 模式：
//   "scan_only" 只掃描缺口，不寫入 queue。
//   "run"       掃描並入列，上限由 max_scan_jobs / max_dispatch_jobs 控制。
//   "enqueue"   直接入列由 request 提供的 jobs 陣列。
//   "stats"     回傳 queue 統計。
//
// 排程：
//   - cron-sunday:   週日 10:00 UTC (18:00 台北)，大量回填 60 日。
//   - cron-weeknight: 週一至週五 18:00 UTC (隔日 02:00 台北)， opportunistic 回填。
//   - cron-spot:     每 10 分鐘由 backfill-worker 消費。

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkKillSwitch } from "../_shared/killSwitch.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function nowTW(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function todayTW(): string {
  const d = nowTW();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isSundayTW(): boolean {
  return nowTW().getDay() === 0;
}

interface BackfillJob {
  dataset: string;
  stock_id: string;
  start_date: string;
  end_date: string;
  priority_score: number;
  source_hint: string;
  max_attempts: number;
  payload: Record<string, unknown>;
}

interface Body {
  mode?: string;
  max_scan_jobs?: number;
  max_dispatch_jobs?: number;
  lookback_days?: number;
  trigger_source?: string;
  jobs?: BackfillJob[];
  correlation_id?: string;
}

function isAdmin(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === SERVICE_ROLE_KEY;
}

function cors(req: Request): Response | null {
  if (req.method === "OPTIONS") return corsPreflight();
  return null;
}

export default async function handler(req: Request): Promise<Response> {
  const c = cors(req);
  if (c) return c;

  const body: Body = await req.json().catch(() => ({} as Body));
  const mode = body.mode ?? "scan_only";
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const correlationId = body.correlation_id ?? crypto.randomUUID();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  try {
    if (mode === "stats") {
      const { data, error } = await supa.rpc("backfill_queue_stats");
      if (error) throw error;
      return jsonResponse({ ok: true, mode, stats: data ?? [] });
    }

    if (mode === "enqueue") {
      if (!isAdmin(req)) {
        return errorResponse("admin_required", 403, { code: "FORBIDDEN" });
      }
      const jobs = Array.isArray(body.jobs) ? body.jobs : [];
      if (jobs.length === 0) {
        return jsonResponse({ ok: true, mode: "enqueue", inserted: 0, skipped: 0, jobs: [] });
      }
      const { data, error } = await supa.rpc("enqueue_backfill_jobs", {
        _jobs: jobs as unknown as object,
      });
      if (error) throw error;
      return jsonResponse({
        ok: true,
        mode: "enqueue",
        inserted: (data as unknown as { inserted: number })?.inserted ?? 0,
        skipped: (data as unknown as { skipped: number })?.skipped ?? 0,
        jobs_submitted: jobs.length,
      });
    }

    const killSwitch = await checkKillSwitch(supa, "backfill_gap_orchestrator");
    if (!killSwitch) {
      return jsonResponse({ ok: true, mode, skipped: true, reason: "kill_switch_off" });
    }

    const maxScan = Math.max(0, Math.min(5000, body.max_scan_jobs ?? 500));
    const maxDispatch = Math.max(0, Math.min(3000, body.max_dispatch_jobs ?? 100));
    const lookback = Math.max(1, Math.min(180, body.lookback_days ?? 60));
    const targetDate = todayTW();
    const isSunday = isSundayTW();
    const triggerSource = body.trigger_source ?? "manual";

    // 1. 掃描三種資料集缺口
    const [chipScan, instScan, fundScan] = await Promise.all([
      supa.rpc("detect_chip_gap_jobs", {
        _target_date: targetDate,
        _lookback_days: lookback,
        _max_jobs: maxScan,
      }),
      supa.rpc("detect_institutional_gap_jobs", {
        _target_date: targetDate,
        _lookback_days: lookback,
        _max_jobs: maxScan,
      }),
      supa.rpc("detect_fundamental_gap_jobs", {
        _target_date: targetDate,
        _max_jobs: Math.floor(maxScan / 3),
      }),
    ]);

    if (chipScan.error) throw chipScan.error;
    if (instScan.error) throw instScan.error;
    if (fundScan.error) throw fundScan.error;

    const chipGaps = (chipScan.data ?? []) as Array<{ stock_id: string; start_date: string; end_date: string; gap_count: number }>;
    const instGaps = (instScan.data ?? []) as Array<{ stock_id: string; start_date: string; end_date: string; gap_count: number }>;
    const fundGaps = (fundScan.data ?? []) as Array<{ stock_id: string; start_date: string; end_date: string; gap_count: number; missing_datasets: string[] }>;

    const scanSummary = {
      chip: chipGaps.length,
      institutional: instGaps.length,
      fundamentals: fundGaps.length,
      chip_total_missing_days: chipGaps.reduce((s, g) => s + (g.gap_count || 0), 0),
      inst_total_missing_days: instGaps.reduce((s, g) => s + (g.gap_count || 0), 0),
      fund_total_missing_periods: fundGaps.reduce((s, g) => s + (g.gap_count || 0), 0),
    };

    if (mode === "scan_only") {
      return jsonResponse({
        ok: true,
        mode: "scan_only",
        target_date: targetDate,
        lookback_days: lookback,
        is_sunday: isSunday,
        summary: scanSummary,
        chip_samples: chipGaps.slice(0, 10),
        inst_samples: instGaps.slice(0, 10),
        fund_samples: fundGaps.slice(0, 10),
      });
    }

    // 2. 組裝 jobs（依缺口數與是否週日調整優先分數）
    const jobs: BackfillJob[] = [];
    let budget = maxDispatch;

    const append = (
      dataset: string,
      gaps: Array<{ stock_id: string; start_date: string; end_date: string; gap_count?: number; missing_datasets?: string[] }>,
    ) => {
      for (const g of gaps) {
        if (budget <= 0) break;
        const basePriority = (g.gap_count || 0) + (isSunday ? 10 : 0);
        // 週日長回填：把整個範圍合成一個 job；若範圍過長 (>20 天) 拆成多個 20 日區間
        const start = new Date(g.start_date);
        const end = new Date(g.end_date);
        let cursor = new Date(start);
        while (cursor <= end && budget > 0) {
          const chunkEnd = new Date(cursor);
          chunkEnd.setDate(chunkEnd.getDate() + 19);
          if (chunkEnd > end) chunkEnd.setTime(end.getTime());
          const payload: Record<string, unknown> = {
            trigger_source: triggerSource,
            run_id: runId,
            original_gap_count: g.gap_count,
          };
          if (g.missing_datasets) payload.missing_datasets = g.missing_datasets;
          jobs.push({
            dataset,
            stock_id: g.stock_id,
            start_date: cursor.toISOString().slice(0, 10),
            end_date: chunkEnd.toISOString().slice(0, 10),
            priority_score: basePriority,
            source_hint: "finmind",
            max_attempts: 3,
            payload,
          });
          budget -= 1;
          cursor.setDate(cursor.getDate() + 20);
        }
      }
    };

    append("chip_fact", chipGaps);
    append("institutional_daily", instGaps);
    append("fundamentals", fundGaps);

    // 3. 入列
    let inserted = 0;
    let skipped = 0;
    if (jobs.length > 0) {
      const { data, error } = await supa.rpc("enqueue_backfill_jobs", {
        _jobs: jobs as unknown as object,
      });
      if (error) throw error;
      const res = data as unknown as { inserted: number; skipped: number };
      inserted = res?.inserted ?? 0;
      skipped = res?.skipped ?? 0;
    }

    await supa.from("data_source_refresh_logs").insert({
      source_key: "backfill_gap_orchestrator",
      status: "done",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      row_count: inserted,
      metadata: {
        run_id: runId,
        correlation_id: correlationId,
        trigger_source: triggerSource,
        target_date: targetDate,
        lookback_days: lookback,
        is_sunday: isSunday,
        scan_summary: scanSummary,
        jobs_submitted: jobs.length,
        inserted,
        skipped,
      },
    });

    return jsonResponse({
      ok: true,
      mode: "run",
      target_date: targetDate,
      is_sunday: isSunday,
      lookback_days: lookback,
      summary: scanSummary,
      jobs_submitted: jobs.length,
      inserted,
      skipped,
      run_id: runId,
      correlation_id: correlationId,
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error("[backfill-gap-orchestrator] error:", msg);
    try {
      await supa.from("data_source_refresh_logs").insert({
        source_key: "backfill_gap_orchestrator",
        status: "error",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - new Date(startedAt).getTime(),
        metadata: { run_id: runId, correlation_id: correlationId, error: msg.slice(0, 500) },
      });
    } catch { /* noop */ }
    return errorResponse(msg, 500);
  }
}

Deno.serve(handler);
