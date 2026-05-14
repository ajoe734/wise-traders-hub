## Problem
`getMonthlyDays()` in `usePeriodPerformance.ts` starts from the 1st of the previous month, producing ~45 trading days (≈1.5 months). This makes the "月績效" (monthly) chart span an unexpected period and inflates the cumulative return curve.

## Goal
Change the monthly period definition to **the most recent 20 trading days** (≈4 weeks), matching the user's intent for a consistent monthly window regardless of calendar month boundaries.

## Changes

### 1. Fix `getMonthlyDays()` in `src/hooks/usePeriodPerformance.ts`
Replace the rolling start-of-previous-month logic with a fixed 20 trading day window:

```text
function getMonthlyDays(): Date[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const out: Date[] = [];
  const d = new Date(now);
  while (out.length < 20) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.unshift(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}
```

This is structurally identical to `getWeeklyDays()` (which uses 5), ensuring consistency in the codebase.

### 2. Update project memory
Update `mem://features/performance/chart-specs` to reflect:
- Weekly: 5 trading days
- Monthly: 20 trading days (most recent)
- Yearly: last 12 months (end-of-month dates)

## Verification
- After the change, the monthly chart on `/expert/sharkgu` should show exactly 20 points on the X-axis.
- The date range displayed should be approximately 4 weeks back from today, not crossing a full month boundary.
- No other files reference `getMonthlyDays()` directly; the change is self-contained in `usePeriodPerformance.ts`.