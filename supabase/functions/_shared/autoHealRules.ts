// Auto-heal 決策層（純函式，無 IO / 無 Date.now()，時間一律由 nowMs 傳入）。
//
// 解決三個「自我卡死」死結：
//   1. kill-switch 被 guardian 自動關閉後，因為沒有流量 → ledger 無樣本 →
//      永遠達不到 re-enable 的樣本門檻 → 永久關閉。
//   2. degrade:finmind 停在 tier3_paused/更深層：降級由 worker 評估，
//      但降級本身讓 worker 少跑甚至不跑 → 沒有人把它推回 normal。
//   3. finmind_quota_pools 的 used_today 撞到 daily_budget，或 reset_at
//      停在過去日期（跨日沒有人呼叫 reset）→ 每次 admit 都 daily_exhausted。
//
// 這三條都由 chips-guardian 每 10 分鐘執行一次；決策在此、副作用在 edge function。

import { MODE_ORDER, type DegradeMode } from './bsrDegrade.ts';

// ---------------------------------------------------------------- kill switch

/** 自動關閉後，超過此分鐘數且觀測不到流量 → 開一次 probe。 */
export const SWITCH_PROBE_AFTER_MIN = 60;
/** 自動關閉後，超過此分鐘數一律強制重開（上限保護，避免永久關閉）。 */
export const SWITCH_FORCE_REOPEN_AFTER_MIN = 180;
/** 低於此樣本數視為「沒有流量」，無法用拒絕率判斷恢復。 */
export const SWITCH_TRAFFIC_STARVED_SAMPLES = 5;

export interface SwitchHealInput {
  key: string;
  enabled: boolean;
  disabledReason: string | null;
  /** disabled_at 的 epoch ms；null = 不明。 */
  disabledAtMs: number | null;
  /** 近期觀察窗內的 ledger 樣本數。 */
  recentSamples: number;
  nowMs: number;
}

export interface SwitchHealDecision {
  reopen: boolean;
  reason:
    | 'already_enabled'
    | 'manual_hold'
    | 'unknown_disabled_at'
    | 'waiting'
    | 'traffic_starved_probe'
    | 'stale_force_reopen';
  disabledMinutes: number;
}

export function decideSwitchReopen(input: SwitchHealInput): SwitchHealDecision {
  if (input.enabled) return { reopen: false, reason: 'already_enabled', disabledMinutes: 0 };

  const reason = String(input.disabledReason ?? '');
  if (reason.startsWith('manual:')) {
    return { reopen: false, reason: 'manual_hold', disabledMinutes: 0 };
  }
  if (!input.disabledAtMs) {
    // 沒有 disabled_at 無從判斷年紀 —— 視為 guardian 遺留，直接重開一次 probe。
    return { reopen: true, reason: 'unknown_disabled_at', disabledMinutes: 0 };
  }

  const minutes = (input.nowMs - input.disabledAtMs) / 60_000;
  if (minutes >= SWITCH_FORCE_REOPEN_AFTER_MIN) {
    return { reopen: true, reason: 'stale_force_reopen', disabledMinutes: minutes };
  }
  if (minutes >= SWITCH_PROBE_AFTER_MIN && input.recentSamples < SWITCH_TRAFFIC_STARVED_SAMPLES) {
    return { reopen: true, reason: 'traffic_starved_probe', disabledMinutes: minutes };
  }
  return { reopen: false, reason: 'waiting', disabledMinutes: minutes };
}

// ------------------------------------------------------------------- degrade

/** 進入某個降級模式後，超過此分鐘數且 cooldown 已過 → 逐級退回。 */
export const DEGRADE_STUCK_MIN = 20;
/** 逐級退回時套用的 cooldown（秒），比預設短，讓恢復不用等太久。 */
export const DEGRADE_RECOVER_COOLDOWN_SEC = 300;

export interface DegradeHealInput {
  mode: DegradeMode | string;
  /** config.cooldown_until 的 epoch ms；null = 無。 */
  cooldownUntilMs: number | null;
  /** config.last_transition_at（或 since）的 epoch ms；null = 不明。 */
  lastTransitionAtMs: number | null;
  /**
   * 是否仍有「應該維持降級」的即時訊號（例如用量仍 ≥ 80%、429 streak 未歸零、
   * reservation 仍卡住）。true 時不做自動恢復。
   */
  hasActiveDegradeSignal: boolean;
  nowMs: number;
}

