/**
 * Phase 2b — pure combiner tests for useAuthoritativePrices.
 *
 * Focus on `combineAuthoritativePrices` because it holds all decision logic.
 * Realtime + supabase mocking is covered elsewhere by e2e; here we verify:
 *   - snapshot > current precedence via bySymbol
 *   - combo net premium equals calcNetPremium of legs
 *   - offline fallback only fires when online=false
 *   - DB miss while online → source='stale'
 */
import { describe, it, expect } from 'vitest';
import { combineAuthoritativePrices } from '../useAuthoritativePrices';
import { calcNetPremium, buildOccSymbol, type ComboLeg } from '@/lib/optionCombo';

describe('combineAuthoritativePrices', () => {
  it('uses snapshot when present', () => {
    const out = combineAuthoritativePrices({
      rows: [{ symbol: '2330', asset_class: 'tw_stock' }],
      bySymbol: new Map([
        ['2330', { price: 1000, updatedAt: '2026-07-29', source: 'snapshot', market: 'TW' }],
      ]),
      comboLegs: new Map(),
      legPrices: new Map(),
      offlineCache: {},
      online: true,
    });
    expect(out['2330'].price).toBe(1000);
    expect(out['2330'].source).toBe('snapshot');
    expect(out['2330'].market).toBe('TW');
  });

  it('falls back to current when snapshot absent', () => {
    const out = combineAuthoritativePrices({
      rows: [{ symbol: 'AAPL', asset_class: 'us_stock' }],
      bySymbol: new Map([
        ['AAPL', { price: 220.5, updatedAt: '2026-07-29T20:00:00Z', source: 'current', market: 'US' }],
      ]),
      comboLegs: new Map(),
      legPrices: new Map(),
      offlineCache: {},
      online: true,
    });
    expect(out.AAPL.source).toBe('current');
    expect(out.AAPL.price).toBe(220.5);
  });

  it('marks stale when online and DB has no row', () => {
    const out = combineAuthoritativePrices({
      rows: [{ symbol: 'MSFT', asset_class: 'us_stock' }],
      bySymbol: new Map(),
      comboLegs: new Map(),
      legPrices: new Map(),
      offlineCache: { MSFT: { price: 400, syncedAt: '2026-07-28' } },
      online: true,
    });
    expect(out.MSFT.source).toBe('stale');
    expect(out.MSFT.price).toBeNull();
  });

  it('uses offline cache only when navigator is offline', () => {
    const out = combineAuthoritativePrices({
      rows: [{ symbol: 'MSFT', asset_class: 'us_stock' }],
      bySymbol: new Map(),
      comboLegs: new Map(),
      legPrices: new Map(),
      offlineCache: { MSFT: { price: 400, syncedAt: '2026-07-28' } },
      online: false,
    });
    expect(out.MSFT.source).toBe('offline');
    expect(out.MSFT.price).toBe(400);
  });

  it('combo: aggregates net premium from priced legs', () => {
    const legs: ComboLeg[] = [
      { underlying: 'SNDK', expiry: '2026-08-15', right: 'P', strike: 950, side: 'long', ratio: 1, price: 0 },
      { underlying: 'SNDK', expiry: '2026-08-15', right: 'P', strike: 925, side: 'short', ratio: 1, price: 0 },
    ];
    const priced = legs.map((l, i) => ({ ...l, price: i === 0 ? 5 : 3 })); // long paid 5, short got 3
    const expected = calcNetPremium(priced);

    const legPrices = new Map<string, number>();
    legPrices.set(buildOccSymbol(legs[0]), 5);
    legPrices.set(buildOccSymbol(legs[1]), 3);

    const out = combineAuthoritativePrices({
      rows: [{ symbol: 'SNDK-COMBO', is_combo: true, signal_id: 'sig-1', asset_class: 'us_option' }],
      bySymbol: new Map(),
      comboLegs: new Map([['sig-1', legs]]),
      legPrices,
      offlineCache: {},
      online: true,
    });
    expect(out['SNDK-COMBO'].source).toBe('combo');
    expect(out['SNDK-COMBO'].price).toBe(expected);
    expect(out['SNDK-COMBO'].market).toBe('US_OPTION');
  });

  it('combo: missing any leg price → stale', () => {
    const legs: ComboLeg[] = [
      { underlying: 'RKLB', expiry: '2026-08-15', right: 'C', strike: 77.5, side: 'long', ratio: 1, price: 0 },
      { underlying: 'RKLB', expiry: '2026-08-15', right: 'C', strike: 87.5, side: 'short', ratio: 1, price: 0 },
    ];
    const legPrices = new Map<string, number>();
    legPrices.set(buildOccSymbol(legs[0]), 2); // only one leg has a price

    const out = combineAuthoritativePrices({
      rows: [{ symbol: 'RKLB-COMBO', is_combo: true, signal_id: 'sig-2', asset_class: 'us_option' }],
      bySymbol: new Map(),
      comboLegs: new Map([['sig-2', legs]]),
      legPrices,
      offlineCache: {},
      online: true,
    });
    expect(out['RKLB-COMBO'].source).toBe('stale');
    expect(out['RKLB-COMBO'].price).toBeNull();
  });

  it('uses code when symbol missing', () => {
    const out = combineAuthoritativePrices({
      rows: [{ code: '00631L' }],
      bySymbol: new Map([
        ['00631L', { price: 200, updatedAt: null, source: 'current', market: 'TW' }],
      ]),
      comboLegs: new Map(),
      legPrices: new Map(),
      offlineCache: {},
      online: true,
    });
    expect(out['00631L'].price).toBe(200);
  });
});
