// Real-time guardrail watchdog. Cron every 5 minutes.
// Computes checkout failure rate, paywall drop, function failure spike for the
// last 30-minute window and writes deduped rows into public.system_alerts.
//
// Auth: relies on SUPABASE_SERVICE_ROLE_KEY. Callable manually for testing.

import { corsPreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import {
  evaluateAllWaves,
  FALLBACK_RATE_THRESHOLD,
  type KeepwarmMetric,
} from '../_shared/chipsFallbackAlert.ts';
import {
  evaluateAllWaveSlo,
  type SloRow,
} from '../_shared/keepWarmSlo.ts';

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

// 監控 AI 串流是否異常中止（abort / timeout）。資料來源：
// stream-metrics-report 會把每筆 abort/timeout/error 落到 function_run_logs
// (fn='stream-metrics-report', level='warn', payload.terminatedBy)。
// 30 分鐘視窗內 abort+timeout 累積達門檻即發告警，並把 eventCount / elapsedMs
// 的分布統計一起帶進 message / detail，方便直接判斷是「使用者狂按停止」還是
// 「後端真的一直沒回」。
// deno-lint-ignore no-explicit-any
async function checkStreamAborts(admin: any) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { data } = await admin
    .from('function_run_logs')
    .select('payload,created_at')
    .eq('fn', 'stream-metrics-report')
    .eq('level', 'warn')
    .gte('created_at', since);
  const rows = (data ?? []) as Array<{ payload: Record<string, unknown> }>;
  const byKind: Record<string, number> = { abort: 0, timeout: 0, error: 0 };
  const eventCounts: number[] = [];
  const elapsedList: number[] = [];
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    const p = r.payload || {};
    const t = String(p.terminatedBy || '');
    if (t in byKind) byKind[t]++;
    if (typeof p.eventCount === 'number' && p.eventCount >= 0) eventCounts.push(p.eventCount);
    if (typeof p.elapsedMs === 'number' && p.elapsedMs >= 0) elapsedList.push(p.elapsedMs);
    const src = typeof p.source === 'string' ? p.source : 'unknown';
    bySource[src] = (bySource[src] ?? 0) + 1;
  }
  const alerting = byKind.abort + byKind.timeout;
  // 門檻：30 分鐘內 abort+timeout ≥ 10 觸發 warning，≥ 25 升 critical。
  if (alerting < 10) return { ok: true, alerting, byKind };
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const max = (arr: number[]) => arr.length ? Math.max(...arr) : 0;
  const stats = {
    eventCount: { avg: avg(eventCounts), max: max(eventCounts), n: eventCounts.length },
    elapsedMs: { avg: avg(elapsedList), max: max(elapsedList), n: elapsedList.length },
  };
  return await fire(admin, {
    kind: 'stream_abort_spike',
    level: alerting >= 25 ? 'critical' : 'warning',
    title: `AI 串流異常中止 ${alerting} 次/${WINDOW_MIN} 分鐘（abort ${byKind.abort} / timeout ${byKind.timeout}）`,
    message:
      `近 ${WINDOW_MIN} 分鐘：abort=${byKind.abort} timeout=${byKind.timeout} error=${byKind.error}；` +
      `eventCount 平均 ${stats.eventCount.avg}（max ${stats.eventCount.max}）、` +
      `elapsedMs 平均 ${stats.elapsedMs.avg}（max ${stats.elapsedMs.max}）。`,
    metric_value: alerting,
    threshold: 10,
    detail: { byKind, bySource, stats },
  });
}

