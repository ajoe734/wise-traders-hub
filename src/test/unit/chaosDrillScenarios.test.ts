import { describe, it, expect } from 'vitest';
import {
  DRILL_SCENARIOS,
  DRILL_POOL_BASE_BUDGET,
  buildSwitchFixture,
  buildDegradeFixture,
  buildPoolStaleFixture,
  buildPoolExhaustedFixture,
  verifySwitch,
  verifyDegrade,
  verifyPoolRollOver,
  verifyPoolRestoreBudget,
  allPassed,
} from '../../../supabase/functions/_shared/chaosDrillScenarios.ts';
import {
  decideSwitchReopen,
  decideDegradeStepDown,
  decidePoolHeal,
  taipeiDateString,
} from '../../../supabase/functions/_shared/autoHealRules.ts';

const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);

describe('chaos drill 假資料一定會觸發 auto-heal', () => {
  it('三種情境都被列舉', () => {
    expect([...DRILL_SCENARIOS]).toEqual(['kill_switch', 'degrade', 'quota_pool']);
  });

  it('kill_switch fixture → 強制重開', () => {
    const f = buildSwitchFixture(NOW);
    const d = decideSwitchReopen({
      key: f.key,
      enabled: f.enabled,
      disabledReason: f.disabled_reason,
      disabledAtMs: new Date(f.disabled_at).getTime(),
      recentSamples: 0,
      nowMs: NOW,
    });
    expect(d).toMatchObject({ reopen: true, reason: 'stale_force_reopen' });
  });

  it('degrade fixture → 逐級退回，最終收斂到 normal', () => {
    let mode = String(buildDegradeFixture(NOW).mode);
    const steps: string[] = [];
    for (let i = 0; i < 10 && mode !== 'normal'; i++) {
      const d = decideDegradeStepDown({
        mode,
        cooldownUntilMs: NOW - 30 * 60_000,
        lastTransitionAtMs: NOW - 90 * 60_000,
        hasActiveDegradeSignal: false,
        nowMs: NOW,
      });
      expect(d.stepDown).toBe(true);
      mode = d.targetMode;
      steps.push(mode);
    }
    expect(mode).toBe('normal');
    expect(allPassed(verifyDegrade({ mode }, steps))).toBe(true);
  });

  it('quota_pool A（跨日）fixture → roll_over 並還原 base 預算', () => {
    const f = buildPoolStaleFixture(NOW);
    const d = decidePoolHeal({
      poolName: f.pool_name,
      dailyBudget: f.daily_budget,
      baseDailyBudget: f.base_daily_budget,
      usedToday: f.used_today,
      resetAt: f.reset_at,
      todayTaipei: taipeiDateString(NOW),
      manualOverride: false,
    });
    expect(d).toMatchObject({ action: 'roll_over', resetUsage: true, targetBudget: DRILL_POOL_BASE_BUDGET });
  });

  it('quota_pool B（當日用滿）fixture → restore_budget 但不歸零用量', () => {
    const f = buildPoolExhaustedFixture(NOW);
    const d = decidePoolHeal({
      poolName: f.pool_name,
      dailyBudget: f.daily_budget,
      baseDailyBudget: f.base_daily_budget,
      usedToday: f.used_today,
      resetAt: f.reset_at,
      todayTaipei: taipeiDateString(NOW),
      manualOverride: false,
    });
    expect(d).toMatchObject({ action: 'restore_budget', resetUsage: false, targetBudget: DRILL_POOL_BASE_BUDGET });
  });
});

describe('驗收條件本身是嚴格的', () => {
  it('switch 未重開 → FAIL', () => {
    expect(allPassed(verifySwitch({ enabled: false, disabled_reason: 'x' }))).toBe(false);
  });
  it('switch 重開且清空原因 → PASS', () => {
    expect(allPassed(verifySwitch({ enabled: true, disabled_reason: null }))).toBe(true);
  });
  it('degrade 仍卡住 → FAIL', () => {
    expect(allPassed(verifyDegrade({ mode: 'tier2_paused' }, ['tier2_paused']))).toBe(false);
  });
  it('reset_at 沒推進 → FAIL', () => {
    const checks = verifyPoolRollOver(
      { used_today: 0, reset_at: '2026-08-01', daily_budget: DRILL_POOL_BASE_BUDGET, tokens: 240 },
      NOW,
    );
    expect(allPassed(checks)).toBe(false);
    expect(checks.find((c) => c.name.includes('reset_at'))!.ok).toBe(false);
  });
  it('reset_at 推進 + 預算還原 + tokens 補滿 → PASS', () => {
    const checks = verifyPoolRollOver(
      { used_today: 0, reset_at: taipeiDateString(NOW), daily_budget: DRILL_POOL_BASE_BUDGET, tokens: 240 },
      NOW,
    );
    expect(allPassed(checks)).toBe(true);
  });
  it('daily_budget 未還原 → FAIL', () => {
    expect(allPassed(verifyPoolRestoreBudget({ daily_budget: 240, used_today: 240 }))).toBe(false);
  });
  it('daily_budget 還原且用量保留 → PASS', () => {
    expect(allPassed(verifyPoolRestoreBudget({ daily_budget: DRILL_POOL_BASE_BUDGET, used_today: 240 }))).toBe(true);
  });
});
