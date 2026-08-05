import { describe, it, expect } from 'vitest';
import { buildFactsheet, tradePnlAmount, type FactsheetExpert, type FactsheetTrade } from '@/lib/performance/factsheet';

/**
 * 口徑鎖定：這些數字取自資料庫中彥愷（sharkgu）的真實交易統計，
 * 用縮小樣本驗證公式與 `calculate_expert_performance` RPC 一致。
 */
const expert: FactsheetExpert = {
  id: 'e1', slug: 'sharkgu', name: '彥愷', role: 'mentor',
  starting_capital: 1_000_000, currency: 'TWD', asset_class: 'tw_stock',
  strategy_summary: '波段', description: null, style_tags: ['尊重趨勢'], markets: ['台股'],
};

const t = (o: Partial<FactsheetTrade>): FactsheetTrade => ({
  id: Math.random().toString(36), instrument: '2330 台積電',
  entry_price: 100, exit_price: 110, current_price: null, quantity: 1000,
  entry_date: '2026-05-01T00:00:00Z', exit_date: '2026-05-10T00:00:00Z',
  pnl_percent: 10, status: 'closed', ...o,
});

describe('factsheet', () => {
  it('pnl amount = quantity × (exit − entry)', () => {
    expect(tradePnlAmount(t({ quantity: 40, entry_price: 6364.5, exit_price: 6885 }))).toBeCloseTo(20820);
  });

  it('計算總報酬、回撤、勝率、獲利因子', () => {
    const fs = buildFactsheet({
      expert,
      trades: [
        t({ exit_date: '2026-05-10T00:00:00Z', quantity: 1000, entry_price: 100, exit_price: 200, pnl_percent: 100 }), // +100,000
        t({ exit_date: '2026-06-10T00:00:00Z', quantity: 1000, entry_price: 100, exit_price: 60, pnl_percent: -40 }),  // −40,000
        t({ status: 'open', exit_date: null, quantity: 40, entry_price: 6364.5, exit_price: null, current_price: 6885, pnl_percent: 8.18 }),
      ],
      range: 'inception',
      asOf: new Date('2026-08-05T00:00:00Z'),
    });
    expect(fs.metrics.realizedAmount).toBe(60_000);
    expect(fs.metrics.unrealizedAmount).toBeCloseTo(20_820);
    expect(fs.metrics.totalReturnPct).toBeCloseTo(8.08, 2);
    expect(fs.metrics.maxDrawdownPct).toBeCloseTo(4, 2); // peak 100k → 60k = 40k / 1M
    expect(fs.metrics.winRate).toBe(50);
    expect(fs.metrics.profitFactor).toBe(2.5);
    expect(fs.metrics.closedTrades).toBe(2);
    expect(fs.metrics.openTrades).toBe(1);
    expect(fs.monthly.map((x) => x.month)).toEqual(['2026/05', '2026/06']);
  });

  it('缺初始資金時報酬率與回撤為 null，不以 0 冒充', () => {
    const fs = buildFactsheet({
      expert: { ...expert, starting_capital: null },
      trades: [t({})],
      range: 'inception',
    });
    expect(fs.metrics.totalReturnPct).toBeNull();
    expect(fs.metrics.maxDrawdownPct).toBeNull();
    expect(fs.missing[0]).toContain('初始資金未設定');
  });

  it('無交易時所有品質指標為 null', () => {
    const fs = buildFactsheet({ expert, trades: [], range: 'inception' });
    expect(fs.metrics.winRate).toBeNull();
    expect(fs.metrics.profitFactor).toBeNull();
    expect(fs.metrics.avgPnlPct).toBeNull();
    expect(fs.metrics.avgHoldDays).toBeNull();
    expect(fs.equity).toHaveLength(0);
  });

  it('期間篩選只納入區間內的已結案交易', () => {
    const fs = buildFactsheet({
      expert,
      trades: [
        t({ exit_date: '2025-01-10T00:00:00Z' }),
        t({ exit_date: '2026-07-10T00:00:00Z' }),
      ],
      range: 'm3',
      asOf: new Date('2026-08-05T00:00:00Z'),
    });
    expect(fs.metrics.closedTrades).toBe(1);
  });

  it('歸因取前五名且正負分列', () => {
    const fs = buildFactsheet({
      expert,
      trades: [
        t({ instrument: 'A', quantity: 1, entry_price: 0, exit_price: 500 }),
        t({ instrument: 'B', quantity: 1, entry_price: 0, exit_price: -300, pnl_percent: -5 }),
      ],
      range: 'inception',
    });
    expect(fs.contributors[0].instrument).toBe('A');
    expect(fs.detractors[0].instrument).toBe('B');
  });

  it('永遠揭露未涵蓋項目（成本、基準、淨值序列、金流）', () => {
    const fs = buildFactsheet({ expert, trades: [t({})], range: 'inception' });
    expect(fs.missing.join()).toMatch(/手續費/);
    expect(fs.missing.join()).toMatch(/基準指數/);
    expect(fs.missing.join()).toMatch(/未含未實現部位的逐日評價/);
  });
});