export interface DegradeHealDecision {
  stepDown: boolean;
  targetMode: DegradeMode;
  reason:
    | 'already_normal'
    | 'unknown_mode'
    | 'cooldown_active'
    | 'signal_active'
    | 'not_stuck_yet'
    | 'stuck_step_down';
  cooldownSeconds: number;
  stuckMinutes: number;
}

export function decideDegradeStepDown(input: DegradeHealInput): DegradeHealDecision {
  const idx = MODE_ORDER.indexOf(input.mode as DegradeMode);
  const base = { stepDown: false, cooldownSeconds: DEGRADE_RECOVER_COOLDOWN_SEC, stuckMinutes: 0 };
  if (idx < 0) return { ...base, targetMode: 'normal', reason: 'unknown_mode' };
  if (idx === 0) return { ...base, targetMode: 'normal', reason: 'already_normal' };

  const target = MODE_ORDER[idx - 1];
  if (input.cooldownUntilMs != null && input.cooldownUntilMs > input.nowMs) {
    return { ...base, targetMode: target, reason: 'cooldown_active' };
  }
  if (input.hasActiveDegradeSignal) {
    return { ...base, targetMode: target, reason: 'signal_active' };
  }

  const stuckMinutes = input.lastTransitionAtMs
    ? (input.nowMs - input.lastTransitionAtMs) / 60_000
    : Number.POSITIVE_INFINITY;
  if (stuckMinutes < DEGRADE_STUCK_MIN) {
    return { ...base, targetMode: target, reason: 'not_stuck_yet', stuckMinutes };
  }
  return {
    stepDown: true,
    targetMode: target,
    reason: 'stuck_step_down',
    cooldownSeconds: DEGRADE_RECOVER_COOLDOWN_SEC,
    stuckMinutes,
  };
}

// --------------------------------------------------------------- quota pools

/** used_today / daily_budget 高於此比例即視為 exhausted。 */
export const POOL_EXHAUSTED_RATIO = 1;

export interface PoolHealInput {
  poolName: string;
  dailyBudget: number;
  baseDailyBudget: number | null;
  usedToday: number;
  /** reset_at（date, YYYY-MM-DD）。 */
  resetAt: string | null;
  /** 台北時區今天日期 YYYY-MM-DD。 */
  todayTaipei: string;
  manualOverride: boolean;
}

export interface PoolHealDecision {
  action: 'none' | 'roll_over' | 'restore_budget';
  /** 需要寫入的 daily_budget；undefined = 不動。 */
  targetBudget?: number;
  /** 是否把 used_today 歸零並把 reset_at 推到今天。 */
  resetUsage: boolean;
  reason: 'manual_override' | 'stale_reset_at' | 'budget_below_base_and_exhausted' | 'healthy';
}

export function decidePoolHeal(input: PoolHealInput): PoolHealDecision {
  if (input.manualOverride) {
    return { action: 'none', resetUsage: false, reason: 'manual_override' };
  }

  const base = input.baseDailyBudget ?? null;
  const budgetBelowBase = base != null && input.dailyBudget < base;

  // 1. 跨日沒被 reset（reset_at 落後於台北今日）→ 歸零並回到 base 預算。
  if (input.resetAt && input.resetAt < input.todayTaipei) {
    return {
      action: 'roll_over',
      targetBudget: budgetBelowBase ? base! : undefined,
      resetUsage: true,
      reason: 'stale_reset_at',
    };
  }

  // 2. 當日已用滿，而預算曾被 SLO 收緊到低於 base → 還原到 base（不歸零用量）。
  const exhausted = input.dailyBudget > 0 && input.usedToday / input.dailyBudget >= POOL_EXHAUSTED_RATIO;
  if (exhausted && budgetBelowBase) {
    return {
      action: 'restore_budget',
      targetBudget: base!,
      resetUsage: false,
      reason: 'budget_below_base_and_exhausted',
    };
  }

  return { action: 'none', resetUsage: false, reason: 'healthy' };
}

/** 以台北時區取得 YYYY-MM-DD。 */
export function taipeiDateString(nowMs: number): string {
  return new Date(nowMs + 8 * 3_600_000).toISOString().slice(0, 10);
}
