/**
 * Phase 7 Step 2/4 — 同步消費端必須吃到 DB 權威價，而非 LocalStorage 舊價。
 *
 * 覆蓋：
 *  - readRouteMarketState()（總覽頁、投組摘要、normalizeHoldings 的共同源頭）
 *  - buildPortfolioSummariesFromStorage / buildOverviewRuntimeData
 *  - marketStore getPriceForCode / getPriceStatus
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AUTHORITATIVE_PRICE_KEY,
  writeAuthoritativePrices,
  resetAuthoritativePrices,
  mergeAuthoritativeIntoPriceCache,
} from '@/checkup/lib/authoritativePriceMirror';
import { MARKET_PRICE_CACHE_KEY } from '@/checkup/constants.js';
import {
  readRouteMarketState,
  invalidateRouteRuntimeCache,
} from '@/checkup/lib/routeRuntime.js';
import { useMarketDataStore as rawStore } from '@/checkup/stores/marketStore.js';

const useMarketDataStore = rawStore as unknown as { getState: () => any };

const LEGACY_CACHE = {
  marketDate: '2026-07-28',
  syncedAt: '2026-07-28T05:40:00.000Z',
  source: 'twse',
  status: 'fresh',
  prices: {
    2330: { price: 900, yesterday: 880, change: 20, changePct: 2.27 },
    AAPL: { price: 200, yesterday: 200, change: 0, changePct: 0 },
  },
};

beforeEach(() => {
  localStorage.clear();
  resetAuthoritativePrices();
  invalidateRouteRuntimeCache();
  useMarketDataStore.getState().reset();
});

describe('mergeAuthoritativeIntoPriceCache', () => {
  it('overrides legacy price and recomputes change from legacy yesterday', () => {
    const merged: any = mergeAuthoritativeIntoPriceCache(LEGACY_CACHE as any, {
      2330: { price: 1000, source: 'snapshot', updatedAt: '2026-07-29' },
    });
    expect(merged.prices['2330'].price).toBe(1000);
    expect(merged.prices['2330'].source).toBe('snapshot');
    expect(merged.prices['2330'].change).toBeCloseTo(120);
    // untouched symbol keeps legacy value
    expect(merged.prices.AAPL.price).toBe(200);
  });

  it('returns cache untouched when mirror empty', () => {
    expect(mergeAuthoritativeIntoPriceCache(LEGACY_CACHE as any, {})).toBe(LEGACY_CACHE);
  });

  it('works when there is no legacy cache at all', () => {
    const merged: any = mergeAuthoritativeIntoPriceCache(null as any, {
      NVDA: { price: 55, source: 'current', updatedAt: null },
    });
    expect(merged.prices.NVDA.price).toBe(55);
  });
});

describe('writeAuthoritativePrices', () => {
  it('only persists DB-authoritative sources', () => {
    writeAuthoritativePrices({
      2330: { price: 1000, source: 'snapshot', updatedAt: null },
      AAPL: { price: 220, source: 'current', updatedAt: null },
      SPREAD: { price: -2.5, source: 'combo', updatedAt: null },
      OLD: { price: 5, source: 'offline', updatedAt: null },
      GONE: { price: null, source: 'stale', updatedAt: null },
    });
    const stored = JSON.parse(localStorage.getItem(AUTHORITATIVE_PRICE_KEY) || '{}');
    expect(Object.keys(stored).sort()).toEqual(['2330', 'AAPL', 'SPREAD']);
  });
});

describe('readRouteMarketState (single price truth)', () => {
  it('serves the DB snapshot price, not the stale LocalStorage price', () => {
    localStorage.setItem(MARKET_PRICE_CACHE_KEY, JSON.stringify(LEGACY_CACHE));
    writeAuthoritativePrices({ 2330: { price: 1000, source: 'snapshot', updatedAt: '2026-07-29' } });
    invalidateRouteRuntimeCache();

    const { marketPriceCache } = readRouteMarketState();
    expect(marketPriceCache.prices['2330'].price).toBe(1000);
  });

  it('invalidates its memo when the mirror changes', () => {
    localStorage.setItem(MARKET_PRICE_CACHE_KEY, JSON.stringify(LEGACY_CACHE));
    invalidateRouteRuntimeCache();
    expect(readRouteMarketState().marketPriceCache.prices['2330'].price).toBe(900);

    writeAuthoritativePrices({ 2330: { price: 1234, source: 'snapshot', updatedAt: null } });
    expect(readRouteMarketState().marketPriceCache.prices['2330'].price).toBe(1234);
  });
});

describe('marketStore selectors', () => {
  it('getPriceForCode prefers authoritative mirror over cache', () => {
    useMarketDataStore.getState().setMarketPriceCache(LEGACY_CACHE);
    expect(useMarketDataStore.getState().getPriceForCode('2330')).toBe(900);

    writeAuthoritativePrices({ 2330: { price: 1111, source: 'current', updatedAt: null } });
    expect(useMarketDataStore.getState().getPriceForCode('2330')).toBe(1111);
    expect(useMarketDataStore.getState().getPriceStatus('2330')).toBe('up');
  });
});
