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

    report.duration_ms = Date.now() - started;

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
    return new Response(JSON.stringify(report), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
