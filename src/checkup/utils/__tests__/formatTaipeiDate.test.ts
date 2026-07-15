import { describe, it, expect } from 'vitest';
import {
  formatTaipeiYMD,
  formatTaipeiYMDWithFallback,
  formatTaipeiYMDHM,
  formatTaipeiYMDHMWithFallback,
  taipeiMonthStartIso,
} from '../formatTaipeiDate';

const anyIn = (x: unknown) => x as any;
const JUNK: unknown[] = [
  null, undefined, '', '   ', 'garbage', 'not-a-date', NaN, {}, [], true, false,
  '2026-13-40', '2026/02/30',
];

describe('formatTaipeiYMD', () => {
  it.each(JUNK)('junk %p → 空字串或合法 YMD，不含 NaN', (v) => {
    expect(() => formatTaipeiYMD(anyIn(v))).not.toThrow();
    const out = formatTaipeiYMD(anyIn(v));
    expect(out === '' || /^\d{4}\/\d{2}\/\d{2}$/.test(out)).toBe(true);
    expect(out).not.toMatch(/NaN|Invalid/);
  });
  it('正常 ISO', () => {
    expect(formatTaipeiYMD('2026-01-05T00:00:00Z')).toBe('2026/01/05');
  });
  it('Taipei 跨日：UTC 15:00 → 隔日', () => {
    // 2026-01-01T15:00:00Z = TW 2026/01/01 23:00 → 同日
    expect(formatTaipeiYMD('2026-01-01T15:00:00Z')).toBe('2026/01/01');
    // 2026-01-01T16:01:00Z = TW 2026/01/02 00:01 → 隔日
    expect(formatTaipeiYMD('2026-01-01T16:01:00Z')).toBe('2026/01/02');
  });
  it('極端 timestamp', () => {
    expect(() => formatTaipeiYMD(new Date(8.64e15))).not.toThrow();
    expect(formatTaipeiYMD(new Date(NaN))).toBe('');
    // overflow
    expect(formatTaipeiYMD(new Date(8.64e15 + 1))).toBe('');
  });
  it('Date 實例', () => {
    expect(formatTaipeiYMD(new Date('2026-06-15T00:00:00Z'))).toMatch(/^2026\/06\/1[45]$/);
  });
});

describe('formatTaipeiYMDWithFallback', () => {
  it('fallback', () => {
    expect(formatTaipeiYMDWithFallback(null)).toBe('尚未紀錄');
    expect(formatTaipeiYMDWithFallback('garbage', '無')).toBe('無');
    expect(formatTaipeiYMDWithFallback('2026-01-05T00:00:00Z', '無')).toBe('2026/01/05');
  });
});

describe('formatTaipeiYMDHM', () => {
  it.each(JUNK)('junk %p → 空字串且不丟例外', (v) => {
    expect(() => formatTaipeiYMDHM(anyIn(v))).not.toThrow();
    expect(formatTaipeiYMDHM(anyIn(v))).not.toMatch(/NaN|Invalid/);
  });
  it('正常', () => {
    const out = formatTaipeiYMDHM('2026-01-01T16:01:00Z');
    expect(out).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(out).toBe('2026/01/02 00:01');
  });
});

describe('formatTaipeiYMDHMWithFallback', () => {
  it('fallback', () => {
    expect(formatTaipeiYMDHMWithFallback(null)).toBe('尚未紀錄');
    expect(formatTaipeiYMDHMWithFallback('nope', '—')).toBe('—');
  });
});

describe('taipeiMonthStartIso', () => {
  it('格式', () => {
    const out = taipeiMonthStartIso(new Date('2026-07-15T09:00:00Z'));
    expect(out).toMatch(/^\d{4}-\d{2}-01T00:00:00\+08:00$/);
  });
  it('不丟例外', () => {
    expect(() => taipeiMonthStartIso(new Date(NaN))).not.toThrow();
  });
});
