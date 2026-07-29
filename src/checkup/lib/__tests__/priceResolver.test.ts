/**
 * Phase 7 Step 1 — resolvePrice 契約測試。
 */
import { describe, it, expect } from 'vitest';
import { resolvePrice } from '../priceResolver';

const base = { market: 'TW' as const, online: true };

describe('resolvePrice', () => {
  it('snapshot wins and carries no stale reason', () => {
    const out = resolvePrice({
      ...base,
      authoritative: { price: 1000, updatedAt: '2026-07-29', source: 'snapshot' },
      offline: { price: 900 },
    });
    expect(out).toMatchObject({ price: 1000, source: 'snapshot', reason: null });
  });

  it('current is used when snapshot absent', () => {
    const out = resolvePrice({
      ...base,
      market: 'US',
      authoritative: { price: 220.5, updatedAt: 'x', source: 'current' },
    });
    expect(out.source).toBe('current');
    expect(out.price).toBe(220.5);
  });

  it('NEVER returns LocalStorage price while online', () => {
    const out = resolvePrice({ ...base, offline: { price: 999, syncedAt: '2026-07-28' } });
    expect(out.source).toBe('stale');
    expect(out.price).toBeNull();
    expect(out.reason).toBe('db_miss');
  });

  it('offline cache only when online=false', () => {
    const out = resolvePrice({ ...base, online: false, offline: { price: 400, syncedAt: 'd' } });
    expect(out).toMatchObject({ price: 400, source: 'offline', updatedAt: 'd', reason: null });
  });

  it('offline with no cache → unknown + reason', () => {
    const out = resolvePrice({ ...base, online: false });
    expect(out.source).toBe('unknown');
    expect(out.reason).toBe('offline_no_cache');
  });

  it('combo priced → source combo', () => {
    const out = resolvePrice({ ...base, market: 'US_OPTION', combo: { price: -2.5, legCount: 4 } });
    expect(out).toMatchObject({ price: -2.5, source: 'combo', reason: null });
  });

  it('combo missing a leg → stale with combo_leg_missing', () => {
    const out = resolvePrice({ ...base, market: 'US_OPTION', combo: { price: null, legCount: 4 } });
    expect(out.source).toBe('stale');
    expect(out.reason).toBe('combo_leg_missing');
  });

  it('combo with zero legs → combo_no_legs', () => {
    const out = resolvePrice({ ...base, market: 'US_OPTION', combo: { price: null, legCount: 0 } });
    expect(out.reason).toBe('combo_no_legs');
  });

  it('combo takes precedence over authoritative symbol hit', () => {
    const out = resolvePrice({
      ...base,
      market: 'US_OPTION',
      combo: { price: 3, legCount: 2 },
      authoritative: { price: 111, updatedAt: null, source: 'snapshot' },
    });
    expect(out.price).toBe(3);
  });

  it('rejects non-positive authoritative price and falls through', () => {
    const out = resolvePrice({
      ...base,
      authoritative: { price: 0, updatedAt: null, source: 'current' },
    });
    expect(out.source).toBe('stale');
  });
});
