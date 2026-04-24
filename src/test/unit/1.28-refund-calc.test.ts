import { describe, it, expect } from 'vitest';
import { calcRefund } from '@/lib/refundCalc';

describe('1.28 refundCalc', () => {
  it('returns no refund for monthly plan', () => {
    const result = calcRefund(
      {
        started_at: '2025-01-01T00:00:00Z',
        expires_at: '2025-02-01T00:00:00Z',
        plan: { price_monthly: 599, price_yearly: null },
      },
      new Date('2025-01-15T00:00:00Z'),
    );
    expect(result.isYearly).toBe(false);
    expect(result.refundAmount).toBe(0);
    expect(result.remainingMonths).toBe(0);
  });

  it('returns no refund when price_yearly is missing even if duration is yearly', () => {
    const result = calcRefund(
      {
        started_at: '2025-01-01T00:00:00Z',
        expires_at: '2026-01-01T00:00:00Z',
        plan: { price_monthly: 599, price_yearly: null },
      },
      new Date('2025-06-01T00:00:00Z'),
    );
    expect(result.isYearly).toBe(false);
  });

  it('refunds remaining full months for yearly plan', () => {
    // Started Jan 1 2025, expires Jan 1 2026 (yearly). Today: Mar 15 2025.
    // Next month start: Apr 1 2025. Months from Apr 1 → Jan 1 2026 = 9
    const result = calcRefund(
      {
        started_at: '2025-01-01T00:00:00Z',
        expires_at: '2026-01-01T00:00:00Z',
        plan: { price_monthly: 599, price_yearly: 5990 },
      },
      new Date('2025-03-15T00:00:00Z'),
    );
    expect(result.isYearly).toBe(true);
    expect(result.remainingMonths).toBe(9);
    // monthlyPrice = floor(5990 / 12) = 499
    expect(result.monthlyPrice).toBe(499);
    expect(result.refundAmount).toBe(499 * 9);
  });

  it('returns 0 refund when subscription is in its final month', () => {
    const result = calcRefund(
      {
        started_at: '2025-01-01T00:00:00Z',
        expires_at: '2026-01-01T00:00:00Z',
        plan: { price_monthly: 599, price_yearly: 5990 },
      },
      new Date('2025-12-15T00:00:00Z'),
    );
    expect(result.isYearly).toBe(true);
    expect(result.remainingMonths).toBe(0);
    expect(result.refundAmount).toBe(0);
  });

  it('handles leap year boundary correctly via differenceInMonths', () => {
    // Yearly starting 2024-02-15, expiring 2025-02-15. Today: 2024-02-15.
    // Next month: 2024-03-01 → 2025-02-15 = 11 full months
    const result = calcRefund(
      {
        started_at: '2024-02-15T00:00:00Z',
        expires_at: '2025-02-15T00:00:00Z',
        plan: { price_monthly: 599, price_yearly: 5990 },
      },
      new Date('2024-02-15T00:00:00Z'),
    );
    expect(result.isYearly).toBe(true);
    expect(result.remainingMonths).toBe(11);
  });
});
