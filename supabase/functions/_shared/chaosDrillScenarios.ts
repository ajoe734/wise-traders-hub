// 壅塞演練（chaos drill）的固定假資料與驗收條件 —— 純函式，無 IO。
//
// 用於 supabase/functions/chips-chaos-drill：在 staging 用固定假資料重現三種壅塞情境，
// 跑真正的 auto-heal 副作用（_shared/autoHealEffects.ts），再用這裡的 verify* 斷言
// 「每次都恢復到 normal，且 reset_at / daily_budget 已更新」。
//
// 所有沙箱物件都用 drill_ 前綴，正式 pipeline 不會讀到它們。

import { taipeiDateString } from './autoHealRules.ts';

export const DRILL_SWITCH_KEY = 'drill_chaos_switch';
export const DRILL_POOL_NAME = 'drill_chaos_pool';
export const DRILL_DEGRADE_API = 'drill_chaos';

export const DRILL_SCENARIOS = ['kill_switch', 'degrade', 'quota_pool'] as const;
export type DrillScenario = (typeof DRILL_SCENARIOS)[number];

export interface Check {
  name: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface ScenarioResult {
  scenario: DrillScenario;
  passed: boolean;
  checks: Check[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  actions: string[];
}

const check = (name: string, expected: unknown, actual: unknown, ok: boolean): Check => ({
  name,
  expected: String(expected),
  actual: String(actual),
  ok,
});

// ------------------------------------------------------------- 1. kill switch
// 固定情境：guardian 自動關閉、關閉已 200 分鐘（> SWITCH_FORCE_REOPEN_AFTER_MIN=180）、
// 且沒有任何流量樣本 → 必須被強制重開。

export function buildSwitchFixture(nowMs: number) {
  return {
    key: DRILL_SWITCH_KEY,
    enabled: false,
    disabled_reason: 'drill: backfill reject 99% (990/1000)',
    auto_trigger_metric: 'root_cause=drill_injected',
    disabled_at: new Date(nowMs - 200 * 60_000).toISOString(),
    updated_at: new Date(nowMs).toISOString(),
  };
}

export function verifySwitch(row: { enabled?: boolean; disabled_reason?: string | null } | null): Check[] {
  return [
    check('switch.enabled 回到 true', true, row?.enabled ?? 'missing', row?.enabled === true),
    check('switch.disabled_reason 已清空', null, row?.disabled_reason ?? null, (row?.disabled_reason ?? null) === null),
  ];
}

// ---------------------------------------------------------------- 2. degrade
// 固定情境：卡在 tier3_paused、cooldown 已過期 30 分鐘、last_transition 在 90 分鐘前、
// 且無任何降級訊號 → 每輪退一級，最終必須回到 normal。

export function buildDegradeFixture(nowMs: number, mode = 'tier3_paused') {
  return {
    mode,
    since: new Date(nowMs - 90 * 60_000).toISOString(),
    reason: 'drill_injected_congestion',
    trigger_metric: 'drill',
    trigger_value: 999,
    threshold: 1,
    last_transition_at: new Date(nowMs - 90 * 60_000).toISOString(),
    cooldown_until: new Date(nowMs - 30 * 60_000).toISOString(),
    previous_mode: 'normal',
  };
}

export function verifyDegrade(cfg: Record<string, unknown> | null, steps: string[]): Check[] {
  const mode = String(cfg?.mode ?? 'missing');
  return [
    check('degrade mode 回到 normal', 'normal', mode, mode === 'normal'),
    check('至少執行一次降級退回', '>=1', steps.length, steps.length >= 1),
  ];
}

// ------------------------------------------------------------ 3. quota pool
// 兩段固定情境：
//   A. reset_at 停在昨天 + 預算被收緊到 60（base 600）+ used_today 187
//      → roll_over：used_today 歸零、reset_at 推到台北今日、daily_budget 還原到 base。
//   B. reset_at 已是今天，但 daily_budget 240 < base 600 且 used_today 撞滿
//      → restore_budget：daily_budget 還原到 base，used_today 不動。

export const DRILL_POOL_BASE_BUDGET = 600;

export function buildPoolStaleFixture(nowMs: number) {
  const yesterday = taipeiDateString(nowMs - 24 * 3_600_000);
  return {
    pool_name: DRILL_POOL_NAME,
    daily_budget: 60,
    base_daily_budget: DRILL_POOL_BASE_BUDGET,
    used_today: 187,
    reset_at: yesterday,
    capacity: 240,
    tokens: 0,
    refill_per_min: 1,
    priority: 9,
    manual_override: false,
    borrow_enabled: false,
    updated_at: new Date(nowMs).toISOString(),
  };
}

export function buildPoolExhaustedFixture(nowMs: number) {
  return {
    ...buildPoolStaleFixture(nowMs),
    daily_budget: 240,
    used_today: 240,
    reset_at: taipeiDateString(nowMs),
  };
}

export function verifyPoolRollOver(row: any, nowMs: number): Check[] {
  const today = taipeiDateString(nowMs);
  const resetAt = row?.reset_at ? String(row.reset_at).slice(0, 10) : 'missing';
  return [
    check('pool.used_today 歸零', 0, row?.used_today ?? 'missing', Number(row?.used_today) === 0),
    check('pool.reset_at 推進到台北今日', today, resetAt, resetAt === today),
    check('pool.daily_budget 還原到 base', DRILL_POOL_BASE_BUDGET, row?.daily_budget ?? 'missing',
      Number(row?.daily_budget) === DRILL_POOL_BASE_BUDGET),
    check('pool.tokens 已補滿到 capacity', 240, row?.tokens ?? 'missing', Number(row?.tokens) === 240),
  ];
}

export function verifyPoolRestoreBudget(row: any): Check[] {
  return [
    check('pool.daily_budget 還原到 base', DRILL_POOL_BASE_BUDGET, row?.daily_budget ?? 'missing',
      Number(row?.daily_budget) === DRILL_POOL_BASE_BUDGET),
    check('pool.used_today 不被歸零', 240, row?.used_today ?? 'missing', Number(row?.used_today) === 240),
  ];
}

export function allPassed(checks: Check[]): boolean {
  return checks.length > 0 && checks.every((c) => c.ok);
}
