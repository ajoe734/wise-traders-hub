import { describe, it, expect } from 'vitest';
import {
  decideSwitchReopen,
  decideDegradeStepDown,
  decidePoolHeal,
  taipeiDateString,
  SWITCH_PROBE_AFTER_MIN,
  SWITCH_FORCE_REOPEN_AFTER_MIN,
  DEGRADE_STUCK_MIN,
  DEGRADE_RECOVER_COOLDOWN_SEC,
} from '../../../supabase/functions/_shared/autoHealRules.ts';

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);
const min = (m: number) => m * 60_000;

describe('decideSwitchReopen', () => {
  const base = {
    key: 'chips_backfill',
    enabled: false,
    disabledReason: 'backfill reject 87%',
    disabledAtMs: NOW - min(10),
    recentSamples: 0,
    nowMs: NOW,
  };

  it('已啟用不動作', () => {
    expect(decideSwitchReopen({ ...base, enabled: true }).reopen).toBe(false);
  });

  it('manual: 前綴永不自動重開（即使超過強制門檻）', () => {
    const d = decideSwitchReopen({
      ...base,
      disabledReason: 'manual:維運手動關閉',
      disabledAtMs: NOW - min(SWITCH_FORCE_REOPEN_AFTER_MIN + 100),
    });
    expect(d).toMatchObject({ reopen: false, reason: 'manual_hold' });
  });

  it('剛關閉不到 probe 門檻 → 等待', () => {
    expect(decideSwitchReopen(base)).toMatchObject({ reopen: false, reason: 'waiting' });
  });

  it('超過 probe 門檻且無流量樣本 → probe 重開（打破死結）', () => {
    const d = decideSwitchReopen({ ...base, disabledAtMs: NOW - min(SWITCH_PROBE_AFTER_MIN + 1) });
    expect(d).toMatchObject({ reopen: true, reason: 'traffic_starved_probe' });
  });

  it('超過 probe 門檻但有足夠樣本 → 交給既有拒絕率規則，不 probe', () => {
    const d = decideSwitchReopen({
      ...base,
      disabledAtMs: NOW - min(SWITCH_PROBE_AFTER_MIN + 1),
      recentSamples: 50,
    });
    expect(d).toMatchObject({ reopen: false, reason: 'waiting' });
  });

  it('超過強制門檻一律重開，不論樣本數', () => {
    const d = decideSwitchReopen({
      ...base,
      disabledAtMs: NOW - min(SWITCH_FORCE_REOPEN_AFTER_MIN),
      recentSamples: 500,
    });
    expect(d).toMatchObject({ reopen: true, reason: 'stale_force_reopen' });
  });

  it('缺 disabled_at 視為遺留狀態，直接重開', () => {
    expect(decideSwitchReopen({ ...base, disabledAtMs: null })).toMatchObject({
      reopen: true,
      reason: 'unknown_disabled_at',
    });
  });
});

