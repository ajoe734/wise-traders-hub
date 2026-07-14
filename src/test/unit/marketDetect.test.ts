/**
 * 市場判別 + 美股交易日 helper 回歸測試
 *
 * 對應 supabase/functions/_shared/marketDetect.ts —— 該模組被
 * stock-price-sync / daily-snapshot / daily-performance / publish-weekly-journals
 * edge function 共用。任何規則變動須同步更新兩邊，並通過此測試。
 */
import { describe, it, expect } from 'vitest';
import {
  detectMarket,
  currencyOf,
  extractSymbol,
  nyTradeDate,
} from '../../../supabase/functions/_shared/marketDetect';

describe('detectMarket', () => {
  it('4-6 碼純數字（含 ETF）判為 TW', () => {
    expect(detectMarket('2330 台積電')).toBe('TW');
    expect(detectMarket('00878 國泰永續高股息')).toBe('TW');
    expect(detectMarket('006208')).toBe('TW');
    expect(detectMarket('1101')).toBe('TW');
  });

  it('尾綴單字母（盤後零股 / 特殊）仍判為 TW', () => {
    expect(detectMarket('2330R')).toBe('TW');
  });

  it('英文字母開頭判為 US（含 . / -）', () => {
    expect(detectMarket('AAPL Apple Inc.')).toBe('US');
    expect(detectMarket('NVDA')).toBe('US');
    expect(detectMarket('BRK.B')).toBe('US');
    expect(detectMarket('BRK-B')).toBe('US');
    expect(detectMarket('GOOG Alphabet')).toBe('US');
  });

  it('空值 / 無法判別 → TW 保底', () => {
    expect(detectMarket(null)).toBe('TW');
    expect(detectMarket('')).toBe('TW');
    expect(detectMarket('   ')).toBe('TW');
    expect(detectMarket('!@#$')).toBe('TW');
  });
});

describe('currencyOf', () => {
  it('US → USD，TW → TWD', () => {
    expect(currencyOf('US')).toBe('USD');
    expect(currencyOf('TW')).toBe('TWD');
  });
});

describe('extractSymbol', () => {
  it('取空白前第一段', () => {
    expect(extractSymbol('2330 台積電')).toBe('2330');
    expect(extractSymbol('AAPL Apple Inc.')).toBe('AAPL');
    expect(extractSymbol('GOOG')).toBe('GOOG');
    expect(extractSymbol('')).toBe('');
  });
});

describe('nyTradeDate', () => {
  it('美東平日 09:30 → 當日曆日', () => {
    // 2026-06-15 (Mon) 13:30Z = 09:30 ET (EDT)
    const d = new Date('2026-06-15T13:30:00Z');
    expect(nyTradeDate(d)).toBe('2026-06-15');
  });

  it('美東平日 03:00 → 前一天', () => {
    // 2026-06-15 (Mon) 03:00Z = 2026-06-14 23:00 ET (Sun)
    // 週日 → 回推到 Fri 2026-06-12
    const d = new Date('2026-06-15T03:00:00Z');
    expect(nyTradeDate(d)).toBe('2026-06-12');
  });

  it('美東週六 → 回推到週五', () => {
    // 2026-06-13 (Sat) 15:00Z = 11:00 ET
    const d = new Date('2026-06-13T15:00:00Z');
    expect(nyTradeDate(d)).toBe('2026-06-12');
  });

  it('美東週日 → 回推到週五', () => {
    const d = new Date('2026-06-14T15:00:00Z');
    expect(nyTradeDate(d)).toBe('2026-06-12');
  });

  it('DST 切換：3 月第二個週日之後採 EDT (UTC-4)', () => {
    // 2026-03-09 (Mon) 13:30Z = 09:30 EDT
    const d = new Date('2026-03-09T13:30:00Z');
    expect(nyTradeDate(d)).toBe('2026-03-09');
  });

  it('DST 切換：11 月第一個週日之後採 EST (UTC-5)', () => {
    // 2026-11-02 (Mon) 14:30Z = 09:30 EST
    const d = new Date('2026-11-02T14:30:00Z');
    expect(nyTradeDate(d)).toBe('2026-11-02');
  });
});
