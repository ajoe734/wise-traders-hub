// Real-time guardrail watchdog. Cron every 5 minutes.
// Computes checkout failure rate, paywall drop, function failure spike for the
// last 30-minute window and writes deduped rows into public.system_alerts.
//
// Auth: relies on SUPABASE_SERVICE_ROLE_KEY. Callable manually for testing.

import { corsPreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';

const WINDOW_MIN = 30;
const DEDUPE_MIN = 60;

type AlertInput = {
  kind: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  message?: string;
  metric_value?: number;
  threshold?: number;
  detail?: Record<string, unknown>;
};

// deno-lint-ignore no-explicit-any
async function fire(admin: any, alert: AlertInput) {
  const dedupeSince = new Date(Date.now() - DEDUPE_MIN * 60_000).toISOString();
  const { data: existing } = await admin
    .from('system_alerts')
    .select('id')
    .eq('kind', alert.kind)
    .is('resolved_at', null)
    .gte('fired_at', dedupeSince)
    .maybeSingle();
  if (existing) return { kind: alert.kind, deduped: true };
  const { error } = await admin.from('system_alerts').insert({
    kind: alert.kind,
    level: alert.level,
    title: alert.title,
    message: alert.message ?? null,
    metric_value: alert.metric_value ?? null,
    threshold: alert.threshold ?? null,
    detail: alert.detail ?? {},
  });
  if (error) return { kind: alert.kind, error: error.message };
  return { kind: alert.kind, fired: true };
}

// deno-lint-ignore no-explicit-any
async function checkCheckoutFailureRate(admin: any) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { data } = await admin
    .from('traffic_events')
    .select('event_name')
    .in('event_name', ['checkout_submit', 'checkout_success', 'checkout_failure'])
    .gte('occurred_at', since);
  const counts = { submit: 0, success: 0, failure: 0 };
  for (const r of (data ?? []) as Array<{ event_name: string }>) {
    if (r.event_name === 'checkout_submit') counts.submit++;
    else if (r.event_name === 'checkout_success') counts.success++;
    else if (r.event_name === 'checkout_failure') counts.failure++;
  }
  const denom = Math.max(counts.submit, counts.success + counts.failure);
  if (denom < 5) return { skipped: 'sample_too_small', counts };
  const rate = counts.failure / denom;
  if (rate < 0.5) return { ok: true, rate, counts };
  return await fire(admin, {
    kind: 'checkout_failure_rate',
    level: rate >= 0.8 ? 'critical' : 'warning',
    title: `結帳失敗率異常 ${(rate * 100).toFixed(0)}%`,
    message: `近 ${WINDOW_MIN} 分鐘 submit=${counts.submit} success=${counts.success} failure=${counts.failure}`,
    metric_value: Number((rate * 100).toFixed(2)),
    threshold: 50,
    detail: counts,
  });
}

// deno-lint-ignore no-explicit-any
async function checkPaywallDrop(admin: any) {
  const now = Date.now();
  const cur = new Date(now - WINDOW_MIN * 60_000).toISOString();
  const prev = new Date(now - WINDOW_MIN * 2 * 60_000).toISOString();
  const { data: curRows } = await admin
    .from('paywall_events')
    .select('id')
    .gte('occurred_at', cur);
  const { data: prevRows } = await admin
    .from('paywall_events')
    .select('id')
    .gte('occurred_at', prev)
    .lt('occurred_at', cur);
  const curC = (curRows ?? []).length;
  const prevC = (prevRows ?? []).length;
  if (prevC < 5) return { skipped: 'baseline_too_small', curC, prevC };
  const drop = (prevC - curC) / prevC;
  if (drop < 0.5) return { ok: true, drop, curC, prevC };
  return await fire(admin, {
    kind: 'paywall_drop',
    level: drop >= 0.8 ? 'critical' : 'warning',
    title: `Paywall 觸發量驟降 ${(drop * 100).toFixed(0)}%`,
    message: `本 ${WINDOW_MIN} 分鐘 ${curC} 次 vs 前 ${WINDOW_MIN} 分鐘 ${prevC} 次`,
    metric_value: Number((drop * 100).toFixed(2)),
    threshold: 50,
    detail: { curC, prevC },
  });
}

