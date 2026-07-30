// AUTH: user  (reclassified M-3c-2: 2026-07-27, see docs/security/edge-function-auth-matrix.md)

// S13 Observability & Cost — 統一後端健康 / 成本一覽
// 回傳：
//   - functions: 近 7 天 edge function 執行統計（runs, errors, error_rate, last_seen）
//   - jobs: 近 7 天 cron / 排程任務統計（success, fail, p95_ms, last_status, last_ran_at）
//   - logTables: 各 log 表 row count（含 7d/30d 老資料數，協助控制成本）
//   - recentErrors: 近 24h 最後 50 筆 error level log
//   - generatedAt

import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { requireCompanyAdmin, authErrorResponse } from '../_shared/adminGuard.ts';
interface FnRow { fn: string; runs: number; errors: number; warns: number; last_seen: string | null; }
interface JobRow { job_name: string; runs: number; success: number; fail: number; p95_ms: number | null; last_status: string | null; last_ran_at: string | null; }
interface TableRow { table: string; total: number; older_than_7d: number; older_than_30d: number; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
    try {
      await requireCompanyAdmin(req);
    } catch (e) {
      return authErrorResponse(e, req);
    }

    const admin = serviceClient();

    const now = Date.now();
    const since7d = new Date(now - 7 * 86400_000).toISOString();
    const since24h = new Date(now - 86400_000).toISOString();
    const since30d = new Date(now - 30 * 86400_000).toISOString();

    // ---- functions: aggregate from function_run_logs (last 7d) ----
    const { data: fnLogs, error: fnErr } = await admin
      .from('function_run_logs')
      .select('fn, level, created_at')
      .gte('created_at', since7d)
      .limit(50000);
    if (fnErr) throw fnErr;
    const fnMap = new Map<string, FnRow>();
    for (const r of fnLogs ?? []) {
      const row = fnMap.get(r.fn) ?? { fn: r.fn, runs: 0, errors: 0, warns: 0, last_seen: null };
      row.runs += 1;
      if (r.level === 'error') row.errors += 1;
      else if (r.level === 'warn') row.warns += 1;
      if (!row.last_seen || r.created_at > row.last_seen) row.last_seen = r.created_at;
      fnMap.set(r.fn, row);
    }
    const functions = Array.from(fnMap.values())
      .map(f => ({ ...f, error_rate: f.runs ? +(f.errors / f.runs * 100).toFixed(2) : 0 }))
      .sort((a, b) => b.errors - a.errors || b.runs - a.runs);

    // ---- jobs: aggregate from system_jobs_log (last 7d) ----
    const { data: jobLogs, error: jobErr } = await admin
      .from('system_jobs_log')
      .select('job_name, status, duration_ms, ran_at')
      .gte('ran_at', since7d)
      .order('ran_at', { ascending: false })
      .limit(20000);
    if (jobErr) throw jobErr;
    const jobMap = new Map<string, { name: string; runs: number; success: number; fail: number; durations: number[]; last_status: string | null; last_ran_at: string | null }>();
    for (const r of jobLogs ?? []) {
      const row = jobMap.get(r.job_name) ?? { name: r.job_name, runs: 0, success: 0, fail: 0, durations: [], last_status: null, last_ran_at: null };
      row.runs += 1;
      if (r.status === 'success') row.success += 1;
      else row.fail += 1;
      if (typeof r.duration_ms === 'number') row.durations.push(r.duration_ms);
      if (!row.last_ran_at || r.ran_at > row.last_ran_at) {
        row.last_ran_at = r.ran_at;
        row.last_status = r.status;
      }
      jobMap.set(r.job_name, row);
    }
    const jobs: JobRow[] = Array.from(jobMap.values()).map(j => {
      const sorted = j.durations.sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] : null;
      return { job_name: j.name, runs: j.runs, success: j.success, fail: j.fail, p95_ms: p95, last_status: j.last_status, last_ran_at: j.last_ran_at };
    }).sort((a, b) => b.fail - a.fail || b.runs - a.runs);

    // ---- log tables size ----
    const tablesToCheck = [
      { table: 'function_run_logs', tsCol: 'created_at' },
      { table: 'system_jobs_log', tsCol: 'ran_at' },
      { table: 'audit_logs', tsCol: 'created_at' },
      { table: 'perf_metrics', tsCol: 'created_at' },
      { table: 'traffic_events', tsCol: 'created_at' },
      { table: 'edge_boot_events', tsCol: 'boot_at' },
    ];
    const logTables: TableRow[] = [];
    for (const t of tablesToCheck) {
      try {
        const total = await admin.from(t.table).select('*', { count: 'exact', head: true });
        const older7 = await admin.from(t.table).select('*', { count: 'exact', head: true }).lt(t.tsCol, since7d);
        const older30 = await admin.from(t.table).select('*', { count: 'exact', head: true }).lt(t.tsCol, since30d);
        logTables.push({
          table: t.table,
          total: total.count ?? 0,
          older_than_7d: older7.count ?? 0,
          older_than_30d: older30.count ?? 0,
        });
      } catch (_e) {
        // table may not exist in this project — skip silently
      }
    }

    // ---- cold starts (R5): per-function boot frequency in last 7d & 24h ----
    const { data: bootRows } = await admin
      .from('edge_boot_events')
      .select('fn, boot_at')
      .gte('boot_at', since7d)
      .limit(20000);
    const bootMap = new Map<string, { fn: string; boots_7d: number; boots_24h: number; last_boot_at: string | null }>();
    for (const r of bootRows ?? []) {
      const row = bootMap.get(r.fn) ?? { fn: r.fn, boots_7d: 0, boots_24h: 0, last_boot_at: null };
      row.boots_7d += 1;
      if (r.boot_at >= since24h) row.boots_24h += 1;
      if (!row.last_boot_at || r.boot_at > row.last_boot_at) row.last_boot_at = r.boot_at;
      bootMap.set(r.fn, row);
    }
    const coldStarts = Array.from(bootMap.values()).sort((a, b) => b.boots_24h - a.boots_24h || b.boots_7d - a.boots_7d);

    // ---- recent errors (24h, max 50) ----
    const { data: recentErrors } = await admin
      .from('function_run_logs')
      .select('id, created_at, fn, stage, msg, run_id')
      .eq('level', 'error')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(50);

    return json({
      generatedAt: new Date().toISOString(),
      windowDays: 7,
      functions,
      jobs,
      logTables,
      coldStarts,
      recentErrors: recentErrors ?? [],
    }, 200);
  } catch (e) {
    console.error('[ops-health] error', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
