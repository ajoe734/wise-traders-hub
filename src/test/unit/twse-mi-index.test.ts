import { describe, it, expect } from 'vitest';
import { parseTwseMiIndex } from '../../../supabase/functions/_shared/marketDataStore';

describe('證交所 MI_INDEX 當日收盤備援', () => {
  const payload = { tables: [
    { fields: ['指數', '收盤指數'], data: [['發行量加權股價指數', '23,000']] },
    { fields: ['證券代號', '證券名稱', '成交股數', '開盤價', '最高價', '最低價', '收盤價'], data: [
      ['2464', '盟立', '1,234,000', '175.00', '178.00', '174.50', '177.00'],
      ['067819', '權證', '0', '--', '--', '--', '--'],
      ['2492', '華新科', '2,000', '370.00', '373.00', '369.00', '372.50'],
    ] },
  ] };
  it('盟立 10/27 官方收盤 177、華新科 372.5，無成交權證不寫入', () => {
    const rows = parseTwseMiIndex(payload, '2026-10-27');
    expect(rows.map((r) => [r.symbol, r.close, r.trade_date])).toEqual([['2464', 177, '2026-10-27'], ['2492', 372.5, '2026-10-27']]);
    expect(rows[0].volume).toBe(1234000);
  });
});
