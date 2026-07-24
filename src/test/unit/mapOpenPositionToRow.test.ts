/**
 * Phase B 契約鎖：mapOpenPositionToRow 必須把 base `quantity_shares` 依 asset_class
 * 換算成正確的顯示數字＋單位；不得因 `quantity_unit='張'` 而印成「1000 張」。
 *
 * 對應災難案例（4576 / 2356）：
 *   trade_records.quantity=1000, quantity_unit='張', asset_class='tw_stock'
 *   → 舊實作 → PerfRow { quantity:1000, quantity_unit:'張' } → UI 顯示「1000 張」（×1000 錯）
 *   → 新契約 → PerfRow { quantity:1, quantity_unit:'張', base_quantity:1000 } → UI 顯示「1 張」
 */
import { describe, it, expect } from 'vitest';
import { mapOpenPositionToRow } from '@/hooks/useExpertHoldingsBundle';

describe('mapOpenPositionToRow — base → display quantity 契約', () => {
  it('台股 1000 base 股 + 張 → 顯示 1 張', () => {
    const row = mapOpenPositionToRow({
      symbol: '4576',
      instrument: '4576 大銀微系統',
      quantity_shares: 1000,
      quantity_unit: '張',
      asset_class: 'tw_stock',
      entry_price: 200,
      current_price: 210,
      unrealized_pnl: 10000,
      unrealized_pct: 5,
    });
    expect(row.quantity).toBe(1);
    expect(row.quantity_unit).toBe('張');
    expect(row.base_quantity).toBe(1000);
  });

  it('台股 500 base 股 + 張（零股）→ fallback 成 500 股，不寫回 fractional 張', () => {
    const row = mapOpenPositionToRow({
      symbol: '2330',
      instrument: '2330 台積電',
      quantity_shares: 500,
      quantity_unit: '張',
      asset_class: 'tw_stock',
      entry_price: 1000,
      current_price: 1050,
    });
    expect(row.quantity).toBe(500);
    expect(row.quantity_unit).toBe('股');
    expect(row.base_quantity).toBe(500);
  });

  it('美股 10 base + 股 → 顯示 10 股（不走台股 ×1000）', () => {
    const row = mapOpenPositionToRow({
      symbol: 'AAPL',
      instrument: 'AAPL Apple',
      quantity_shares: 10,
      quantity_unit: '股',
      asset_class: 'us_stock',
      entry_price: 200,
      current_price: 210,
    }, 'USD', 'us_stock');
    expect(row.quantity).toBe(10);
    expect(row.quantity_unit).toBe('股');
    expect(row.base_quantity).toBe(10);
  });

  it('美期 2 base + 口 → 顯示 2 口', () => {
    const row = mapOpenPositionToRow({
      symbol: '/ES',
      instrument: '/ES E-mini S&P 500',
      quantity_shares: 2,
      quantity_unit: '口',
      asset_class: 'us_future',
      entry_price: 5000,
      current_price: 5020,
    }, 'USD', 'us_future');
    expect(row.quantity).toBe(2);
    expect(row.quantity_unit).toBe('口');
    expect(row.base_quantity).toBe(2);
  });

  it('pnl 以 base_quantity 計算，不受顯示單位影響', () => {
    const row = mapOpenPositionToRow({
      symbol: '2330',
      instrument: '2330 台積電',
      quantity_shares: 1000,
      quantity_unit: '張',
      asset_class: 'tw_stock',
      entry_price: 1000,
      current_price: 1050,
      // 故意不給 unrealized_pnl，強制走 fallback 計算：(1050-1000)*1000 = 50000
    });
    expect(row.pnl).toBe(50000);
    expect(row.pnl_percent).toBe(5);
  });

  it('quantity_unit 缺值 + tw_stock 1000 base → 走 asset 預設 → 顯示 1 張', () => {
    const row = mapOpenPositionToRow({
      symbol: '2330',
      instrument: '2330 台積電',
      quantity_shares: 1000,
      quantity_unit: null,
      asset_class: 'tw_stock',
      entry_price: 1000,
      current_price: 1050,
    });
    expect(row.quantity).toBe(1);
    expect(row.quantity_unit).toBe('張');
    expect(row.base_quantity).toBe(1000);
  });
});
