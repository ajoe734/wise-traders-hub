import { describe, it, expect } from 'vitest';
import {
  buildDailyCloseStatus,
  expectedTradeDate,
  sparklineCacheKey,
  taipeiDateKey,
} from '@/checkup/lib/marketDataStatus';

// 2026-08-03 是週一
const at = (iso: string) => new Date(iso);

const bar = (date: string, over: Partial<any> = {}) => ({
  date, open: 100, high: 105, low: 98, close: 103, volume: 12_000_000, ...over,
});

describe('expectedTradeDate（台北時區）', () => {
  it('平日收盤+結算緩衝後才算今天', () => {
    // 2026-08-03 13:00 台北 = 05:00Z（未結算）
    expect(expectedTradeDate(at('2026-08-03T05:00:00Z'))).toBe('2026-07-31');
    // 2026-08-03 14:10 台北 = 06:10Z（已結算）
    expect(expectedTradeDate(at('2026-08-03T06:10:00Z'))).toBe('2026-08-03');
  });

  it('週末往前回推到週五', () => {
    expect(expectedTradeDate(at('2026-08-08T10:00:00Z'))).toBe('2026-08-07');
    expect(expectedTradeDate(at('2026-08-09T10:00:00Z'))).toBe('2026-08-07');
  });

  it('週一盤前回推到上週五', () => {
    expect(expectedTradeDate(at('2026-08-03T00:30:00Z'))).toBe('2026-07-31');
  });

  it('taipeiDateKey 以台北日界為準', () => {
    expect(taipeiDateKey(at('2026-08-03T16:30:00Z'))).toBe('2026-08-04');
  });
});

describe('buildDailyCloseStatus', () => {
  const now = at('2026-08-03T06:10:00Z'); // 台北 8/3 14:10，預期交易日 = 2026-08-03

  it('完整當日 OHLCV + 來源 → 已確認', () => {
    const st = buildDailyCloseStatus({
      bars: [bar('2026-07-31'), bar('2026-08-03')],
      source: 'twse',
      fetchedAt: '2026-08-03T06:05:00Z',
      now,
    });
    expect(st.isFinal).toBe(true);
    expect(st.tradeDate).toBe('2026-08-03');
    expect(st.source).toBe('TWSE');
    expect(st.text).toBe('日 K 收盤 已確認 · 2026/08/03 · TWSE');
    expect(st.pendingReason).toBeNull();
  });

  it('舊快取（交易日落後）→ 待來源確認並標示最後交易日', () => {
    const st = buildDailyCloseStatus({ bars: [bar('2026-07-31')], source: 'twse', now });
    expect(st.isFinal).toBe(false);
    expect(st.pendingReason).toBe('stale_trade_date');
    expect(st.text).toBe('日 K 收盤 待來源確認 · 最後交易日 2026/07/31 · TWSE');
  });

  it('缺量（合成或不完整）→ 不得標記已確認', () => {
    const st = buildDailyCloseStatus({
      bars: [bar('2026-08-03', { volume: null })], source: 'twse', now,
    });
    expect(st.isFinal).toBe(false);
    expect(st.pendingReason).toBe('incomplete_ohlcv');
  });

  it('沒有來源 → 不得標記已確認', () => {
    const st = buildDailyCloseStatus({ bars: [bar('2026-08-03')], source: null, now });
    expect(st.isFinal).toBe(false);
    expect(st.pendingReason).toBe('no_source');
  });

  it('沒有日 K → no_bars', () => {
    const st = buildDailyCloseStatus({ bars: [], source: 'twse', now });
    expect(st.isFinal).toBe(false);
    expect(st.pendingReason).toBe('no_bars');
    expect(st.tradeDate).toBeNull();
  });

  it('盤中 quote 的抓取時間不影響 finalized 判定', () => {
    const st = buildDailyCloseStatus({
      bars: [bar('2026-07-31')],
      source: 'twse',
      fetchedAt: '2026-08-03T11:20:00Z', // 台北 19:20 的 polling
      now,
    });
    expect(st.isFinal).toBe(false);
    expect(st.fetchedAt).toBe('2026-08-03T11:20:00Z');
  });
});

describe('sparklineCacheKey', () => {
  const now = at('2026-08-03T06:10:00Z');
  it('含 market + symbol + tradeDate，切換標的不互相汙染', () => {
    expect(sparklineCacheKey('3443', now)).toBe('TW:3443:2026-08-03');
    expect(sparklineCacheKey('3017', now)).toBe('TW:3017:2026-08-03');
  });
  it('換交易日即自然失效', () => {
    expect(sparklineCacheKey('3443', at('2026-08-04T06:10:00Z'))).toBe('TW:3443:2026-08-04');
  });
});
