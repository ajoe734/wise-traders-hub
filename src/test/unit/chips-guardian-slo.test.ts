// PR-10: SLO adjustment 邊界 case（golden 外的補強）
import { describe, it, expect } from 'vitest';
import { decideSloAdjustment, SLO_BOOST_MS } from '../../../supabase/functions/_shared/guardianRules';

const base = () => ({
  poolName: 'keepwarm' as string,
  currentBudget: 1000,
  baseCapacity: 1000,
  boostUntilMs: null as number | null,
  manualOverride: false,
  totalSamples: 100,
  rejectRate: 0.3,
  nowMs: 1_700_000_000_000,
});

describe('decideSloAdjustment — 邊界', () => {
  it('rate 剛好 = tighten 門檻應觸發 tighten', () => {
    const r = decideSloAdjustment({ ...base(), rejectRate: 0.5 });
    expect(r.reason).toBe('tighten');
    expect(r.changed).toBe(true);
  });

  it('rate 剛好 = relax 門檻應觸發 relax', () => {
    const r = decideSloAdjustment({ ...base(), rejectRate: 0.05 });
    // current == base == 1000 → 提升到 1250 → relax_boost
    expect(r.reason).toBe('relax_boost');
    expect(r.targetBudget).toBe(1250);
    expect(r.newBoostUntilMs).toBe(base().nowMs + SLO_BOOST_MS);
  });

  it('中間 rate（0.3）保持 noop', () => {
    const r = decideSloAdjustment({ ...base(), rejectRate: 0.3 });
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('noop');
  });

  it('interactive 恆跳過（即使 100% reject）', () => {
    const r = decideSloAdjustment({ ...base(), poolName: 'interactive', rejectRate: 1 });
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('skipped_interactive');
  });

  it('manual_override 恆跳過', () => {
    const r = decideSloAdjustment({ ...base(), manualOverride: true, rejectRate: 1 });
    expect(r.reason).toBe('skipped_manual_override');
  });

  it('boost 未過期不會回落', () => {
    const now = 1_700_000_000_000;
    const r = decideSloAdjustment({
      ...base(),
      currentBudget: 1500,
      boostUntilMs: now + 60_000,
      rejectRate: 0.3,
      nowMs: now,
    });
    expect(r.reason).toBe('noop');
  });

  it('boost 已過期且 current > base → 回落到 base', () => {
    const now = 1_700_000_000_000;
    const r = decideSloAdjustment({
      ...base(),
      currentBudget: 1500,
      boostUntilMs: now - 1,
      rejectRate: 0.2,
      nowMs: now,
    });
    expect(r.reason).toBe('boost_expired_reset');
    expect(r.targetBudget).toBe(1000);
    expect(r.newBoostUntilMs).toBe(null);
  });

  it('tighten 遇 min multiplier 地板 → noop', () => {
    const r = decideSloAdjustment({ ...base(), currentBudget: 500, rejectRate: 0.9 });
    // floor(1000*0.5)=500; floor(500*0.8)=400; max=500 == current → noop
    expect(r.reason).toBe('noop');
  });
});
