// PR-9 / Phase-1: Chips Pipeline Guardian
// 每 10 分鐘 cron 呼叫。
//
// 觸發規則：
//   1. finmind_bsr circuit 連續 open ≥ 2 小時 → 關閉 chips_keepwarm
//   2. 過去 1 小時 backfill pool 拒絕率 > 80% 且樣本 ≥ 50 → 關閉 chips_backfill
//   3. 任一 pool 連續 3 小時 100% quota_exceeded → 寫 alert（不自動關）
//
// 自動 re-enable：
//   - 只有 guardian 自己關的（disabled_reason 不含 `manual:` 前綴）才會在條件解除時自動打開
//   - keepwarm：circuit 恢復 closed 至少 30 分鐘
//   - backfill：過去 30 分鐘拒絕率 < 30%（樣本 ≥ 20）
//
// Alert cooldown 5 分鐘、每次觸發都記錄 root cause 於 meta。

// PR-10: SLO / upstream 決策抽出到 _shared/guardianRules.ts（純函式 + golden test）；
//        本檔只做 DB 讀寫與副作用；常數搬移後對齊 rules。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { forceDisable } from '../_shared/killSwitch.ts';
import {
  decideSloAdjustment,
  decideUpstreamThrottle,
  computeThrottledRefill,
} from '../_shared/guardianRules.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const OPEN_HOURS_TO_KILL_KEEPWARM = 2;
const REJECT_RATE_TO_KILL_BACKFILL = 0.8;
const REJECT_SAMPLE_MIN = 50;
const ALERT_COOLDOWN_MIN = 5;

const RE_ENABLE_KEEPWARM_CIRCUIT_STABLE_MIN = 30;
const RE_ENABLE_BACKFILL_REJECT_MAX = 0.3;
const RE_ENABLE_BACKFILL_SAMPLE_MIN = 20;

interface Action {
  kind: 'disabled_switch' | 'enabled_switch' | 'alert';
  key?: string;
  reason: string;
  root_cause?: string;
}

async function alreadyAlerted(supa: any, code: string): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_COOLDOWN_MIN * 60_000).toISOString();
  const { data } = await supa
    .from('system_alerts')
    .select('id')
    .eq('code', code)
    .gte('created_at', since)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function writeAlert(supa: any, code: string, severity: string, message: string, meta: any) {
  try {
    await supa.from('system_alerts').insert({ code, severity, message, meta });
  } catch (e) {
    console.warn('[guardian] write alert failed:', (e as Error).message);
  }
}

async function getSwitch(supa: any, key: string) {
  const { data } = await supa
    .from('system_kill_switches')
    .select('key, enabled, disabled_reason, disabled_at, auto_trigger_metric')
    .eq('key', key)
    .maybeSingle();
  return data;
}

function isAutoDisabled(sw: any): boolean {
  if (!sw || sw.enabled) return false;
  const reason = String(sw.disabled_reason ?? '');
  return !reason.startsWith('manual:');
}

async function autoEnable(supa: any, key: string, note: string): Promise<void> {
  try {
    await supa.from('system_kill_switches').update({
      enabled: true,
      disabled_reason: null,
      auto_trigger_metric: `auto_reenabled:${note}`,
      disabled_at: null,
      updated_at: new Date().toISOString(),
    }).eq('key', key);
    console.log(`[guardian] auto-enabled ${key}: ${note}`);
  } catch (e) {
    console.warn(`[guardian] auto-enable failed for ${key}:`, (e as Error).message);
  }
}