describe('decideDegradeStepDown', () => {
  const base = {
    mode: 'tier3_paused',
    cooldownUntilMs: NOW - min(1),
    lastTransitionAtMs: NOW - min(DEGRADE_STUCK_MIN + 5),
    hasActiveDegradeSignal: false,
    nowMs: NOW,
  };

  it('normal 不動作', () => {
    expect(decideDegradeStepDown({ ...base, mode: 'normal' })).toMatchObject({
      stepDown: false,
      reason: 'already_normal',
    });
  });

  it('未知模式安全略過', () => {
    expect(decideDegradeStepDown({ ...base, mode: 'wat' })).toMatchObject({ stepDown: false, reason: 'unknown_mode' });
  });

  it('cooldown 未過 → 不動作', () => {
    expect(decideDegradeStepDown({ ...base, cooldownUntilMs: NOW + min(5) })).toMatchObject({
      stepDown: false,
      reason: 'cooldown_active',
    });
  });

  it('仍有降級訊號 → 不動作', () => {
    expect(decideDegradeStepDown({ ...base, hasActiveDegradeSignal: true })).toMatchObject({
      stepDown: false,
      reason: 'signal_active',
    });
  });

  it('停留時間未達 stuck 門檻 → 不動作', () => {
    expect(decideDegradeStepDown({ ...base, lastTransitionAtMs: NOW - min(DEGRADE_STUCK_MIN - 1) })).toMatchObject({
      stepDown: false,
      reason: 'not_stuck_yet',
    });
  });

  it('tier3_paused 卡住且無訊號 → 退回 normal', () => {
    const d = decideDegradeStepDown(base);
    expect(d).toMatchObject({ stepDown: true, targetMode: 'normal', cooldownSeconds: DEGRADE_RECOVER_COOLDOWN_SEC });
  });

  it.each([
    ['claim_halt', 'p1_only'],
    ['p1_only', 'tier2_paused'],
    ['tier2_paused', 'tier3_paused'],
  ])('%s 逐級退回 %s', (mode, target) => {
    expect(decideDegradeStepDown({ ...base, mode }).targetMode).toBe(target);
  });

  it('last_transition 不明時視為已卡很久', () => {
    expect(decideDegradeStepDown({ ...base, lastTransitionAtMs: null }).stepDown).toBe(true);
  });
});

describe('decidePoolHeal', () => {
  const base = {
    poolName: 'backfill',
    dailyBudget: 600,
    baseDailyBudget: 600,
    usedToday: 10,
    resetAt: '2026-08-02',
    todayTaipei: '2026-08-02',
    manualOverride: false,
  };

  it('健康時不動作', () => {
    expect(decidePoolHeal(base)).toMatchObject({ action: 'none', reason: 'healthy' });
  });

  it('manual_override 一律不碰', () => {
    expect(decidePoolHeal({ ...base, manualOverride: true, resetAt: '2026-07-30' })).toMatchObject({
      action: 'none',
      reason: 'manual_override',
    });
  });

  it('reset_at 落後於台北今日 → 歸零用量', () => {
    const d = decidePoolHeal({ ...base, resetAt: '2026-08-01', usedToday: 900 });
    expect(d).toMatchObject({ action: 'roll_over', resetUsage: true, reason: 'stale_reset_at' });
    expect(d.targetBudget).toBeUndefined();
  });

  it('跨日且預算曾被收緊 → 同時還原到 base', () => {
    const d = decidePoolHeal({ ...base, resetAt: '2026-08-01', dailyBudget: 240 });
    expect(d).toMatchObject({ action: 'roll_over', resetUsage: true, targetBudget: 600 });
  });

  it('當日用滿且預算低於 base → 還原預算但不歸零用量', () => {
    const d = decidePoolHeal({ ...base, dailyBudget: 240, usedToday: 295 });
    expect(d).toMatchObject({
      action: 'restore_budget',
      targetBudget: 600,
      resetUsage: false,
      reason: 'budget_below_base_and_exhausted',
    });
  });

  it('用滿但預算已等於 base → 不無限膨脹', () => {
    expect(decidePoolHeal({ ...base, usedToday: 600 })).toMatchObject({ action: 'none', reason: 'healthy' });
  });

  it('沒有 base_daily_budget 時不做預算還原', () => {
    expect(decidePoolHeal({ ...base, baseDailyBudget: null, dailyBudget: 100, usedToday: 100 })).toMatchObject({
      action: 'none',
    });
  });
});

describe('taipeiDateString', () => {
  it('UTC 16:30 已是台北隔天', () => {
    expect(taipeiDateString(Date.UTC(2026, 7, 1, 16, 30))).toBe('2026-08-02');
  });
  it('UTC 15:30 仍是台北當天', () => {
    expect(taipeiDateString(Date.UTC(2026, 7, 1, 15, 30))).toBe('2026-08-01');
  });
});
