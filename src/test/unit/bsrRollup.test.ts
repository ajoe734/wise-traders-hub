// Unit tests for _shared/bsrRollup.ts + tradingDate.ts (raw fallback 完整性 / weekday lag).
import { describe, expect, it } from 'vitest';
import {
  computeBsrWindow,
  countRowsByDate,
  pickCompleteFallbackDate,
  pickWindowDates,
  nameOrFallback,
} from '../../../supabase/functions/_shared/bsrRollup.ts';
import {
  expectedLatestBsrDate,
  weekdayDiff,
  rollBackToWeekday,
} from '../../../supabase/functions/_shared/tradingDate.ts';

const row = (
  trade_date: string,
  broker_id: string,
  buy: number,
  sell: number,
  name = '',
) => ({
  trade_date,
  broker_id,
  broker_name: name,
  buy_shares: buy,
  sell_shares: sell,
  net_shares: buy - sell,
});

describe('bsrRollup.computeBsrWindow', () => {
  it('依 dates 過濾並算出 top_buy / top_sell / concentration', () => {
    const rows = [
      row('2026-07-22', 'A', 1000, 200, '元大'),
      row('2026-07-22', 'B', 300, 900, '凱基'),
      row('2026-07-22', 'C', 400, 500, '富邦'),
      row('2026-07-21', 'A', 500, 100, '元大'),
      row('2026-07-20', 'A', 100, 100, '元大'), // 不在 window 內
    ];
    const w = computeBsrWindow(rows, ['2026-07-22', '2026-07-21']);
    expect(w).not.toBeNull();
    expect(w!.days_covered).toBe(2);
    expect(w!.top_buy[0]).toMatchObject({ broker_id: 'A', name: '元大' });
    expect(w!.top_sell[0]).toMatchObject({ broker_id: 'B' });
    expect(w!.concentration_ratio).toBeGreaterThan(0);
    expect(w!.concentration_ratio).toBeLessThanOrEqual(100);
  });

  it('無 rows 回 null', () => {
    expect(computeBsrWindow([], ['2026-07-22'])).toBeNull();
    expect(computeBsrWindow([row('2026-07-01', 'A', 10, 5)], ['2026-07-22'])).toBeNull();
  });

  it('broker name 缺失時使用 fallback', () => {
    const w = computeBsrWindow([row('2026-07-22', 'X99', 100, 50)], ['2026-07-22']);
    expect(w!.top_buy[0].name).toBe('券商分點 X99');
  });
});

describe('bsrRollup.pickCompleteFallbackDate', () => {
  const c = (date: string, rowCount: number) => ({ date, rowCount });
  it('挑最新且 rowCount >= 5 的日期', () => {
    const picked = pickCompleteFallbackDate(
      [c('2026-07-22', 2), c('2026-07-21', 8), c('2026-07-18', 6)],
      new Set(),
    );
    expect(picked).toBe('2026-07-21');
  });
  it('doneDateSet 中的日期即使 rowCount 少也視為 complete', () => {
    const picked = pickCompleteFallbackDate(
      [c('2026-07-22', 1)],
      new Set(['2026-07-22']),
    );
    expect(picked).toBe('2026-07-22');
  });
  it('今日 partial data (< 5) 且不在 done set → 不會被推為 fallback', () => {
    const picked = pickCompleteFallbackDate(
      [c('2026-07-22', 3), c('2026-07-21', 12)],
      new Set(),
    );
    expect(picked).toBe('2026-07-21');
  });
  it('全都不 complete → null', () => {
    expect(pickCompleteFallbackDate([c('2026-07-22', 1)], new Set())).toBeNull();
    expect(pickCompleteFallbackDate([], new Set())).toBeNull();
  });
});

describe('bsrRollup helpers', () => {
  it('countRowsByDate', () => {
    const m = countRowsByDate([row('a', '1', 1, 1), row('a', '2', 1, 1), row('b', '1', 1, 1)] as any);
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBe(1);
  });
  it('pickWindowDates', () => {
    expect(pickWindowDates(['d3', 'd2', 'd1'], 2)).toEqual(['d3', 'd2']);
  });
  it('nameOrFallback', () => {
    expect(nameOrFallback('123', '  ')).toBe('券商分點 123');
    expect(nameOrFallback('123', '元大')).toBe('元大');
  });
});

describe('tradingDate.expectedLatestBsrDate', () => {
  const at = (iso: string) => Date.parse(iso);
  it('週一 13:00 TPE → 上週五', () => {
    // 2026-07-20 週一 05:00Z = 13:00 TPE
    expect(expectedLatestBsrDate(at('2026-07-20T05:00:00Z'))).toBe('2026-07-17');
  });
  it('週一 14:00 TPE 收盤後 → 當日', () => {
    // 2026-07-20 週一 06:00Z = 14:00 TPE
    expect(expectedLatestBsrDate(at('2026-07-20T06:00:00Z'))).toBe('2026-07-20');
  });
  it('週日 → roll back 到週五', () => {
    expect(expectedLatestBsrDate(at('2026-07-19T06:00:00Z'))).toBe('2026-07-17');
  });
});

describe('tradingDate.weekdayDiff', () => {
  it('同日為 0；順序無關', () => {
    expect(weekdayDiff('2026-07-22', '2026-07-22')).toBe(0);
    expect(weekdayDiff('2026-07-22', '2026-07-20')).toBe(weekdayDiff('2026-07-20', '2026-07-22'));
  });
  it('跨週末不算週六日', () => {
    // 週五 -> 下週一 = 1 個 weekday
    expect(weekdayDiff('2026-07-17', '2026-07-20')).toBe(1);
    // 週三 -> 下週三 = 5
    expect(weekdayDiff('2026-07-15', '2026-07-22')).toBe(5);
  });
});

describe('tradingDate.rollBackToWeekday', () => {
  it('週六 → 週五', () => {
    expect(rollBackToWeekday('2026-07-18')).toBe('2026-07-17');
  });
  it('週日 → 週五', () => {
    expect(rollBackToWeekday('2026-07-19')).toBe('2026-07-17');
  });
  it('週一 → 週一', () => {
    expect(rollBackToWeekday('2026-07-20')).toBe('2026-07-20');
  });
});
