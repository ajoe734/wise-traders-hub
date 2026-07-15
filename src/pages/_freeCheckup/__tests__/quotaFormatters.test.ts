import { describe, it, expect } from 'vitest';
import { fmtN, formatResetCountdown, formatResetDateTime } from '../constants.jsx';

const anyIn = (x: unknown) => x as any;

const NUMERIC_JUNK: unknown[] = [
  null, undefined, NaN, Infinity, -Infinity,
  '', '   ', 'abc', '12.5abc', true, false, {}, [], '一二三',
];

describe('fmtN', () => {
  it.each(NUMERIC_JUNK)('junk %p → 不丟且不吐 NaN/Infinity', (v) => {
    expect(() => fmtN(anyIn(v))).not.toThrow();
    expect(fmtN(anyIn(v))).not.toMatch(/NaN|Infinity|∞/);
  });
  it('null / NaN / Infinity → —', () => {
    expect(fmtN(null)).toBe('—');
    expect(fmtN(undefined)).toBe('—');
    expect(fmtN(NaN)).toBe('—');
    expect(fmtN(Infinity)).toBe('—');
    expect(fmtN(-Infinity)).toBe('—');
  });
  it('分支', () => {
    expect(fmtN(0)).toBe('0');
    expect(fmtN(9999)).toBe('9,999');
    expect(fmtN(10000)).toBe('1.0萬');
    expect(fmtN(-10000)).toBe('-1.0萬');
    expect(fmtN(1_000_000)).toBe('100.0萬');
  });
  it('字串數字也能吃', () => {
    expect(fmtN(anyIn('1234'))).toBe('1,234');
  });
});

describe('formatResetCountdown', () => {
  it.each([null, undefined, '', 'garbage', NaN])('junk %p → 空字串', (v) => {
    expect(formatResetCountdown(anyIn(v))).toBe('');
  });
  it('過去 → 即將重置', () => {
    expect(formatResetCountdown(new Date(Date.now() - 60000).toISOString())).toBe('即將重置');
  });
  it('分支', () => {
    const now = Date.now();
    const in10min = new Date(now + 10 * 60 * 1000).toISOString();
    expect(formatResetCountdown(in10min)).toMatch(/分鐘後重置$/);
    const in2h = new Date(now + 2.5 * 60 * 60 * 1000).toISOString();
    expect(formatResetCountdown(in2h)).toMatch(/小時 \d+ 分後重置$/);
    const in3d = new Date(now + 3.5 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatResetCountdown(in3d)).toMatch(/天 \d+ 小時後重置$/);
  });
});

describe('formatResetDateTime', () => {
  it.each([null, undefined, '', 'garbage', NaN])('junk %p → 空字串', (v) => {
    expect(formatResetDateTime(anyIn(v))).toBe('');
  });
  it('正常', () => {
    const d = new Date(2026, 0, 5, 9, 30);
    expect(formatResetDateTime(d.toISOString())).toBe('2026/01/05 09:30');
  });
});
