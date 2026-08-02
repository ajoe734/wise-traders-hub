// Auto-heal 副作用層：把「決策 → DB 寫入」的流程抽成可重複使用、可指定作用對象的函式。
//
// 兩個 caller：
//   1. chips-guardian（每 10 分鐘 cron）→ 作用在正式 key/pool/api 上。
//   2. chips-chaos-drill（手動觸發演練）→ 作用在 drill_* 沙箱 key/pool/api 上，
//      用固定假資料重現三種壅塞情境並驗證恢復。
//
// 決策仍然全部在 _shared/autoHealRules.ts（純函式 + 單元測試），本檔只負責 IO。

import {
  decideSwitchReopen,
  decideDegradeStepDown,
  decidePoolHeal,
  taipeiDateString,
} from './autoHealRules.ts';

export interface HealAction {
  kind: 'disabled_switch' | 'enabled_switch' | 'alert';
  key?: string;
  reason: string;
  root_cause?: string;
}

export interface HealDeps {
  supa: any;
  nowMs: number;
  /** 寫 system_alerts；drill 可傳 no-op 避免污染告警。 */
  writeAlert: (code: string, severity: string, message: string, meta: unknown) => Promise<void>;
  /** 取得某 pool 在觀察窗內的 ledger 樣本數；drill 固定回 0。 */
  fetchPoolSamples: (poolName: string) => Promise<number>;
}

// ------------------------------------------------------------------ switches

export async function healSwitches(
  deps: HealDeps,
  opts: { keys: string[]; switchToPool: Record<string, string> },
): Promise<HealAction[]> {
  const { supa, nowMs } = deps;
  const actions: HealAction[] = [];
  const { data } = await supa
    .from('system_kill_switches')
    .select('key, enabled, disabled_reason, disabled_at')
    .in('key', opts.keys);

  for (const sw of (data ?? []) as any[]) {
    if (sw.enabled) continue;
    const pool = opts.switchToPool[sw.key];
    const samples = pool ? await deps.fetchPoolSamples(pool) : 0;
    const decision = decideSwitchReopen({
      key: sw.key,
      enabled: Boolean(sw.enabled),
      disabledReason: sw.disabled_reason ?? null,
      disabledAtMs: sw.disabled_at ? new Date(sw.disabled_at).getTime() : null,
      recentSamples: samples,
      nowMs,
    });
    if (!decision.reopen) continue;

    const { error } = await supa.from('system_kill_switches').update({
      enabled: true,
      disabled_reason: null,
      auto_trigger_metric: `auto_reenabled:autoheal_${decision.reason}`,
      disabled_at: null,
      updated_at: new Date(nowMs).toISOString(),
    }).eq('key', sw.key);
    if (error) {
      console.warn(`[autoheal] reopen ${sw.key} failed:`, error.message);
      continue;
    }
    await deps.writeAlert(`guardian_autoheal_switch_${sw.key}`, 'info',
      `已自動重開 ${sw.key}（${decision.reason}，關閉 ${decision.disabledMinutes.toFixed(0)} 分鐘）`,
      { key: sw.key, reason: decision.reason, disabled_minutes: Number(decision.disabledMinutes.toFixed(1)), samples });
    actions.push({ kind: 'enabled_switch', key: sw.key, reason: `autoheal_${decision.reason}` });
  }
  return actions;
}

// ------------------------------------------------------------------- degrade

/** 讀 degrade:<api> 目前狀態。 */
export async function readDegradeConfig(supa: any, api: string): Promise<Record<string, any>> {
  const { data } = await supa
    .from('tw_bsr_sync_config')
    .select('key, config')
    .eq('key', `degrade:${api}`)
    .maybeSingle();
  return (data?.config ?? {}) as Record<string, any>;
}