async function ruleCircuitLongOpen(supa: any): Promise<Action[]> {
  const actions: Action[] = [];
  const { data } = await supa
    .from('data_source_health')
    .select('source, circuit_state, disabled_until, last_failure_at, last_success_at')
    .in('source', ['finmind_bsr', 'twse_t86']);
  const rows = (data ?? []) as any[];
  const finmind = rows.find((r) => r.source === 'finmind_bsr');
  const kwSwitch = await getSwitch(supa, 'chips_keepwarm');

  // Disable path
  if (finmind && finmind.circuit_state === 'open') {
    const failedAt = finmind.last_failure_at ? new Date(finmind.last_failure_at).getTime() : 0;
    const openHours = failedAt ? (Date.now() - failedAt) / 3_600_000 : 0;
    if (openHours >= OPEN_HOURS_TO_KILL_KEEPWARM && (kwSwitch?.enabled ?? true)) {
      const code = 'guardian_kill_keepwarm_circuit_open';
      if (!(await alreadyAlerted(supa, code))) {
        const rootCause = `finmind_bsr_circuit_open_${openHours.toFixed(1)}h`;
        await forceDisable(supa, 'chips_keepwarm',
          `finmind_bsr circuit open ≥ ${OPEN_HOURS_TO_KILL_KEEPWARM}h`,
          `root_cause=${rootCause}`);
        await writeAlert(supa, code, 'warning',
          `已自動停用 chips_keepwarm：finmind_bsr 熔斷已 ${openHours.toFixed(1)} 小時`,
          { source: 'finmind_bsr', disabled_until: finmind.disabled_until, root_cause: rootCause });
        actions.push({ kind: 'disabled_switch', key: 'chips_keepwarm', reason: 'circuit_long_open', root_cause: rootCause });
      }
    }
  }

  // Re-enable path
  if (finmind && finmind.circuit_state === 'closed' && isAutoDisabled(kwSwitch)) {
    const successAt = finmind.last_success_at ? new Date(finmind.last_success_at).getTime() : 0;
    const stableMin = successAt ? (Date.now() - successAt) / 60_000 : 0;
    // 註：last_success_at 是最後成功時間，如果它比現在早很多說明剛恢復；
    // 我們要求「circuit closed 且最近 30 分鐘內至少有一次成功」，故 stableMin ≤ 30
    if (successAt > 0 && stableMin <= RE_ENABLE_KEEPWARM_CIRCUIT_STABLE_MIN) {
      // 額外檢查：確保 disabled 已經超過 stable 窗（避免剛關又開）
      const disabledAt = kwSwitch?.disabled_at ? new Date(kwSwitch.disabled_at).getTime() : 0;
      const disabledMin = disabledAt ? (Date.now() - disabledAt) / 60_000 : 999;
      if (disabledMin >= RE_ENABLE_KEEPWARM_CIRCUIT_STABLE_MIN) {
        await autoEnable(supa, 'chips_keepwarm', 'circuit_closed_stable');
        actions.push({ kind: 'enabled_switch', key: 'chips_keepwarm', reason: 'circuit_recovered' });
      }
    }
  }

  return actions;
}

async function fetchRejectStats(supa: any, pool: string, windowMin: number) {
  const since = new Date(Date.now() - windowMin * 60_000).toISOString();
  const { data } = await supa
    .from('finmind_quota_ledger')
    .select('granted, reason')
    .eq('pool_name', pool)
    .gte('created_at', since);
  const rows = (data ?? []) as { granted: boolean; reason: string | null }[];
  const total = rows.length;
  const rejected = rows.filter((r) => !r.granted).length;
  const topReason = (() => {
    const map = new Map<string, number>();
    for (const r of rows) if (!r.granted) map.set(r.reason ?? 'unknown', (map.get(r.reason ?? 'unknown') ?? 0) + 1);
    let best: [string, number] = ['unknown', 0];
    for (const [k, v] of map) if (v > best[1]) best = [k, v];
    return best[0];
  })();
  return { total, rejected, rate: total ? rejected / total : 0, topReason };
}

async function ruleQuotaRejectRate(supa: any): Promise<Action[]> {
  const actions: Action[] = [];
  const bfSwitch = await getSwitch(supa, 'chips_backfill');

  // Disable path
  if (bfSwitch?.enabled ?? true) {
    const stat = await fetchRejectStats(supa, 'backfill', 60);
    if (stat.total >= REJECT_SAMPLE_MIN && stat.rate >= REJECT_RATE_TO_KILL_BACKFILL) {
      const code = 'guardian_kill_backfill_high_reject';
      if (!(await alreadyAlerted(supa, code))) {
        const rootCause = `backfill_reject_${(stat.rate * 100).toFixed(0)}pct_by_${stat.topReason}`;
        await forceDisable(supa, 'chips_backfill',
          `backfill reject ${(stat.rate * 100).toFixed(0)}% (${stat.rejected}/${stat.total})`,
          `root_cause=${rootCause}`);
        await writeAlert(supa, code, 'warning',
          `已自動停用 chips_backfill：過去 1 小時拒絕率 ${(stat.rate * 100).toFixed(0)}%（主因 ${stat.topReason}）`,
          { pool: 'backfill', total: stat.total, rejected: stat.rejected, top_reason: stat.topReason, root_cause: rootCause });
        actions.push({ kind: 'disabled_switch', key: 'chips_backfill', reason: 'high_reject_rate', root_cause: rootCause });
      }
    }
  }

  // Re-enable path
  if (isAutoDisabled(bfSwitch)) {
    const disabledAt = bfSwitch?.disabled_at ? new Date(bfSwitch.disabled_at).getTime() : 0;
    const disabledMin = disabledAt ? (Date.now() - disabledAt) / 60_000 : 0;
    if (disabledMin >= 30) {
      const recent = await fetchRejectStats(supa, 'backfill', 30);
      if (recent.total >= RE_ENABLE_BACKFILL_SAMPLE_MIN && recent.rate < RE_ENABLE_BACKFILL_REJECT_MAX) {
        await autoEnable(supa, 'chips_backfill', `reject_rate_${(recent.rate * 100).toFixed(0)}pct`);
        actions.push({ kind: 'enabled_switch', key: 'chips_backfill', reason: 'reject_rate_recovered' });
      }
    }
  }

  return actions;
}

