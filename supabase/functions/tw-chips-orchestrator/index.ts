// tw-chips-orchestrator (P2)
//
// Single-responsibility orchestrator:
//   1. Pick target trade_date (default: today Taipei, or from payload)
//   2. Call reconcile_snapshot(date) — the arbiter decides per-lane seal
//   3. Return structured report
//
// This function does NOT invoke Lane sync functions. Those are already
// triggered by their own crons (finmind-sync waves, institutional-daily-sync).
// The orchestrator runs 5 min after each wave to reconcile state.
//
// Payload:
//   { trade_date?: 'YYYY-MM-DD', wave?: 1|2|3, dry_run?: boolean }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function taipeiToday(): string {
  // Taipei = UTC+8, no DST
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 3600_000);
  return taipei.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const started = Date.now();
  let payload: any = {};
  try {
    if (req.method === 'POST') {
      const text = await req.text();
      payload = text ? JSON.parse(text) : {};
    }
  } catch {
    payload = {};
  }

  const tradeDate: string = payload.trade_date ?? taipeiToday();
  const wave: number = Number(payload.wave ?? 0) || 0;
  const dryRun: boolean = Boolean(payload.dry_run);

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const report: any = {
    trade_date: tradeDate,
    wave,
    dry_run: dryRun,
    started_at: new Date().toISOString(),
  };

  try {
    if (dryRun) {
      report.status = 'skipped_dry_run';
    } else {
      // P4: 先 materialize（將 tw_chip_fact 提拔到 tw_bsr_daily），再 reconcile。
      // 這是防禦性一步 — ingestion 端已經會呼叫，但收斂到編排器可保證所有
      // lane 補寫完成後有一次終局 materialization。
      const { data: mat, error: matErr } = await supa.rpc(
        'materialize_bsr_daily_from_fact',
        { _trade_date: tradeDate },
      );
      if (matErr) throw new Error(`materialize_snapshot: ${matErr.message}`);
      report.materialize = Array.isArray(mat) ? mat[0] : mat;

      const { data, error } = await supa.rpc('reconcile_snapshot', {
        _trade_date: tradeDate,
      });
      if (error) throw new Error(`reconcile_snapshot: ${error.message}`);
      report.reconcile = Array.isArray(data) ? data[0] : data;
      report.status = report.reconcile?.sealed_at ? 'sealed' : 'partial';
    }

    // Fetch final snapshot status for the caller
    const { data: status } = await supa
      .from('tw_bsr_daily_snapshot_status')
      .select(
        'trade_date, status, lane_a_status, lane_b_status, lane_c_status, sealed_at, sealed_by_lane, coverage_stocks, coverage_brokers, updated_at',
      )
      .eq('trade_date', tradeDate)
      .maybeSingle();
    report.snapshot_status = status;

    // Fallback quantification: how many stocks used D-1 fallback today
    let fallbackUsedCount = 0;
    try {
      const { count } = await supa
        .from('tw_chips_rollup')
        .select('stock_id', { count: 'exact', head: true })
        .eq('trade_date', tradeDate)
        .eq('fallback_used', true);
      fallbackUsedCount = count ?? 0;
    } catch { /* ignore */ }
    report.fallback_used_count = fallbackUsedCount;

    report.duration_ms = Date.now() - started;

    // Wave-level observability: persist for keep-warm dashboard
    try {
      await supa.from('tw_bsr_keepwarm_metrics').insert({
        trade_date: tradeDate,
        wave,
        status: report.status ?? 'unknown',
        sealed: Boolean(status?.sealed_at),
        sealed_by_lane: status?.sealed_by_lane ?? null,
        coverage_stocks: Number(status?.coverage_stocks ?? 0),
        coverage_brokers: Number(status?.coverage_brokers ?? 0),
        fallback_used_count: fallbackUsedCount,
        duration_ms: report.duration_ms,
        error: null,
        started_at: report.started_at,
      });
    } catch (e) {
      console.warn('[orchestrator] keepwarm metrics insert failed:', (e as Error).message);
    }

    // Best-effort audit log (never blocks response)
    try {
      await supa.from('function_run_logs').insert({
        function_name: 'tw-chips-orchestrator',
        payload: { trade_date: tradeDate, wave },
        result: report,
        duration_ms: report.duration_ms,
        success: true,
      });
    } catch { /* ignore */ }

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    report.status = 'error';
    report.error = msg;
    report.duration_ms = Date.now() - started;
    console.error('[orchestrator] failed:', msg);
    try {
      await supa.from('tw_bsr_keepwarm_metrics').insert({
        trade_date: tradeDate,
        wave,
        status: 'error',
        sealed: false,
        duration_ms: report.duration_ms,
        error: msg.slice(0, 500),
        started_at: report.started_at,
      });
    } catch { /* ignore */ }
    return new Response(JSON.stringify(report), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