// deno-lint-ignore no-explicit-any
async function checkFunctionFailures(admin: any) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { data } = await admin
    .from('function_run_logs')
    .select('fn,level')
    .eq('level', 'error')
    .gte('created_at', since);
  const rows = (data ?? []) as Array<{ fn: string }>;
  if (rows.length < 5) return { ok: true, count: rows.length };
  const byFn: Record<string, number> = {};
  for (const r of rows) byFn[r.fn] = (byFn[r.fn] ?? 0) + 1;
  return await fire(admin, {
    kind: 'function_failure_spike',
    level: rows.length >= 20 ? 'critical' : 'warning',
    title: `邊緣函式錯誤激增 ${rows.length} 次/${WINDOW_MIN} 分鐘`,
    message: Object.entries(byFn).map(([k, v]) => `${k}: ${v}`).join('、'),
    metric_value: rows.length,
    threshold: 5,
    detail: byFn,
  });
}

// Push pending system_alerts to admin LINE bindings (dedup via notified_at).
// deno-lint-ignore no-explicit-any
async function pushPendingAlertsToLine(admin: any) {
  const { data: pending } = await admin
    .from('system_alerts')
    .select('id,level,title,message,fired_at')
    .is('notified_at', null)
    .is('resolved_at', null)
    .gte('fired_at', new Date(Date.now() - 6 * 3600_000).toISOString())
    .limit(20);
  const rows = (pending ?? []) as Array<{ id: string; level: string; title: string; message: string | null }>;
  if (!rows.length) return { pushed: 0 };

  const { data: adminRoles } = await admin
    .from('user_roles')
    .select('user_id')
    .eq('role', 'company_admin');
  const adminIds = Array.from(new Set((adminRoles ?? []).map((r: { user_id: string }) => r.user_id))).filter(Boolean) as string[];
  if (!adminIds.length) return { pushed: 0, reason: 'no_admins' };

  // Find admin user — used as created_by for the push job
  const creator = adminIds[0];

  let pushed = 0;
  for (const a of rows) {
    const icon = a.level === 'critical' ? '🚨' : a.level === 'warning' ? '⚠️' : 'ℹ️';
    const text = `${icon} ${a.title}\n${a.message ?? ''}`.slice(0, 1500);
    let err: string | null = null;
    const { data: job, error: jobErr } = await admin
      .from('line_push_jobs')
      .insert({
        message_kind: 'text_with_action',
        text,
        action_label: '打開告警中心',
        action_url: 'https://legendflow.tw/company/alerts',
        recipient_user_ids: adminIds,
        status: 'pending',
        created_by: creator,
      })
      .select('id')
      .maybeSingle();
    if (jobErr) {
      err = jobErr.message;
    } else if (job?.id) {
      admin.functions.invoke('admin-line-push', { body: { job_id: job.id } }).catch(() => {});
    }
    await admin
      .from('system_alerts')
      .update({ notified_at: new Date().toISOString(), notify_error: err })
      .eq('id', a.id);
    pushed++;
  }
  return { pushed, admins: adminIds.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight();
  try {
    const admin = serviceClient();
    const [a, b, c] = await Promise.allSettled([
      checkCheckoutFailureRate(admin),
      checkPaywallDrop(admin),
      checkFunctionFailures(admin),
    ]);
    const notify = await pushPendingAlertsToLine(admin).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    return jsonResponse({
      ok: true,
      ran_at: new Date().toISOString(),
      results: { checkout: a, paywall: b, functions: c },
      notify,
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : String(e), 500);
  }
});
