/**
 * Phase 7 Step 3 — DB-first 批次報價契約測試。
 * 鎖住：欄位名（close_price / yesterday_close / price）、snapshot 優先於 current、
 * 以及寫入權威鏡像（同步消費端的唯一真相）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ table: string; select: string }> = [];
const rows: Record<string, any[]> = { daily_price_snapshots: [], current_prices: [] };

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from(table: string) {
      const builder: any = {
        select(sel: string) {
          calls.push({ table, select: sel });
          return builder;
        },
        in() { return builder; },
        eq() { return builder; },
        then(resolve: (v: any) => void) {
          return Promise.resolve({ data: rows[table] || [], error: null }).then(resolve);
        },
      };
      return builder;
    },
  },
}));

import { fetchAuthoritativeQuotes } from '@/checkup/lib/authoritativeQuotes';
import { readAuthoritativePrices, resetAuthoritativePrices } from '@/checkup/lib/authoritativePriceMirror';

// 週間台北 15:00 → TW 已定版（settled）
const SETTLED_TW = new Date('2026-07-29T07:00:00Z');

beforeEach(() => {
  calls.length = 0;
  rows.daily_price_snapshots = [];
  rows.current_prices = [];
  localStorage.clear();
  resetAuthoritativePrices();
});

describe('fetchAuthoritativeQuotes', () => {
  it('reads settled snapshot with real column names and computes change', async () => {
    rows.daily_price_snapshots = [
      { symbol: '2330', close_price: 1000, yesterday_close: 800, trade_date: '2026-07-29' },
    ];
    const out = await fetchAuthoritativeQuotes(['2330'], SETTLED_TW);
    expect(out['2330']).toMatchObject({ price: 1000, yesterday: 800, change: 200, source: 'snapshot' });
    expect(calls[0].select).toBe('symbol, close_price, yesterday_close, trade_date');
  });

  it('falls back to current_prices for symbols missing from the snapshot', async () => {
    rows.current_prices = [
      { symbol: '2330', price: 950, yesterday_close: 950, updated_at: '2026-07-29T06:00:00Z' },
    ];
    const out = await fetchAuthoritativeQuotes(['2330'], SETTLED_TW);
    expect(out['2330'].source).toBe('current');
    expect(out['2330'].change).toBe(0);
    expect(calls.map((c) => c.table)).toEqual(['daily_price_snapshots', 'current_prices']);
  });

  it('mirrors results so synchronous consumers see the same truth', async () => {
    rows.daily_price_snapshots = [
      { symbol: '2330', close_price: 1000, yesterday_close: 800, trade_date: '2026-07-29' },
    ];
    await fetchAuthoritativeQuotes(['2330'], SETTLED_TW);
    expect(readAuthoritativePrices()['2330']).toMatchObject({ price: 1000, source: 'snapshot' });
  });

  it('ignores non-positive prices and returns {} for empty input', async () => {
    rows.daily_price_snapshots = [{ symbol: '2330', close_price: 0, trade_date: '2026-07-29' }];
    expect(await fetchAuthoritativeQuotes([], SETTLED_TW)).toEqual({});
    expect(await fetchAuthoritativeQuotes(['2330'], SETTLED_TW)).toEqual({});
  });
});
