import { describe, expect, it } from 'vitest';
import { createRateLimiter, projectRows, safeEqual, validateRange } from '../../../supabase/functions/_shared/igReportCore';

describe('ig-conversion-report range', () => {
  it('accepts 31 days', () => expect(validateRange('2026-10-01', '2026-10-31').ok).toBe(true));
  it('rejects 32 days', () => expect(validateRange('2026-10-01', '2026-11-01').ok).toBe(false));
  it('rejects bad format and impossible dates', () => {
    expect(validateRange('2026/10/01', '2026-10-02').ok).toBe(false);
    expect(validateRange('2026-02-30', '2026-03-01').ok).toBe(false);
  });
  it('rejects until before since', () => expect(validateRange('2026-11-01', '2026-10-31').ok).toBe(false));
});

describe('ig-conversion-report auth & limits', () => {
  it('key must match exactly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('', 'abc')).toBe(false);
  });
  it('allows 30 per minute then blocks', () => {
    const allow = createRateLimiter();
    for (let i = 0; i < 30; i++) expect(allow(1000)).toBe(true);
    expect(allow(1000)).toBe(false);
    expect(allow(61_001)).toBe(true);
  });
});

describe('ig-conversion-report projection', () => {
  it('drops any non-aggregate field', () => {
    const [row] = projectRows([{ date: '2026-10-31', utm_source: 'ig', utm_medium: 'mia_ig', utm_campaign: 'x',
      visitors: 3, signups: 1, purchases: 1, revenue: 799.4, holdings_board_conversions: 0, event_signups: 0,
      email: 'a@b.c', user_id: 'u1' } as any]);
    expect(Object.keys(row)).not.toContain('email');
    expect(Object.keys(row)).not.toContain('user_id');
    expect(row.revenue).toBe(799);
  });
});

import { groupExpertDaily, taipeiBounds } from '../../../supabase/functions/_shared/igReportCore';

describe('expert_daily', () => {
  it('Taipei day bounds are inclusive of until', () => {
    expect(taipeiBounds('2026-10-05', '2026-11-03')).toEqual({ from: '2026-10-04T16:00:00.000Z', to: '2026-11-03T16:00:00.000Z' });
  });
  it('groups by Taipei order date + expert slug', () => {
    const rows = groupExpertDaily([
      { created_at: '2026-10-20T15:59:00Z', expert_slug: 'sharkgu', gross: 1799, net: 1799, expert_amount: 810 },
      { created_at: '2026-10-20T16:01:00Z', expert_slug: 'sharkgu', gross: 1799, net: 1799, expert_amount: 810 },
      { created_at: '2026-10-21T01:00:00Z', expert_slug: 'sharkgu', gross: 1799, net: 1799, expert_amount: 810 },
      { created_at: '2026-10-21T01:00:00Z', expert_slug: null, gross: 999, net: 999, expert_amount: 1 },
    ], '2026-10-20', '2026-10-21');
    expect(rows).toEqual([
      { date: '2026-10-20', expert: 'sharkgu', orders: 1, gross: 1799, net: 1799, expert_share: 810 },
      { date: '2026-10-21', expert: 'sharkgu', orders: 2, gross: 3598, net: 3598, expert_share: 1620 },
    ]);
  });
  it('drops dates outside since..until', () => {
    expect(groupExpertDaily([{ created_at: '2026-10-19T10:00:00Z', expert_slug: 'a', gross: 1, net: 1, expert_amount: 1 }], '2026-10-20', '2026-10-21')).toEqual([]);
  });
});
