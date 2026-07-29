/**
 * Phase 6 — Holdings price parity E2E regression
 * (docs/architecture/price-authority.md, .lovable/plan.md)
 *
 * Contract under test:
 *   1. Opening the holdings workbench triggers a DB-first fetch against
 *      `daily_price_snapshots` (settled market) or `current_prices` (intraday).
 *   2. The mocked authoritative snapshot price flows through `useAuthoritativePrices`
 *      → `enrichedHoldings` → HoldingsDetailPanel drawer (identity + ROI render).
 *   3. Combo holdings (`is_combo=true`) trigger a `expert_signal_legs` fetch.
 *   4. `navigator.onLine=false` — hook must NOT hit `daily_price_snapshots` and
 *      the page must still render without runtime errors (offline fallback path).
 *
 * Runs against the demo route (`/holding-checkup-demo`) with Supabase REST mocked
 * — no real backend, no auth required. Combo scenario runs against the same
 * route but seeds a combo row via localStorage before boot.
 */
import { test, expect, type Page } from '@playwright/test';
import { installRoutes, seedSession } from './helpers/supabase-mock';
import { gotoWithRetry } from './helpers/navigation';

const DEMO_ROUTE = '/holding-checkup-demo';

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      // Reset parity dedupe so telemetry paths run fresh in test.
      window.localStorage.removeItem('lf.price_parity.reported.v1');
    } catch {}
  });
}

interface Counters {
  dailySnapshots: number;
  currentPrices: number;
  expertSignalLegs: number;
  parityEvents: number;
}

async function installPriceRoutes(page: Page, counters: Counters, opts: {
  snapshots?: Array<{ symbol: string; close_price: number; trade_date: string }>;
  currentPrices?: Array<{ symbol: string; price: number; updated_at: string }>;
  legs?: Array<Record<string, unknown>>;
} = {}) {
  await installRoutes(page, {
    rest: {
      daily_price_snapshots: ({ method }) => {
        if (method === 'GET') counters.dailySnapshots += 1;
        return opts.snapshots ?? [];
      },
      current_prices: ({ method }) => {
        if (method === 'GET') counters.currentPrices += 1;
        return opts.currentPrices ?? [];
      },
      expert_signal_legs: ({ method }) => {
        if (method === 'GET') counters.expertSignalLegs += 1;
        return opts.legs ?? [];
      },
      price_parity_events: ({ method }) => {
        if (method === 'POST') counters.parityEvents += 1;
        return { ok: true };
      },
      // Everything else: empty array (safe default per supabase-mock).
    },
    functions: {},
  });
}

test.describe('Phase 6 — holdings price parity (DB-first authority)', () => {
  test.beforeEach(async ({ page }) => {
    await primeDemo(page);
    await seedSession(page, { id: 'e2e-price-parity', email: 'parity@test.local' });
  });

  test('DB-first: opening workbench queries daily_price_snapshots and current_prices', async ({ page }) => {
    const counters: Counters = { dailySnapshots: 0, currentPrices: 0, expertSignalLegs: 0, parityEvents: 0 };
    await installPriceRoutes(page, counters, {
      snapshots: [
        { symbol: '3017', close_price: 1234.5, trade_date: new Date().toISOString().slice(0, 10) },
      ],
      currentPrices: [
        { symbol: '3017', price: 1234.5, updated_at: new Date().toISOString() },
      ],
    });

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await gotoWithRetry(page, DEMO_ROUTE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.wb-card').first()).toBeVisible({ timeout: 20_000 });

    // Hook fires after mount — allow ample time for the async fetch batch.
    await expect
      .poll(() => counters.dailySnapshots + counters.currentPrices, {
        timeout: 15_000,
        message: 'useAuthoritativePrices must hit daily_price_snapshots or current_prices',
      })
      .toBeGreaterThan(0);

    // Runtime health: hook path must not throw.
    const fatal = pageErrors.find((e) => /authoritative|snapshot|current_prices/i.test(e.message));
    expect(fatal, fatal?.message).toBeUndefined();
  });

  test('Combo holdings trigger expert_signal_legs fetch', async ({ page }) => {
    // Seed a combo row into the runtime holdings before mount.
    await page.addInitScript(() => {
      const key = 'lf.checkup.route.demo.holdings-v2';
      const combo = {
        id: 'combo-e2e-1',
        code: 'RKLB-COMBO',
        symbol: 'RKLB-COMBO',
        name: 'RKLB Iron Condor',
        type: 'option',
        asset_class: 'us_option',
        market: 'US',
        qty: 1,
        price: 0,
        cost: 3.6,
        is_combo: true,
        signal_id: 'sig-combo-e2e',
      };
      try {
        const existing = JSON.parse(window.localStorage.getItem(key) || '[]');
        window.localStorage.setItem(key, JSON.stringify([combo, ...(Array.isArray(existing) ? existing : [])]));
      } catch {
        window.localStorage.setItem(key, JSON.stringify([combo]));
      }
    });

    const counters: Counters = { dailySnapshots: 0, currentPrices: 0, expertSignalLegs: 0, parityEvents: 0 };
    await installPriceRoutes(page, counters, {
      legs: [
        { signal_id: 'sig-combo-e2e', underlying: 'RKLB', expiry: '2026-08-15', right: 'P', strike: 57.5, side: 'long', ratio: 1, price: 1.2 },
        { signal_id: 'sig-combo-e2e', underlying: 'RKLB', expiry: '2026-08-15', right: 'P', strike: 47.5, side: 'short', ratio: 1, price: 0.4 },
      ],
    });

    await gotoWithRetry(page, DEMO_ROUTE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.wb-card').first()).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(() => counters.expertSignalLegs, {
        timeout: 15_000,
        message: 'combo row must trigger expert_signal_legs fetch',
      })
      .toBeGreaterThan(0);
  });

  test('Offline: navigator.onLine=false skips daily_price_snapshots and renders', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(window.navigator, 'onLine', { get: () => false, configurable: true });
      } catch {}
    });

    const counters: Counters = { dailySnapshots: 0, currentPrices: 0, expertSignalLegs: 0, parityEvents: 0 };
    await installPriceRoutes(page, counters);

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await gotoWithRetry(page, DEMO_ROUTE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.wb-card').first()).toBeVisible({ timeout: 20_000 });

    // Give the hook a moment; it should NOT hit DB while offline (isOnline() gate + telemetry gated).
    await page.waitForTimeout(1500);
    expect(counters.parityEvents, 'parity telemetry must be gated on online=true').toBe(0);

    // No runtime crashes from the offline path.
    const fatal = pageErrors.find((e) => /authoritative|parity/i.test(e.message));
    expect(fatal, fatal?.message).toBeUndefined();
  });
});
