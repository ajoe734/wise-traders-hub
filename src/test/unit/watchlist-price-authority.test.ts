/**
 * B1 — 價格權威：watchlist / dossier 消費端不得直接吃 legacy marketPriceCache。
 *
 * `applyQuotesToWatchlist` 是 usePortfolioDerivedData 的取價 seam；
 * 它必須先把 authoritative mirror 疊上去，才可套用到列上。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  writeAuthoritativePrices,
  resetAuthoritativePrices,
} from '@/checkup/lib/authoritativePriceMirror';
import { applyQuotesToWatchlist, type WatchlistRow } from '@/checkup/lib/watchlistQuotes';

const LEGACY_CACHE = {
  marketDate: '2026-07-28',
  syncedAt: '2026-07-28T05:40:00.000Z',
  prices: {
    2330: { price: 900, yesterday: 880, change: 20, changePct: 2.27 },
    2317: { price: 200, yesterday: 200, change: 0, changePct: 0 },
  },
};

beforeEach(() => {
  localStorage.clear();
  resetAuthoritativePrices();
});

describe('applyQuotesToWatchlist', () => {
  it('uses the authoritative snapshot price instead of the stale legacy price', () => {
    writeAuthoritativePrices({ 2330: { price: 1000, source: 'snapshot', updatedAt: null } });
    const rows = applyQuotesToWatchlist<WatchlistRow>([{ code: '2330', target: 1200 }], LEGACY_CACHE);
    expect(rows[0].price).toBe(1000);
    expect(rows[0].changePct).toBeCloseTo(((1000 - 880) / 880) * 100, 4);
    expect(rows[0].upside).toBeCloseTo(((1200 - 1000) / 1000) * 100, 4);
  });

  it('falls back to the legacy quote when no authoritative price exists', () => {
    const rows = applyQuotesToWatchlist<WatchlistRow>([{ code: '2317', target: null }], LEGACY_CACHE);
    expect(rows[0].price).toBe(200);
    expect(rows[0].upside).toBeNull();
  });

  it('leaves rows untouched when there is no quote at all', () => {
    const rows = applyQuotesToWatchlist<WatchlistRow>([{ code: '6505', price: 55 }], LEGACY_CACHE);
    expect(rows[0].price).toBe(55);
  });

  it('returns the same array reference when there are no prices to apply', () => {
    const rows: WatchlistRow[] = [{ code: '2330' }];
    expect(applyQuotesToWatchlist(rows, null)).toBe(rows);
    expect(applyQuotesToWatchlist([], LEGACY_CACHE)).toEqual([]);
  });

  it('serves the authoritative price even when the legacy cache is empty', () => {
    writeAuthoritativePrices({ NVDA: { price: 180, source: 'current', updatedAt: null } });
    const rows = applyQuotesToWatchlist<WatchlistRow>([{ code: 'NVDA' }], null);
    expect(rows[0].price).toBe(180);
  });
});
