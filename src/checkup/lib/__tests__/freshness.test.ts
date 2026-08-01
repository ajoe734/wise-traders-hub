import { describe, it, expect } from 'vitest';
import { formatAge, formatClock, tickIntervalFor, DEFAULT_TTL_MS } from '../freshness';

describe('freshness 單一資料源', () => {
  it('相對時間門檻一致', () => {
    expect(formatAge(0)).toBe('剛剛更新');
    expect(formatAge(44_000)).toBe('剛剛更新');
    expect(formatAge(50_000)).toBe('50 秒前');
    expect(formatAge(60_000)).toBe('1 分鐘前');
    expect(formatAge(59 * 60_000)).toBe('59 分鐘前');
    expect(formatAge(60 * 60_000)).toBe('1 小時前');
    expect(formatAge(25 * 3_600_000)).toBe('1 天前');
  });

  it('無時間戳回傳破折號，不假裝新鮮', () => {
    expect(formatAge(null)).toBe('—');
    expect(formatAge(undefined)).toBe('—');
    expect(formatClock(null)).toBe('');
  });

  it('負值 clamp 成 0，不會出現未來時間', () => {
    expect(formatAge(-5000)).toBe('剛剛更新');
  });

  it('tick 節奏：一分鐘內較密，之後放慢', () => {
    expect(tickIntervalFor(10_000)).toBe(5_000);
    expect(tickIntervalFor(120_000)).toBe(30_000);
    expect(DEFAULT_TTL_MS).toBe(5 * 60 * 1000);
  });
});
