import { describe, it, expect } from 'vitest';
import { revenue3mYoY } from '../../../supabase/functions/_shared/monthRevenue';

const row = (y: number, m: number, v: number) => ({ revenue_year: y, revenue_month: m, revenue: v });
describe('近 3 個月營收年增', () => {
  it('7–9 月 330 對去年 300 → +10%', () => {
    const r = revenue3mYoY([row(2025, 7, 100), row(2025, 8, 100), row(2025, 9, 100), row(2026, 7, 110), row(2026, 8, 110), row(2026, 9, 110)]);
    expect(r?.latestMonth).toBe('2026-09');
    expect(r?.yoy).toBeCloseTo(0.1);
  });
  it('跨年：2026/01 往回取 2025/11、12', () => {
    const r = revenue3mYoY([row(2024, 11, 50), row(2024, 12, 50), row(2025, 1, 50), row(2025, 11, 100), row(2025, 12, 100), row(2026, 1, 100)]);
    expect(r?.yoy).toBeCloseTo(1);
  });
  it('缺去年同月 → null，不硬補', () => {
    expect(revenue3mYoY([row(2025, 8, 100), row(2025, 9, 100), row(2026, 7, 1), row(2026, 8, 1), row(2026, 9, 1)])).toBeNull();
  });
});
