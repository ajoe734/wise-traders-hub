// AUTH: user  (reclassified M-3c-2: 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { jsonResponse, corsHeaders } from '../_shared/cors.ts';

// R2: Retention policy for ops/log tables.
// Auth modes:
//   A) x-cron-secret header matches DATA_UPSERT_API_KEY (for pg_cron)
//   B) Authorization: Bearer <user_jwt> + user has company_admin role (manual run from UI)
const POLICIES: Array<{ table: string; tsColumn: string; days: number }> = [
  { table: 'function_run_logs', tsColumn: 'created_at',  days: 30 },
  { table: 'system_jobs_log',   tsColumn: 'ran_at',      days: 90 },
  { table: 'audit_logs',        tsColumn: 'created_at',  days: 365 }, // compliance retention
  { table: 'perf_metrics',      tsColumn: 'created_at',  days: 14 },
  { table: 'traffic_events',    tsColumn: 'occurred_at', days: 30 },
  { table: 'edge_boot_events',  tsColumn: 'boot_at',     days: 7 },
];

const BATCH = 5000;
const MAX_LOOPS = 50; // hard cap: 250k rows/table/run

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

async function authorize(req: Request): Promise<{ ok: boolean; trigger: 'cron' | 'admin' | null; error?: string }> {
  const cronSecret = Deno.env.get('DATA_UPSERT_API_KEY') ?? '';
  const headerSecret = req.headers.get('x-cron-secret') ?? '';
  if (cronSecret && headerSecret === cronSecret) {
    return { ok: true, trigger: 'cron' };
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, trigger: null, error: 'missing authorization' };
  }
  // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
  try {
    await requireCompanyAdmin(req);
  } catch (_e) {
    return { ok: false, trigger: null, error: 'forbidden' };
  }
  return { ok: true, trigger: 'admin' };
}

Deno.serve(withLogging('cleanup-ops-logs', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const auth = await authorize(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error ?? 'unauthorized' }, { status: 401 });
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
    detail: { trigger: auth.trigger, ...summary },
  });

  return jsonResponse({
    success: !hadError,
    trigger: auth.trigger,
    duration_ms: durationMs,
    summary,
  }, { status: hadError ? 500 : 200 });
}));