export async function healDegrade(
  deps: HealDeps,
  opts: { api: string; hasActiveDegradeSignal: boolean },
): Promise<HealAction[]> {
  const { supa, nowMs } = deps;
  const actions: HealAction[] = [];
  const cfg = await readDegradeConfig(supa, opts.api);
  const mode = String(cfg.mode ?? 'normal');
  if (mode === 'normal') return actions;

  const decision = decideDegradeStepDown({
    mode,
    cooldownUntilMs: cfg.cooldown_until ? new Date(cfg.cooldown_until).getTime() : null,
    lastTransitionAtMs: cfg.last_transition_at
      ? new Date(cfg.last_transition_at).getTime()
      : (cfg.since ? new Date(cfg.since).getTime() : null),
    hasActiveDegradeSignal: opts.hasActiveDegradeSignal,
    nowMs,
  });
  if (!decision.stepDown) return actions;

  const { error } = await supa.rpc('bsr_apply_degrade_transition', {
    _api: opts.api,
    _to_mode: decision.targetMode,
    _reason: 'autoheal_stuck_recovery',
    _trigger_metric: 'stuck_minutes',
    _trigger_value: Number(decision.stuckMinutes.toFixed(1)),
    _threshold: 20,
    _cooldown_seconds: decision.cooldownSeconds,
  });
  if (error) {
    console.warn('[autoheal] degrade transition failed:', error.message);
    return actions;
  }
  await deps.writeAlert('guardian_autoheal_degrade', 'info',
    `degrade:${opts.api} 卡在 ${mode} 已 ${decision.stuckMinutes.toFixed(0)} 分鐘且無降級訊號，自動退回 ${decision.targetMode}`,
    { api: opts.api, from: mode, to: decision.targetMode, stuck_minutes: Number(decision.stuckMinutes.toFixed(1)) });
  actions.push({
    kind: 'alert',
    reason: `autoheal_degrade_${mode}->${decision.targetMode}`,
    root_cause: 'stuck_no_signal',
  });
  return actions;
}

// --------------------------------------------------------------- quota pools

export async function healQuotaPools(
  deps: HealDeps,
  opts: { poolNames?: string[] } = {},
): Promise<HealAction[]> {
  const { supa, nowMs } = deps;
  const actions: HealAction[] = [];
  const today = taipeiDateString(nowMs);
  let q = supa
    .from('finmind_quota_pools')
    .select('pool_name, daily_budget, base_daily_budget, used_today, reset_at, manual_override, capacity, tokens');
  if (opts.poolNames?.length) q = q.in('pool_name', opts.poolNames);
  const { data } = await q;

  for (const p of (data ?? []) as any[]) {
    const decision = decidePoolHeal({
      poolName: p.pool_name,
      dailyBudget: Number(p.daily_budget),
      baseDailyBudget: p.base_daily_budget == null ? null : Number(p.base_daily_budget),
      usedToday: Number(p.used_today),
      resetAt: p.reset_at ? String(p.reset_at).slice(0, 10) : null,
      todayTaipei: today,
      manualOverride: Boolean(p.manual_override),
    });
    if (decision.action === 'none') continue;

    const payload: Record<string, unknown> = { updated_at: new Date(nowMs).toISOString() };
    if (decision.resetUsage) {
      payload.used_today = 0;
      payload.reset_at = today;
      if (p.capacity != null) payload.tokens = Number(p.capacity);
      payload.last_refill_at = new Date(nowMs).toISOString();
    }
    if (decision.targetBudget != null) payload.daily_budget = decision.targetBudget;

    const { error } = await supa.from('finmind_quota_pools').update(payload).eq('pool_name', p.pool_name);
    if (error) {
      console.warn(`[autoheal] pool ${p.pool_name} failed:`, error.message);
      continue;
    }
    await deps.writeAlert(`guardian_autoheal_pool_${p.pool_name}`, 'info',
      `配額池 ${p.pool_name} 自動修復（${decision.reason}）`,
      {
        pool: p.pool_name, action: decision.action, reason: decision.reason,
        from_budget: Number(p.daily_budget), to_budget: decision.targetBudget ?? Number(p.daily_budget),
        used_today: Number(p.used_today), reset_at: p.reset_at,
      });
    actions.push({
      kind: 'alert',
      reason: `autoheal_pool_${decision.action}_${p.pool_name}`,
      root_cause: decision.reason,
    });
  }
  return actions;
}
