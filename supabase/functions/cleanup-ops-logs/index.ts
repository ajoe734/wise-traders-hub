import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { jsonResponse } from '../_shared/cors.ts';

// R2: Retention policy for ops/log tables.
// Run daily 04:00 Asia/Taipei via pg_cron.
// Protected by x-cron-secret header (set CRON_SECRET in edge fn env).
const POLICIES: Array<{ table: string; tsColumn: string; days: number }> = [
  { table: 'function_run_logs', tsColumn: 'created_at', days: 30 },
  { table: 'system_jobs_log',   tsColumn: 'ran_at',     days: 90 },
  { table: 'audit_logs',        tsColumn: 'created_at', days: 365 }, // compliance
  { table: 'perf_metrics',      tsColumn: 'created_at', days: 14 },
  { table: 'traffic_events',    tsColumn: 'occurred_at', days: 30 },
];

const BATCH = 5000;
const MAX_LOOPS = 50; // hard cap: 250k rows per table per run

async function pruneTable(
  supabase: ReturnType<typeof serviceClient>,
  table: string,
  tsColumn: string,
  cutoff: string,
): Promise<{ deleted: number; loops: number; error?: string }> {
  let totalDeleted = 0;
  let loops = 0;
  while (loops < MAX_LOOPS) {
    loops += 1;
    // PostgREST cannot do "DELETE ... LIMIT", so use a subquery via RPC-style:
    // fetch oldest N ids then delete by id list.
    const { data: rows, error: selErr } = await supabase
      .from(table)
      .select('id')
      .lt(tsColumn, cutoff)
      .order(tsColumn, { ascending: true })
      .limit(BATCH);
    if (selErr) return { deleted: totalDeleted, loops, error: selErr.message };
    if (!rows || rows.length === 0) break;
    const ids = rows.map((r: { id: string }) => r.id);
    const { error: delErr } = await supabase.from(table).delete().in('id', ids);
    if (delErr) return { deleted: totalDeleted, loops, error: delErr.message };
    totalDeleted += ids.length;
    if (rows.length < BATCH) break;
  }
  return { deleted: totalDeleted, loops };
}

Deno.serve(withLogging('cleanup-ops-logs', async (req) => {
  // Cron secret auth (server-to-server only; no public access).
  // Reuse DATA_UPSERT_API_KEY as cron secret (already used by knowledge-draft-scheduler).
  const cronSecret = Deno.env.get('DATA_UPSERT_API_KEY') ?? '';
  const headerSecret = req.headers.get('x-cron-secret') ?? '';
  if (!cronSecret || headerSecret !== cronSecret) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = serviceClient();
  const startedAt = Date.now();
  const summary: Record<string, unknown> = {};
  let hadError = false;

  for (const policy of POLICIES) {
    const cutoff = new Date(Date.now() - policy.days * 86400_000).toISOString();
    const result = await pruneTable(supabase, policy.table, policy.tsColumn, cutoff);
    summary[policy.table] = { ...result, cutoff, retention_days: policy.days };
    if (result.error) hadError = true;
  }

  const durationMs = Date.now() - startedAt;
  await supabase.from('system_jobs_log').insert({
    job_name: 'cleanup-ops-logs',
    status: hadError ? 'error' : 'success',
    duration_ms: durationMs,
    detail: summary,
  });

  return jsonResponse({
    success: !hadError,
    duration_ms: durationMs,
    summary,
  }, { status: hadError ? 500 : 200 });
}));
