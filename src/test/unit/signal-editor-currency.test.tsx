/**
 * 多幣別行為測試：emptyTrade / CapitalPanel / TradeCard
 *
 * 鎖住合約：
 *  - emptyTrade(currency) 預設單位 USD→「股」、TWD→「張」
 *  - CapitalPanel 顯示對應幣別符號（NT$/US$）與表頭（股數/Shares）
 *  - TradeCard 單位下拉 USD 只給「股」、TWD 給「張/股」；
 *    代碼 placeholder & USD 自動大寫
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { emptyTrade } from '@/pages/_signalEditor/types';
import { CapitalPanel } from '@/pages/_signalEditor/CapitalPanel';
import { TradeCard } from '@/pages/_signalEditor/TradeCard';
import type { CapitalStatus, TradeDraft } from '@/pages/_signalEditor/types';

// RichTextEditor 在 jsdom 下太重，stub 掉以聚焦 currency 行為
vi.mock('@/components/admin/LazyRichTextEditor', () => ({
  LazyRichTextEditor: ({ value }: { value?: string }) => (
    <div data-testid="rte">{value || ''}</div>
  ),
}));

describe('emptyTrade(currency)', () => {
  it('TWD 預設單位為「張」', () => {
    const t = emptyTrade('TWD');
    expect(t.quantityUnit).toBe('張');
    expect(t.stockCode).toBe('');
    expect(t.action).toBe('');
  });
  it('USD 預設單位為「股」', () => {
    expect(emptyTrade('USD').quantityUnit).toBe('股');
  });
  it('不帶參數時 fallback TWD', () => {
    expect(emptyTrade().quantityUnit).toBe('張');
  });
  it('每次呼叫產生不同 uid', () => {
    expect(emptyTrade('TWD').uid).not.toBe(emptyTrade('TWD').uid);
  });
});

function makeCapital(over: Partial<CapitalStatus> = {}): CapitalStatus {
  return {
    starting_capital: 1_000_000,
    realized_pnl_amount: 12_345,
    open_cost_value: 200_000,
    open_market_value: 210_000,
    unrealized_pnl_amount: 10_000,
    available_cash: 800_000,
    open_positions: [],
    recent_trades: [],
    ...over,
  };
}

describe('CapitalPanel currency 行為', () => {
  const baseProps = {
    cashSim: { remaining: 800_000, perTrade: [] },
    simulatedPositions: new Map<string, number>(),
    trades: [] as TradeDraft[],
    showHistory: false,
    setShowHistory: () => {},
    addTrade: () => {},
    updateTrade: () => {},
  };

  it('TWD：顯示 NT$ 與「股數」', () => {
    render(
      <CapitalPanel
        {...baseProps}
        capital={makeCapital()}
        currency="TWD"
      />,
    );
    expect(screen.getByText(/新台幣 \(TWD\)/)).toBeInTheDocument();
    expect(screen.getByText('NT$1,000,000')).toBeInTheDocument();
    expect(screen.getByText('+NT$12,345')).toBeInTheDocument();
  });

  it('USD：顯示 US$ 與「Shares」表頭', () => {
    render(
      <CapitalPanel
        {...baseProps}
        capital={makeCapital({
          starting_capital: 50_000,
          realized_pnl_amount: -1_200,
          available_cash: 40_000,
          open_positions: [{
            symbol: 'AAPL',
            instrument: 'AAPL Apple',
            quantity_shares: 100,
            entry_price: 180,
            current_price: 200,
            market_value: 20_000,
            unrealized_pnl: 2_000,
            unrealized_pct: 11.11,
          }],
        })}
        currency="USD"
      />,
    );
    expect(screen.getByText(/美元 \(USD\)/)).toBeInTheDocument();
    expect(screen.getByText('US$50,000')).toBeInTheDocument();
    expect(screen.getByText('-US$1,200')).toBeInTheDocument();
    // 表頭統一繁中「數量」，不再有英文 Shares（憲法：全站繁體）
    expect(screen.getAllByText('數量').length).toBeGreaterThan(0);
  });

  it('currency 未指定時 fallback 用 capital.currency', () => {
    render(
      <CapitalPanel
        {...baseProps}
        capital={makeCapital({ currency: 'USD' })}
      />,
    );
    expect(screen.getByText(/美元 \(USD\)/)).toBeInTheDocument();
  });
});

describe('TradeCard currency 行為', () => {
  const baseProps = {
    idx: 0,
    totalTrades: 1,
    signalTemplates: [],
    capital: null,
    cashSim: { remaining: 0, perTrade: [] },
    expertId: 'e1',
    removeTrade: () => {},
    moveTrade: () => {},
    fetchStockInfo: () => {},
    callAIAssist: async () => '',
  };

  it('TWD：placeholder 提示 2330、單位下拉可選', () => {
    const trade = emptyTrade('TWD');
    render(
      <TradeCard
        {...baseProps}
        trade={trade}
        currency="TWD"
        updateTrade={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText(/2330/)).toBeInTheDocument();
    // TWD 應有兩個單位可選 → Select 不該 disabled
    const trigger = document.querySelector('[role="combobox"].w-20') as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('data-disabled')).toBeNull();
  });

  it('USD：placeholder 提示 AAPL、單位鎖「股」、代碼自動大寫', () => {
    const trade = emptyTrade('USD');
    const updates: Array<Partial<TradeDraft>> = [];
    render(
      <TradeCard
        {...baseProps}
        trade={trade}
        currency="USD"
        updateTrade={(_idx, patch) => updates.push(patch)}
      />,
    );
    expect(screen.getByPlaceholderText(/AAPL/)).toBeInTheDocument();

    // 單位 Select 應 disabled（只有一個選項）
    const trigger = document.querySelector('[role="combobox"].w-20') as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('data-disabled')).not.toBeNull();

    // 輸入小寫代碼，應被 updateTrade 收到大寫版本
    const codeInput = screen.getByPlaceholderText(/AAPL/) as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: 'tsla' } });
    const patch = updates.find((p) => 'stockCode' in p);
    expect(patch?.stockCode).toBe('TSLA');
  });

  it('USD：若 draft 帶舊的「張」單位，UI 自動切回允許清單第一個（股）', () => {
    const trade: TradeDraft = { ...emptyTrade('USD'), quantityUnit: '張' };
    render(
      <TradeCard
        {...baseProps}
        trade={trade}
        currency="USD"
        updateTrade={() => {}}
      />,
    );
    // 顯示的單位值應為「股」，不可殘留「張」
    expect(screen.queryByText('張')).toBeNull();
    expect(screen.getAllByText('股').length).toBeGreaterThan(0);
  });
});