// Phase-2 / PR-10: SLO-driven budget adjustment（決策交給 guardianRules.decideSloAdjustment）
const SLO_ADJUST_WINDOW_MIN = 30;

async function ruleSloBudgetAdjust(supa: any): Promise<Action[]> {
  const actions: Action[] = [];
  const { data: pools } = await supa
    .from('finmind_quota_pools')
    .select('pool_name, daily_budget, capacity, base_daily_budget, slo_boost_until, manual_override');
  const nowMs = Date.now();
  for (const pool of (pools ?? []) as any[]) {
    const stat = await fetchRejectStats(supa, pool.pool_name, SLO_ADJUST_WINDOW_MIN);
    const baseCapacity = Number(pool.base_daily_budget ?? pool.capacity ?? pool.daily_budget);
    const decision = decideSloAdjustment({
      poolName: pool.pool_name,
      currentBudget: Number(pool.daily_budget),
      baseCapacity,
      boostUntilMs: pool.slo_boost_until ? new Date(pool.slo_boost_until).getTime() : null,
      manualOverride: Boolean(pool.manual_override),
      totalSamples: stat.total,
      rejectRate: stat.rate,
      nowMs,
    });

    if (!decision.changed) continue;

    const updatePayload: Record<string, unknown> = {
      daily_budget: decision.targetBudget,
      updated_at: new Date(nowMs).toISOString(),
    };
    if (decision.newBoostUntilMs !== undefined) {
      updatePayload.slo_boost_until = decision.newBoostUntilMs === null
        ? null
        : new Date(decision.newBoostUntilMs).toISOString();
    }
    await supa.from('finmind_quota_pools')
      .update(updatePayload)
      .eq('pool_name', pool.pool_name);
    actions.push({
      kind: 'alert',
      reason: `slo_${decision.reason}_${pool.pool_name}_${pool.daily_budget}->${decision.targetBudget}`,
      root_cause: `reject_${(stat.rate * 100).toFixed(0)}pct_over_${stat.total}`,
    });
  }
  return actions;
}

// Phase-2 / PR-10: 上游配額低時 throttle keepwarm/backfill（決策 pure 化）
async function ruleUpstreamQuotaLow(supa: any): Promise<Action[]> {
  const actions: Action[] = [];
  const { data } = await supa
    .from('data_source_health')
    .select('source, upstream_quota_remaining')
    .in('source', ['finmind_bsr', 'finmind_institutional']);
  const decision = decideUpstreamThrottle({ sources: (data ?? []) as any[] });
  if (!decision.throttle) return actions;

  const code = 'guardian_upstream_quota_low';
  if (await alreadyAlerted(supa, code)) return actions;

  const { data: pools } = await supa
    .from('finmind_quota_pools')
    .select('pool_name, refill_per_min')
    .in('pool_name', ['keepwarm', 'backfill']);
  for (const p of (pools ?? []) as any[]) {
    const throttled = computeThrottledRefill(Number(p.refill_per_min), decision.refillMultiplier);
    await supa.from('finmind_quota_pools')
      .update({ refill_per_min: throttled, updated_at: new Date().toISOString() })
      .eq('pool_name', p.pool_name);
  }
  await writeAlert(supa, code, 'warning',
    `上游 ${decision.lowSource} 剩餘配額 ${decision.remaining}，keepwarm/backfill 補充速率暫降 ${Math.round((1 - decision.refillMultiplier) * 100)}%`,
    { source: decision.lowSource, remaining: decision.remaining });
  actions.push({ kind: 'alert', reason: 'upstream_quota_low', root_cause: `remaining_${decision.remaining}` });
  return actions;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const [a1, a2, a3, a4] = await Promise.all([
      ruleCircuitLongOpen(supa),
      ruleQuotaRejectRate(supa),
      ruleSloBudgetAdjust(supa),
      ruleUpstreamQuotaLow(supa),
    ]);
    const actions = [...a1, ...a2, ...a3, ...a4];
    return new Response(JSON.stringify({ ok: true, actions, ran_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[chips-guardian] error:', (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

