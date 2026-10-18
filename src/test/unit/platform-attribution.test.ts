import { describe, expect, it } from 'vitest';
import { aggregatePlatforms, platformName } from '@/lib/analytics/platformAttribution';
const from = '2026-10-01T00:00:00Z', to = '2026-11-01T00:00:00Z';
const base = { utm_campaign: 'brcto_journal', utm_content: 'ig' };
describe('platform attribution', () => {
  it.each([['ig', 'IG'], ['fb', 'FB'], ['yt', 'YouTube'], ['line', 'LINE'], [null, '未標平台'], ['podcast', 'podcast']])('identifies %s without guessing', (value, name) => expect(platformName(value)).toBe(name));
  it('separates platform revenue, excludes other campaigns / outside range / internal visits and deduplicates', () => {
    const visit = { ...base, visitor_id: 'v', first_seen_at: '2026-10-18T00:00:00Z' };
    const order = { ...base, id: 'o', gross_amount: 799, occurred_at: visit.first_seen_at };
    const rows = aggregatePlatforms([visit, visit, { ...visit, visitor_id: 'internal', is_internal: true }, { ...visit, visitor_id: 'outside', first_seen_at: to }, { ...visit, visitor_id: 'other', utm_campaign: 'other' }], [], [order, order, { ...order, id: 'fb', utm_content: 'fb', gross_amount: 100 }, { ...order, id: 'other', utm_campaign: 'other' }, { ...order, id: 'outside', occurred_at: to }], [], 'brcto_journal', from, to);
    expect(rows).toEqual([{ platform: 'IG', visitors: 1, signups: 0, orders: 1, gross: 799 }, { platform: 'FB', visitors: 0, signups: 0, orders: 1, gross: 100 }]);
  });
  it('counts actual registration dates, not existing members logging in, respecting first touch and expiry', () => {
    const referral = { ...base, user_id: 'new', created_at: '2026-10-18T00:00:00Z', locked_until: to };
    const rows = aggregatePlatforms([], [referral, referral, { ...referral, utm_content: 'fb', created_at: '2026-10-19T00:00:00Z' }, { ...referral, user_id: 'old' }, { ...referral, user_id: 'expired', locked_until: from }], [], [{ user_id: 'new', created_at: referral.created_at }, { user_id: 'old', created_at: '2025-01-01T00:00:00Z' }, { user_id: 'expired', created_at: referral.created_at }], 'brcto_journal', from, to);
    expect(rows).toEqual([{ platform: 'IG', visitors: 0, signups: 1, orders: 0, gross: 0 }]);
  });
});