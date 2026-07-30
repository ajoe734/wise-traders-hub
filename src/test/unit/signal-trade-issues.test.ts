/**
 * B2 — 單位／方向驗證必須在「輸入當下」就回報，而不是送出後才擋。
 *
 * Seam：`collectTradeIssues`（純函式，`_signalEditor/derive.ts`）
 * 回傳逐筆、逐欄位的問題清單，供 TradeCard 即時顯示。
 */
import { describe, it, expect } from 'vitest';
import { collectTradeIssues } from '@/pages/_signalEditor/derive';
import { emptyTrade, type CapitalStatus, type TradeDraft } from '@/pages/_signalEditor/types';

const twExpert = { asset_class: 'tw_stock', market: 'TW' };

function draft(over: Partial<TradeDraft> = {}): TradeDraft {
  return { ...emptyTrade('TWD'), ...over };
}

const capital = (over: Partial<CapitalStatus> = {}): CapitalStatus => ({
  starting_capital: 1_000_000,
  realized_pnl_amount: 0,
  open_cost_value: 0,
  open_market_value: 0,
  unrealized_pnl_amount: 0,
  available_cash: 1_000_000,
  open_positions: [],
  recent_trades: [],
  asset_class: 'tw_stock',
  ...over,
});

describe('collectTradeIssues', () => {
  it('flags an illegal unit for the asset class as UNIT_MIX on the quantity field', () => {
    const issues = collectTradeIssues({
      expert: twExpert,
      trades: [draft({ stockCode: '2330', action: 'buy', quantity: '1', priceHint: '100', quantityUnit: '口' as any })],
      capital: capital(),
    });
    const hit = issues.find((i) => i.code === 'UNIT_MIX');
    expect(hit).toBeTruthy();
    expect(hit!.index).toBe(0);
    expect(hit!.field).toBe('quantityUnit');
    expect(hit!.message).toContain('股');
  });

  it('flags selling more than the open position as DIRECTION_OVERSELL', () => {
    const issues = collectTradeIssues({
      expert: twExpert,
      trades: [draft({ stockCode: '2330', action: 'trim', quantity: '5', priceHint: '900', quantityUnit: '張' })],
      capital: capital({
        open_positions: [{
          symbol: '2330', instrument: '台積電', quantity_shares: 2000, quantity_unit: '股',
          entry_price: 800, current_price: 900, market_value: 1_800_000, unrealized_pnl: 0, unrealized_pct: 0,
        }],
      }),
    });
    const hit = issues.find((i) => i.code === 'DIRECTION_OVERSELL');
    expect(hit).toBeTruthy();
    expect(hit!.field).toBe('quantity');
  });

  it('flags an action with no position at all as DIRECTION_NO_POSITION', () => {
    const issues = collectTradeIssues({
      expert: twExpert,
      trades: [draft({ stockCode: '2454', action: 'exit', quantity: '1', priceHint: '1000', quantityUnit: '張' })],
      capital: capital(),
    });
    expect(issues.map((i) => i.code)).toContain('DIRECTION_NO_POSITION');
  });

  it('flags spending beyond available cash as CAPITAL_EXCEEDED', () => {
    const issues = collectTradeIssues({
      expert: twExpert,
      trades: [draft({ stockCode: '2330', action: 'buy', quantity: '10', priceHint: '900', quantityUnit: '張' })],
      capital: capital({ available_cash: 100_000 }),
    });
    expect(issues.map((i) => i.code)).toContain('CAPITAL_EXCEEDED');
  });

  it('returns no issues for a valid draft, and stays silent while fields are still blank', () => {
    expect(
      collectTradeIssues({
        expert: twExpert,
        trades: [draft({ stockCode: '2330', action: 'buy', quantity: '1', priceHint: '900', quantityUnit: '張' })],
        capital: capital(),
      }),
    ).toEqual([]);

    // 尚未填完的草稿不該噴紅字（送出時才由 validateSignalBatch 擋）
    expect(collectTradeIssues({ expert: twExpert, trades: [draft()], capital: capital() })).toEqual([]);
  });

  it('accounts for earlier trades in the same batch (sell then buy back)', () => {
    const issues = collectTradeIssues({
      expert: twExpert,
      trades: [
        draft({ stockCode: '2330', action: 'exit', quantity: '2', priceHint: '900', quantityUnit: '張' }),
        draft({ stockCode: '2330', action: 'buy', quantity: '2', priceHint: '900', quantityUnit: '張' }),
      ],
      capital: capital({
        available_cash: 0,
        open_positions: [{
          symbol: '2330', instrument: '台積電', quantity_shares: 2000, quantity_unit: '股',
          entry_price: 900, current_price: 900, market_value: 1_800_000, unrealized_pnl: 0, unrealized_pct: 0,
        }],
      }),
    });
    expect(issues).toEqual([]);
  });
});
