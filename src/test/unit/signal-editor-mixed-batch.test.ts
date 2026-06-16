import { describe, it, expect } from 'vitest';
import {
  computeCashSim,
  validateSignalBatch,
  buildSimulatedPositions,
  buildPublishRows,
} from '@/pages/_signalEditor/derive';
import type { CapitalStatus, TradeDraft } from '@/pages/_signalEditor/types';

const expert = { id: 'exp-1' };

function mkTrade(partial: Partial<TradeDraft> & { action: TradeDraft['action'] }): TradeDraft {
  return {
    uid: Math.random().toString(36).slice(2),
    executedAt: '2026-06-16T10:00',
    stockCode: '',
    stockName: '',
    action: partial.action,
    priceHint: '',
    quantity: '',
    quantityUnit: '張',
    reasonSummary: '',
    reasonDetail: '',
    riskNotes: '',
    ...partial,
  };
}

const capitalEmpty: CapitalStatus = {
  starting_capital: 1_000_000,
  realized_pnl_amount: 0,
  open_cost_value: 0,
  open_market_value: 0,
  unrealized_pnl_amount: 0,
  available_cash: 100_000, // 故意設低
  open_positions: [
    {
      symbol: '2330', instrument: '2330 台積電',
      quantity_shares: 3000, entry_price: 500,
      current_price: 520, market_value: 1_560_000,
      unrealized_pnl: 60_000, unrealized_pct: 4,
    },
    {
      symbol: '2454', instrument: '2454 聯發科',
      quantity_shares: 1000, entry_price: 800,
      current_price: 850, market_value: 850_000,
      unrealized_pnl: 50_000, unrealized_pct: 6.25,
    },
  ],
  recent_trades: [],
};

describe('signal editor: mixed add/trim batch (執行語意排序)', () => {
  it('case A：同檔先加碼後減碼 → 排序後通過、最終持倉淨值正確', () => {
    const trades: TradeDraft[] = [
      // UI 順序：先加碼 2330（需 200,000 > 100,000 現金）
      mkTrade({ stockCode: '2330', action: 'add', priceHint: '200', quantity: '1', quantityUnit: '張' }),
      // 再減碼 2330（釋放 220,000）
      mkTrade({ stockCode: '2330', action: 'trim', priceHint: '220', quantity: '1', quantityUnit: '張' }),
    ];
    const err = validateSignalBatch({ expert, trades, openPositions: [], capital: capitalEmpty });
    expect(err).toBeNull();

    const sim = computeCashSim(trades, capitalEmpty);
    // 排序後：先 trim（+220,000）→ 後 add（-200,000）
    expect(sim.remaining).toBe(100_000 + 220_000 - 200_000);

    const positions = buildSimulatedPositions(trades, capitalEmpty);
    // 初始 3000 - trim 1000 + add 1000 = 3000
    expect(positions.get('2330')).toBe(3000);
  });

  it('case B：跨檔 buy B 用 A 平倉換來的錢 → 排序後通過', () => {
    const trades: TradeDraft[] = [
      // UI 順序：先買 2454 加碼（需 100,000，剛好用完）
      mkTrade({ stockCode: '2454', action: 'add', priceHint: '100', quantity: '1', quantityUnit: '張' }),
      // 再平倉 2330（exit，釋放 3000 * 500 = 1,500,000）
      mkTrade({ stockCode: '2330', action: 'exit', priceHint: '520', quantity: '3', quantityUnit: '張' }),
    ];
    const err = validateSignalBatch({ expert, trades, openPositions: [], capital: capitalEmpty });
    expect(err).toBeNull();

    const sim = computeCashSim(trades, capitalEmpty);
    // 排序：exit 先 → +1,500,000；後 add → -100,000
    expect(sim.remaining).toBe(100_000 + 1_500_000 - 100_000);
  });

  it('case C：trim 超過模擬持倉 → 仍 fail，並回報「原始 UI index」', () => {
    const trades: TradeDraft[] = [
      mkTrade({ stockCode: '2330', action: 'add', priceHint: '100', quantity: '1', quantityUnit: '張' }), // idx 0
      mkTrade({ stockCode: '2454', action: 'trim', priceHint: '900', quantity: '5', quantityUnit: '張' }), // idx 1：超賣
    ];
    const err = validateSignalBatch({ expert, trades, openPositions: [], capital: capitalEmpty });
    expect(err).toMatch(/第 2 檔/);
    expect(err).toMatch(/減碼/);
  });

  it('case D：純加碼超額（無釋放資金可平衡）→ 仍 fail', () => {
    const trades: TradeDraft[] = [
      mkTrade({ stockCode: '9999', action: 'buy', priceHint: '500', quantity: '10', quantityUnit: '張' }),
    ];
    const err = validateSignalBatch({ expert, trades, openPositions: [], capital: capitalEmpty });
    expect(err).toMatch(/第 1 檔/);
    expect(err).toMatch(/超過操作金額上限/);
  });

  it('buildPublishRows 依執行順序排出（exit/trim 在 add/buy 之前），但 teaching 仍綁在原始第 1 筆', () => {
    const trades: TradeDraft[] = [
      mkTrade({ stockCode: '2454', action: 'add', priceHint: '100', quantity: '1', quantityUnit: '張', reasonSummary: 'A' }),
      mkTrade({ stockCode: '2330', action: 'exit', priceHint: '520', quantity: '3', quantityUnit: '張', reasonSummary: 'B' }),
    ];
    const rows = buildPublishRows({
      expertId: 'e', batchId: 'b', status: 'published',
      isMentor: true, teachingTopic: 'T', overallSummary: '<p>O</p>', learningPoints: '<p>L</p>',
      trades,
    });
    // 第一個 row 應該是 exit（執行順序優先）
    expect(rows[0].action).toBe('exit');
    expect(rows[1].action).toBe('add');
    // teaching_topic 仍綁在「原始 UI 第 1 筆」＝ add 那筆
    const addRow = rows.find((r: any) => r.action === 'add');
    expect(addRow.teaching_topic).toBe('T');
    const exitRow = rows.find((r: any) => r.action === 'exit');
    expect(exitRow.teaching_topic).toBeNull();
  });
});
