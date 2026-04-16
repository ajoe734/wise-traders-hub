import { differenceInMonths } from 'date-fns';

export interface RefundInput {
  started_at: string;
  expires_at: string | null;
  plan: {
    price_monthly: number;
    price_yearly: number | null;
  };
}

export interface RefundResult {
  isYearly: boolean;
  refundAmount: number;
  remainingMonths: number;
  originalAmount: number;
  monthlyPrice: number;
}

/**
 * Calculate cancellation refund for a subscription.
 * Monthly plans: no refund.
 * Yearly plans: refund = monthly_price × remaining full months (from next month to expiry).
 *
 * @param sub - Subscription data containing plan pricing and dates
 * @param now - Current date (injectable for testing; defaults to new Date())
 */
export function calcRefund(sub: RefundInput, now: Date = new Date()): RefundResult {
  const startedAt = new Date(sub.started_at);
  const isYearly = !!(
    sub.plan.price_yearly &&
    sub.plan.price_yearly > 0 &&
    sub.expires_at &&
    new Date(sub.expires_at).getTime() - startedAt.getTime() > 180 * 86400000
  );

  if (!isYearly) {
    return {
      isYearly: false,
      refundAmount: 0,
      remainingMonths: 0,
      originalAmount: sub.plan.price_monthly,
      monthlyPrice: sub.plan.price_monthly,
    };
  }

  const yearlyAmount = sub.plan.price_yearly || sub.plan.price_monthly * 12;
  const monthlyPrice = Math.floor(yearlyAmount / 12);
  const expiresAt = new Date(sub.expires_at!);
  // Start of next month (the first day the user will NOT be using the service)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  // Use calendar-aware month difference to avoid 28/29/30/31-day drift
  const remainingMonths = Math.max(0, differenceInMonths(expiresAt, nextMonthStart));
  const refundAmount = monthlyPrice * remainingMonths;

  return { isYearly: true, refundAmount, remainingMonths, originalAmount: yearlyAmount, monthlyPrice };
}
