import { describe, it, expect } from 'vitest';
import {
  formatTaipeiYMD,
  formatTaipeiYMDWithFallback,
  formatTaipeiYMDHM,
} from '@/checkup/utils/formatTaipeiDate';

describe('formatTaipeiYMD', () => {
  it('UTC 16:00 → 隔日台北（跨日）', () => {
    expect(formatTaipeiYMD('2026-06-03T16:30:00Z')).toBe('2026/06/04');
  });
  it('UTC 00:00 → 同日 08:00 台北', () => {
    expect(formatTaipeiYMD('2026-06-03T00:00:00Z')).toBe('2026/06/03');
  });
  it('跨月 UTC 16:00 → 下月台北', () => {
    expect(formatTaipeiYMD('2026-05-31T16:00:00Z')).toBe('2026/06/01');
  });
  it('跨年 UTC', () => {
    expect(formatTaipeiYMD('2026-12-31T16:00:00Z')).toBe('2027/01/01');
  });
  it('月初', () => {
    expect(formatTaipeiYMD('2026-06-01T05:00:00Z')).toBe('2026/06/01');
  });
  it('月底', () => {
    expect(formatTaipeiYMD('2026-06-30T05:00:00Z')).toBe('2026/06/30');
  });
  it('閏年 02/29', () => {
    expect(formatTaipeiYMD('2024-02-29T05:00:00Z')).toBe('2024/02/29');
  });
  it('null → 空', () => {
    expect(formatTaipeiYMD(null)).toBe('');
  });
  it('undefined → 空', () => {
    expect(formatTaipeiYMD(undefined)).toBe('');
  });
  it('空字串 → 空', () => {
    expect(formatTaipeiYMD('')).toBe('');
  });
  it('not-a-date → 空', () => {
    expect(formatTaipeiYMD('not-a-date')).toBe('');
  });
  it('ISO 帶毫秒', () => {
    expect(formatTaipeiYMD('2026-06-03T05:30:45.123Z')).toBe('2026/06/03');
  });
  it('Date 物件', () => {
    expect(formatTaipeiYMD(new Date('2026-06-03T05:00:00Z'))).toBe('2026/06/03');
  });
});

describe('formatTaipeiYMDWithFallback', () => {
  it('有效 → YMD', () => {
    expect(formatTaipeiYMDWithFallback('2026-06-03T05:00:00Z')).toBe('2026/06/03');
  });
  it('null → fallback 預設「尚未紀錄」', () => {
    expect(formatTaipeiYMDWithFallback(null)).toBe('尚未紀錄');
  });
  it('invalid → fallback', () => {
    expect(formatTaipeiYMDWithFallback('garbage')).toBe('尚未紀錄');
  });
  it('自訂 fallback', () => {
    expect(formatTaipeiYMDWithFallback(null, '尚未使用')).toBe('尚未使用');
  });
});

describe('formatTaipeiYMDHM', () => {
  it('UTC 05:00 → 台北 13:00', () => {
    expect(formatTaipeiYMDHM('2026-06-03T05:00:00Z')).toBe('2026/06/03 13:00');
  });
  it('跨日 24h 制', () => {
    expect(formatTaipeiYMDHM('2026-06-03T16:30:00Z')).toBe('2026/06/04 00:30');
  });
  it('null → 空', () => {
    expect(formatTaipeiYMDHM(null)).toBe('');
  });
  it('invalid → 空', () => {
    expect(formatTaipeiYMDHM('xxx')).toBe('');
  });
});