// ============ BSR / FinMind rate limiter guardrails ============
// deno-lint-ignore no-explicit-any
async function checkBsrRateLimiter(admin: any) {
  const HOURLY_LIMIT = Number(Deno.env.get('FINMIND_HOURLY_LIMIT') ?? 1500);
  const results: any[] = [];

  // 1) 用量：透過 check_bsr_rate_limit（已含 in-flight reservation）
  const { data: rl } = await admin.rpc('check_bsr_rate_limit', { _limit: HOURLY_LIMIT, _api: 'finmind' });
  const rlRow = Array.isArray(rl) ? rl[0] : rl;
  const used = Number(rlRow?.used ?? 0);
  const pct = HOURLY_LIMIT > 0 ? (used / HOURLY_LIMIT) * 100 : 0;
  if (pct >= 80) {
    results.push(await fire(admin, {
      kind: 'bsr_rate_limit_high',
      level: pct >= 95 ? 'critical' : 'warning',
      title: `FinMind 用量 ${pct.toFixed(0)}%（${used}/${HOURLY_LIMIT}）`,
      message: `近 60 分鐘含 in-flight reservation 已達 ${used} 次；剩餘 ${Math.max(0, HOURLY_LIMIT - used)}。`,
      metric_value: Number(pct.toFixed(2)),
      threshold: 80,
      detail: { used, limit: HOURLY_LIMIT },
    }));
  }

  // 2) reservation 長時間未結算（>60s 表示 worker 掛住或 lease 過長）
  const { data: rs } = await admin.rpc('bsr_reservation_stats', { _api: 'finmind' });
  const rsRow = Array.isArray(rs) ? rs[0] : rs;
  const oldest = Number(rsRow?.oldest_in_flight_age_seconds ?? 0);
  const expiredUnsettled = Number(rsRow?.expired_unsettled ?? 0);
  if (oldest >= 60 || expiredUnsettled >= 5) {
    results.push(await fire(admin, {
      kind: 'bsr_reservation_stuck',
      level: oldest >= 300 || expiredUnsettled >= 20 ? 'critical' : 'warning',
      title: `FinMind reservation 未結算（最舊 ${oldest}s、過期未結 ${expiredUnsettled}）`,
      message: `in-flight=${rsRow?.in_flight ?? 0}、即將到期=${rsRow?.expiring_soon ?? 0}、過期未結算=${expiredUnsettled}。`,
      metric_value: oldest,
      threshold: 60,
      detail: rsRow ?? {},
    }));
  }

  // 3) 429 連續發生（近 60 分鐘 ≥ 3 分鐘連續 rate_limited_count > 0）
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: usage } = await admin.from('tw_bsr_api_usage')
    .select('bucket_start,rate_limited_count')
    .eq('api_name', 'finmind').gte('bucket_start', since)
    .order('bucket_start', { ascending: true });
  let streak = 0, maxStreak = 0;
  for (const r of (usage ?? []) as Array<{ rate_limited_count: number }>) {
    if ((r.rate_limited_count ?? 0) > 0) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }
  if (maxStreak >= 3) {
    results.push(await fire(admin, {
      kind: 'bsr_rate_limited_streak',
      level: maxStreak >= 10 ? 'critical' : 'warning',
      title: `FinMind 連續 429 ${maxStreak} 分鐘`,
      message: `近 60 分鐘內至少 ${maxStreak} 個連續分鐘 bucket 收到 429，可能觸發上游封鎖。`,
      metric_value: maxStreak,
      threshold: 3,
      detail: { window: '60m' },
    }));
  }

  // 4) P1 queue 延遲：最舊 pending P1 job age > 30 分鐘
  const { data: oldestP1 } = await admin.from('tw_bsr_sync_queue')
    .select('enqueued_at,stock_id,trade_date,attempts,last_error')
    .eq('priority', 1).eq('status', 'pending')
    .order('enqueued_at', { ascending: true }).limit(1);
  const p1 = (oldestP1 ?? [])[0];
  if (p1) {
    const ageMin = Math.floor((Date.now() - new Date(p1.enqueued_at).getTime()) / 60_000);
    if (ageMin >= 30) {
      results.push(await fire(admin, {
        kind: 'bsr_p1_queue_stalled',
        level: ageMin >= 120 ? 'critical' : 'warning',
        title: `BSR P1 佇列延遲 ${ageMin} 分鐘`,
        message: `最舊 P1 pending：${p1.stock_id}@${p1.trade_date}（attempts=${p1.attempts ?? 0}）。last_error=${(p1.last_error ?? '').toString().slice(0, 120)}`,
        metric_value: ageMin,
        threshold: 30,
        detail: p1,
      }));
    }
  }

  return { ok: true, ran: results.length, results };
}

// Phase E — Chips fallback / sealing 持續性告警。
// 讀取近 6 小時 tw_bsr_keepwarm_metrics，按 wave 取最新 3 波，
// 全部未封盤或 fallback_rate > 30% 就寫 system_alerts（per-wave 60 分鐘去重）。
// deno-lint-ignore no-explicit-any
async function checkChipsFallbackPersistence(admin: any) {
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data, error } = await admin
    .from('tw_bsr_keepwarm_metrics')
    .select('wave,trade_date,status,sealed,sealed_by_lane,coverage_stocks,coverage_brokers,fallback_used_count,duration_ms,error,started_at')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(200);
  if (error) return { skipped: 'query_failed', error: error.message };
  const rows = (data ?? []) as KeepwarmMetric[];
  if (rows.length === 0) return { skipped: 'no_metrics', rows: 0 };
  const decisions = evaluateAllWaves(rows);
  const fired: unknown[] = [];
  for (const d of decisions) {
    if (!d.triggered) continue;
    const pct = Math.round(d.fallback_rate_avg * 100);
    const reasonZh = d.reason === 'sealed_false'
      ? '連續 3 波未封盤'
      : d.reason === 'fallback_high'
        ? `連續 3 波 fallback 命中率 ${pct}%（門檻 ${Math.round(FALLBACK_RATE_THRESHOLD * 100)}%）`
        : `連續 3 波未封盤且 fallback 命中率 ${pct}%`;
    fired.push(await fire(admin, {
      kind: `chips_fallback_persistent_w${d.wave}`,
      level: d.reason === 'mixed' ? 'critical' : 'warning',
      title: `籌碼面 Wave ${d.wave} 持續異常 — ${reasonZh}`,
      message: `Wave ${d.wave} 最近 ${d.samples} 波（最新 ${d.latest_started_at}）：sealed ${d.sealed_count}/${d.samples}、fallback 平均 ${pct}%。`,
      metric_value: pct,
      threshold: Math.round(FALLBACK_RATE_THRESHOLD * 100),
      detail: {
        wave: d.wave,
        reason: d.reason,
        sealed_count: d.sealed_count,
        fallback_rate_avg: d.fallback_rate_avg,
        latest_started_at: d.latest_started_at,
        ...d.detail,
      },
    }));
  }
  return { ok: true, evaluated: decisions.length, fired: fired.length, decisions };
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
    const [a, b, c, d, e, f] = await Promise.allSettled([
      checkCheckoutFailureRate(admin),
      checkPaywallDrop(admin),
      checkFunctionFailures(admin),
      checkStreamAborts(admin),
      checkBsrRateLimiter(admin),
      checkChipsFallbackPersistence(admin),
    ]);
    const notify = await pushPendingAlertsToLine(admin).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    return jsonResponse({
      ok: true,
      ran_at: new Date().toISOString(),
      results: { checkout: a, paywall: b, functions: c, stream_aborts: d, bsr: e, chips_fallback: f },
      notify,
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : String(e), 500);
  }
});
