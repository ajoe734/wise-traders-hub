/**
 * 頁面讀取型接口只准讀資料庫：重新整理頁面、自動化巡檢都不得消耗 FinMind／證交所／櫃買額度。
 * 外部抓取只允許在排程函式（market-data-sync、valuation-ps-sync…）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseExchangeDaily, parseOfficialMonthRevenue, rocToIso, selectBackfillQueue,
} from '../../../supabase/functions/_shared/marketDataStore';

const READ_ENDPOINTS = [
  'supabase/functions/valuation-fundamentals/index.ts',
  'supabase/functions/checkup-sparkline/index.ts',
  'supabase/functions/_shared/marketDataStore.ts',
];
const FORBIDDEN = [/finmindtrade\.com/i, /twse\.com\.tw/i, /tpex\.org\.tw/i, /\bfetchWithRetry\b/, /\bfetchTwDailyOhlc\b/, /\bfetch\(/, /officialFilingIndex/];

describe('讀取型接口零外部請求', () => {
  for (const file of READ_ENDPOINTS) {
    it(`${file} 不含任何外部來源呼叫`, () => {
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const re of FORBIDDEN) expect(src, `${file} 出現 ${re}`).not.toMatch(re);
    });
  }
  it('估值接口缺資料回 DATA_PENDING 並登記回補，不畫假站牌', () => {
    const src = readFileSync(READ_ENDPOINTS[0], 'utf8');
    expect(src).toContain("code: 'DATA_PENDING'");
    expect(src).toMatch(/requestSymbols\(supa, \[symbol\]\)/);
  });
});

describe('marketDataStore 純函式', () => {
  it('民國日期轉 ISO', () => {
    expect(rocToIso('1151016')).toBe('2026-10-16');
    expect(rocToIso('2026-10-16')).toBeNull();
  });
  it('全市場日線取資料本身日期、排除無收盤與非法代碼', () => {
    const rows = parseExchangeDaily(
      [{ Date: '1151016', Code: '2330', OpeningPrice: '1,450.00', HighestPrice: '1460', LowestPrice: '1440', ClosingPrice: '1455', TradeVolume: '30000000' },
       { Date: '1151016', Code: '9999', ClosingPrice: '--' }],
      [{ Date: '1151015', SecuritiesCompanyCode: '6488', Open: '500', High: '510', Low: '495', Close: '505', TradingShares: '0' }],
    );
    expect(rows).toEqual([
      { symbol: '2330', trade_date: '2026-10-16', open: 1450, high: 1460, low: 1440, close: 1455, volume: 30000000, source: 'twse_stock_day_all' },
      { symbol: '6488', trade_date: '2026-10-15', open: 500, high: 510, low: 495, close: 505, volume: null, source: 'tpex_daily_close' },
    ]);
  });
  it('官方月營收千元換成元，拆當月／上月／去年同月；一月的上月是去年十二月', () => {
    const rows = parseOfficialMonthRevenue([{ '資料年月': '11501', '公司代號': '1101', '營業收入-當月營收': '100', '營業收入-上月營收': '90', '營業收入-去年當月營收': '80' }], 's');
    expect(rows).toEqual([
      { symbol: '1101', revenue_year: 2026, revenue_month: 1, revenue: 100000, source: 's' },
      { symbol: '1101', revenue_year: 2025, revenue_month: 12, revenue: 90000, source: 's' },
      { symbol: '1101', revenue_year: 2025, revenue_month: 1, revenue: 80000, source: 's' },
    ]);
  });
  it('回補佇列：排除 ready、最久未嘗試優先、代碼穩定排序', () => {
    expect(selectBackfillQueue([
      { symbol: '3', state: 'pending', last_attempt_at: null },
      { symbol: '1', state: 'ready', last_attempt_at: null },
      { symbol: '2', state: 'failed', last_attempt_at: '2026-10-01' },
      { symbol: '4', state: 'pending', last_attempt_at: null },
    ], 2)).toEqual(['3', '4']);
  });
});
