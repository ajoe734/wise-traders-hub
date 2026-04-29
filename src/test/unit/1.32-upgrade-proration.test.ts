import { describe, it, expect } from 'vitest';
import { calcUpgradeProration } from '../../../supabase/functions/_shared/revenueSplit.ts';

describe('calcUpgradeProration', () => {
  const monthlyPrice = 1000;
  const yearlyPrice = 10000;

  it('just started monthly → credit ≈ monthlyPrice', () => {
    const startedAt = new Date('2026-04-29T00:00:00Z');
    const expiresAt = new Date('2026-05-29T00:00:00Z');
    const now = new Date('2026-04-29T00:01:00Z');
    const r = calcUpgradeProration({ monthlyPrice, yearlyPrice, startedAt, expiresAt, now });
    expect(r.creditAmount).toBeGreaterThanOrEqual(999);
    expect(r.chargeAmount).toBe(yearlyPrice - r.creditAmount);
  });

  it('mid-cycle → credit ≈ monthlyPrice/2', () => {
    const startedAt = new Date('2026-04-01T00:00:00Z');
    const expiresAt = new Date('2026-05-01T00:00:00Z');
    const now = new Date('2026-04-16T00:00:00Z');
    const r = calcUpgradeProration({ monthlyPrice, yearlyPrice, startedAt, expiresAt, now });
    expect(r.creditAmount).toBeGreaterThan(450);
    expect(r.creditAmount).toBeLessThan(550);
  });

  it('expired → credit = 0, charge = yearlyPrice', () => {
    const startedAt = new Date('2026-03-01T00:00:00Z');
    const expiresAt = new Date('2026-04-01T00:00:00Z');
    const now = new Date('2026-04-29T00:00:00Z');
    const r = calcUpgradeProration({ monthlyPrice, yearlyPrice, startedAt, expiresAt, now });
    expect(r.creditAmount).toBe(0);
    expect(r.chargeAmount).toBe(yearlyPrice);
  });

  it('chargeAmount never negative', () => {
    const r = calcUpgradeProration({
      monthlyPrice: 100000, yearlyPrice: 10,
      startedAt: new Date('2026-04-29T00:00:00Z'),
      expiresAt: new Date('2026-05-29T00:00:00Z'),
      now: new Date('2026-04-29T00:01:00Z'),
    });
    expect(r.chargeAmount).toBeGreaterThanOrEqual(0);
  });
});
