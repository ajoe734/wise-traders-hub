import { describe, it, expect } from 'vitest';
import { fmtDateTime, fmtPct } from '../format';

const anyIn = (x: unknown) => x as any;
const DATE_JUNK: unknown[] = [null, undefined, '', 'garbage', 'not-a-date', '2026-13-40', NaN, {}, [], true];
const NUM_JUNK: unknown[] = [null, undefined, NaN, Infinity, -Infinity, 'abc', '', {}, [], true];

describe('_backtestMonitor fmtDateTime', () => {
  it.each(DATE_JUNK)('junk %p → — 或格式化字串（不含 NaN）', (v) => {
    expect(() => fmtDateTime(anyIn(v))).not.toThrow();
    expect(fmtDateTime(anyIn(v))).not.toMatch(/NaN|Invalid/);
  });
  it('null → —', () => {
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDateTime('garbage')).toBe('—');
  });
  it('正常', () => {
    const d = new Date(2026, 0, 5, 9, 30);
    expect(fmtDateTime(d.toISOString())).toBe('2026/01/05 09:30');
  });
});

describe('_backtestMonitor fmtPct', () => {
  it.each(NUM_JUNK)('junk %p → 不吐 NaN', (v) => {
    expect(() => fmtPct(anyIn(v))).not.toThrow();
    expect(fmtPct(anyIn(v))).not.toMatch(/NaN|Infinity/);
  });
  it('null / NaN / Infinity → —', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(NaN)).toBe('—');
    expect(fmtPct(Infinity)).toBe('—');
    expect(fmtPct(-Infinity)).toBe('—');
  });
  it('正常', () => {
    expect(fmtPct(0)).toBe('0.0%');
    expect(fmtPct(0.1234)).toBe('12.3%');
    expect(fmtPct(-0.5)).toBe('-50.0%');
  });
});
