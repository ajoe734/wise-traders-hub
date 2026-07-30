/**
 * Price-authority seam 擴張測試（防止「畫面價格與收盤價對不上」復發）。
 *
 * 契約：
 *  1. 任何「當下要顯示的價格」都必須經過 seam（`fetchAuthoritativeQuotes` /
 *     `useAuthoritativePrices` / `mergeAuthoritativeIntoPriceCache`），
 *     不得自行 `.from('current_prices')` —— 那會在收盤後顯示盤中價。
 *  2. 走 seam 的消費端在 settled 時段必須拿到 snapshot 價，而非 current 價。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook, waitFor } from '@testing-library/react';

// ── 共用 supabase mock ────────────────────────────────────────────────
const rows: Record<string, any[]> = { daily_price_snapshots: [], current_prices: [] };
const queried: string[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from(table: string) {
      queried.push(table);
      const builder: any = {
        select: () => builder,
        in: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: (rows[table] || [])[0] ?? null, error: null }),
        then: (resolve: (v: any) => void) =>
          Promise.resolve({ data: rows[table] || [], error: null }).then(resolve),
      };
      return builder;
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));

// 週間台北 15:00 → TW 已定版
const SETTLED_TW = new Date('2026-07-29T07:00:00Z');

beforeEach(() => {
  rows.daily_price_snapshots = [];
  rows.current_prices = [];
  queried.length = 0;
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(SETTLED_TW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 1. 靜態守衛 ───────────────────────────────────────────────────────
const SEAM_ALLOWLIST = new Set([
  'src/checkup/lib/authoritativeQuotes.ts',
  'src/checkup/hooks/useAuthoritativePrices.ts',
  // 歷史區間績效／回測監控讀的是「指定日期」的歷史快照，不是當下顯示價。
  'src/hooks/usePeriodPerformance.ts',
  'src/hooks/company/useBacktestMonitor.ts',
]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'test') continue;
      walk(full, acc);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\./.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('price authority seam guard', () => {
  it('no consumer queries current_prices / daily_price_snapshots outside the seam', () => {
    const offenders: string[] = [];
    for (const file of walk('src')) {
      if (SEAM_ALLOWLIST.has(file.replace(/\\/g, '/'))) continue;
      const src = readFileSync(file, 'utf8');
      if (/\.from\(\s*['"`](current_prices|daily_price_snapshots)['"`]\s*\)/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── 2. 消費端整合測試 ─────────────────────────────────────────────────
describe('useStockQuote goes through the seam', () => {
  it('shows the settled snapshot close, not the intraday current price', async () => {
    rows.daily_price_snapshots = [
      { symbol: '2330', close_price: 1000, yesterday_close: 800, trade_date: '2026-07-29' },
    ];
    rows.current_prices = [{ symbol: '2330', price: 950, yesterday_close: 800 }];

    const { useStockQuote } = await import('@/hooks/useStockQuote');
    const { result } = renderHook(() => useStockQuote('2330'));

    await waitFor(() => expect(result.current.quote).not.toBeNull());
    expect(result.current.quote).toMatchObject({ symbol: '2330', price: 1000, change: 200 });
    expect(result.current.quote!.changePercent).toBeCloseTo(25, 5);
  });

  it('falls back to current_prices when the snapshot has no row', async () => {
    rows.current_prices = [{ symbol: '2330', price: 950, yesterday_close: 950 }];
    const { useStockQuote } = await import('@/hooks/useStockQuote');
    const { result } = renderHook(() => useStockQuote('2330'));
    await waitFor(() => expect(result.current.quote).not.toBeNull());
    expect(result.current.quote).toMatchObject({ price: 950, change: 0 });
  });
});

describe('demo holdings hydration goes through the seam', () => {
  it('hydrates DEMO holdings with the snapshot close price', async () => {
    rows.daily_price_snapshots = [
      { symbol: '2330', close_price: 1000, yesterday_close: 800, trade_date: '2026-07-29' },
    ];
    rows.current_prices = [{ symbol: '2330', price: 950, yesterday_close: 800 }];

    const { hydrateDemoHoldingsWithClosePrices } = await import('@/hooks/useFreeCheckupBootstrap');
    const out = await hydrateDemoHoldingsWithClosePrices([
      { code: '2330', name: '台積電', qty: 1000, price: 500 },
    ]);
    expect(out[0]).toMatchObject({ price: 1000, yesterday: 800, change: 200, todayPnl: 200000 });
  });

  it('returns the original holdings when the DB has nothing', async () => {
    const { hydrateDemoHoldingsWithClosePrices } = await import('@/hooks/useFreeCheckupBootstrap');
    const input = [{ code: '2330', name: '台積電', qty: 1000, price: 500 }];
    expect(await hydrateDemoHoldingsWithClosePrices(input)).toEqual(input);
  });
});

// ── 3. seam 對外單檔查詢 API ──────────────────────────────────────────
describe('fetchAuthoritativeQuote (single symbol)', () => {
  it('returns the snapshot quote for one symbol', async () => {
    rows.daily_price_snapshots = [
      { symbol: 'AAPL', close_price: 220, yesterday_close: 200, trade_date: '2026-07-29' },
    ];
    const { fetchAuthoritativeQuote } = await import('@/checkup/lib/authoritativeQuotes');
    const q = await fetchAuthoritativeQuote('AAPL', SETTLED_TW);
    expect(q).toMatchObject({ price: 220, source: 'snapshot' });
  });

  it('returns null for an unknown symbol', async () => {
    const { fetchAuthoritativeQuote } = await import('@/checkup/lib/authoritativeQuotes');
    expect(await fetchAuthoritativeQuote('NOPE', SETTLED_TW)).toBeNull();
  });
});
