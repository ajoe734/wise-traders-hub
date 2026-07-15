import { describe, it, expect } from 'vitest';
import { fmtMoney, fmtDate, fmtDateTime } from '../utils';

const anyIn = (x: unknown) => x as any;
const NUM_JUNK: unknown[] = [null, undefined, NaN, Infinity, -Infinity, 'abc', {}, [], true];
const DATE_JUNK: unknown[] = [null, undefined, '', '   ', 'garbage', '2026-13-40', NaN, {}, [], true];

describe('_companyRevenue fmtMoney', () => {
  it.each(NUM_JUNK)('junk %p → 不吐 NaN/Infinity', (v) => {
    expect(() => fmtMoney(anyIn(v))).not.toThrow();
    expect(fmtMoney(anyIn(v))).not.toMatch(/NaN|Infinity|∞/);
  });
  it('null / NaN / Infinity → NT$0', () => {
    expect(fmtMoney(anyIn(null))).toBe('NT$0');
    expect(fmtMoney(anyIn(NaN))).toBe('NT$0');
    expect(fmtMoney(anyIn(Infinity))).toBe('NT$0');
  });
  it('正常', () => {
    expect(fmtMoney(1234567)).toBe('NT$1,234,567');
    expect(fmtMoney(-1000)).toBe('NT$-1,000');
    expect(fmtMoney(0)).toBe('NT$0');
  });
});

describe('_companyRevenue fmtDate', () => {
  it.each(DATE_JUNK)('junk %p → - 且不含 NaN', (v) => {
    expect(() => fmtDate(anyIn(v))).not.toThrow();
    expect(fmtDate(anyIn(v))).not.toMatch(/NaN|Invalid/);
  });
  it('null / garbage → -', () => {
    expect(fmtDate(null)).toBe('-');
    expect(fmtDate('garbage')).toBe('-');
  });
  it('正常', () => {
    expect(fmtDate('2026-01-05T00:00:00')).toBe('2026/01/05');
  });
});

describe('_companyRevenue fmtDateTime', () => {
  it.each(DATE_JUNK)('junk %p → - 且不含 NaN', (v) => {
    expect(() => fmtDateTime(anyIn(v))).not.toThrow();
    expect(fmtDateTime(anyIn(v))).not.toMatch(/NaN|Invalid/);
  });
  it('null / garbage → -', () => {
    expect(fmtDateTime(null)).toBe('-');
    expect(fmtDateTime('garbage')).toBe('-');
  });
  it('正常', () => {
    const d = new Date(2026, 0, 5, 9, 30);
    expect(fmtDateTime(d.toISOString())).toBe('2026/01/05 09:30');
  });
});
