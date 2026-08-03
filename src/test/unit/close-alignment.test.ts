/**
 * 收盤對齊契約測試：2026/08/04 00:38（台北）尚未開市 → 一切收盤必須對齊 2026/08/03。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  latestCompletedTradeDate,
  isTradingDay,
  previousTradingDay,
  tradingDayLag,
  setMarketHolidays,
  resetMarketHolidays,
  holidaysLoaded,
} from '@/checkup/lib/marketCalendar';
import {
  buildConfirmedClose,
  confirmedCloseLabel,
  datasetCacheKey,
  toHoldingPriceIdentity,
} from '@/checkup/lib/confirmedClose';
import { summarizeCloseAlignment } from '@/checkup/lib/closeAlignment';

// 2026-08-03(一) 16:38 UTC = 2026-08-04 00:38 台北
const MIDNIGHT_0804 = new Date('2026-08-03T16:38:00Z');
// 2026-08-03 05:00 UTC = 13:00 台北（盤中，未結算）
const INTRADAY_0803 = new Date('2026-08-03T05:00:00Z');
// 2026-08-03 06:10 UTC = 14:10 台北（已過 14:05 結算緩衝）
const SETTLED_0803 = new Date('2026-08-03T06:10:00Z');

beforeEach(() => {
  resetMarketHolidays();
  setMarketHolidays(['2026-01-01'], 'TW');
});

describe('marketCalendar', () => {
  it('台北 8/4 午夜尚未開市 → 最後完整交易日 = 8/3', () => {
    expect(latestCompletedTradeDate(MIDNIGHT_0804)).toBe('2026-08-03');
  });

  it('8/3 盤中（13:00）尚未結算 → 回退 7/31', () => {
    expect(latestCompletedTradeDate(INTRADAY_0803)).toBe('2026-07-31');
  });

  it('8/3 14:10 已過結算緩衝 → 8/3', () => {
    expect(latestCompletedTradeDate(SETTLED_0803)).toBe('2026-08-03');
  });

  it('週末與休市日一律回退', () => {
    expect(isTradingDay('2026-08-01')).toBe(false); // 週六
    expect(isTradingDay('2026-01-01')).toBe(false); // 休市日
    expect(previousTradingDay('2026-08-03')).toBe('2026-07-31');
  });

  it('休市日納入回推：若 8/3 休市，8/4 午夜應對齊 7/31', () => {
    setMarketHolidays(['2026-08-03'], 'TW');
    expect(latestCompletedTradeDate(MIDNIGHT_0804)).toBe('2026-07-31');
  });

  it('tradingDayLag 以交易日計算落後天數', () => {
    expect(tradingDayLag('2026-08-03', '2026-07-31')).toBe(1);
    expect(tradingDayLag('2026-08-03', '2026-08-03')).toBe(0);
  });
});

const entry0803 = {
  source: 'twse_stock_day',
  fetchedAt: '2026-08-03T07:29:10.775Z',
  ohlc: [
    { date: '2026-07-31', open: 3805, high: 3805, low: 3805, close: 3805, volume: 750048 },
    { date: '2026-08-03', open: 4150, high: 4185, low: 4030, close: 4185, volume: 1306441 },
  ],
};

describe('confirmedClose', () => {
  it('對齊最後完整交易日且 OHLCV 完整 → confirmed', () => {
    const cc = buildConfirmedClose('3443', entry0803, { now: MIDNIGHT_0804 });
    expect(cc.state).toBe('confirmed');
    expect(cc.tradeDate).toBe('2026-08-03');
    expect(cc.close).toBe(4185);
    expect(cc.prevClose).toBe(3805);
    expect(confirmedCloseLabel(cc)).toContain('已確認');
  });

  it('上游只到 7/31 → pending 且說明落後幾個交易日', () => {
    const stale = { ...entry0803, ohlc: [entry0803.ohlc[0]] };
    const cc = buildConfirmedClose('3443', stale, { now: MIDNIGHT_0804 });
    expect(cc.state).toBe('pending');
    expect(cc.reason).toBe('stale_trade_date');
    expect(cc.lagTradingDays).toBe(1);
    expect(confirmedCloseLabel(cc)).toContain('待確認');
  });

  it('OHLC 缺漏（daily_price_snapshots 那種鏡像列）→ pending，不得當收盤', () => {
    const broken = {
      source: 'snapshot_mirror',
      ohlc: [{ date: '2026-08-03', close: 1620, volume: 8453 }],
    };
    const cc = buildConfirmedClose('6274', broken, { now: MIDNIGHT_0804 });
    expect(cc.state).toBe('pending');
    expect(cc.reason).toBe('incomplete_ohlcv');
    expect(toHoldingPriceIdentity(cc).price).toBeNull();
  });

  it('休市日表未載入 → 不謊報已確認', () => {
    resetMarketHolidays();
    expect(holidaysLoaded('TW')).toBe(false);
    const cc = buildConfirmedClose('3443', entry0803, { now: MIDNIGHT_0804 });
    expect(cc.state).toBe('pending');
    expect(cc.reason).toBe('holidays_unloaded');
  });

  it('confirmed → 持倉價格身分帶 tradeDate 與 official 來源', () => {
    const id = toHoldingPriceIdentity(buildConfirmedClose('3443', entry0803, { now: MIDNIGHT_0804 }));
    expect(id).toMatchObject({
      price: 4185, priceSource: 'official_close', priceTradeDate: '2026-08-03', priceState: 'confirmed',
    });
  });

  it('快取鍵含 market / dataset / tradeDate / schema 版本', () => {
    expect(datasetCacheKey('3443', 'daily_ohlc', MIDNIGHT_0804)).toBe('TW:3443:daily_ohlc:2026-08-03:v1');
  });
});

describe('closeAlignment', () => {
  it('全部對齊 8/3 → aligned', () => {
    const s = summarizeCloseAlignment(
      [{ code: '3443', priceTradeDate: '2026-08-03', priceState: 'confirmed' }],
      MIDNIGHT_0804,
    );
    expect(s.aligned).toBe(true);
    expect(s.label).toContain('2026/08/03');
  });

  it('有落後標的 → 顯示待確認數與其他交易日', () => {
    const s = summarizeCloseAlignment(
      [
        { code: '3443', priceTradeDate: '2026-08-03', priceState: 'confirmed' },
        { code: '6274', priceTradeDate: '2026-07-31', priceState: 'pending' },
      ],
      MIDNIGHT_0804,
    );
    expect(s.aligned).toBe(false);
    expect(s.pending).toBe(1);
    expect(s.otherDates).toEqual(['2026-07-31']);
    expect(s.label).toContain('1/2 待確認');
  });
});
