import { describe, it, expect } from 'vitest';
import {
  fmtSigned,
  fmtSignedInt,
  fmtWan,
  clampReturnBar,
  daysBetween,
  fmtDate,
  fmtMD,
  MINUS_SIGN,
} from '../checkupFormat';

const MINUS = MINUS_SIGN;
// TS 型別以外的 runtime 誤傳，用 any 傳入
const anyIn = (x: unknown) => x as any;

const NUMERIC_JUNK: unknown[] = [
  null,
  undefined,
  NaN,
  Number.NaN,
  Infinity,
  -Infinity,
  '',
  '   ',
  'abc',
  '12.5abc',
  true,
  false,
  {},
  [],
  '一二三',
];

describe('fmtSigned', () => {
  it.each(NUMERIC_JUNK)('junk %p → 不丟例外且回傳 sentinel', (v) => {
    expect(() => fmtSigned(anyIn(v))).not.toThrow();
    const out = fmtSigned(anyIn(v));
    expect(out).not.toMatch(/NaN|Infinity|∞/);
  });
  it('null / undefined / NaN / Infinity → —', () => {
    expect(fmtSigned(null)).toBe('—');
    expect(fmtSigned(undefined)).toBe('—');
    expect(fmtSigned(NaN)).toBe('—');
    expect(fmtSigned(Infinity)).toBe('—');
    expect(fmtSigned(-Infinity)).toBe('—');
  });
  it('正負零與正常值', () => {
    expect(fmtSigned(0)).toBe('0.00');
    expect(fmtSigned(-0)).toBe('0.00');
    expect(fmtSigned(1.5)).toBe('+1.50');
    expect(fmtSigned(-1.5)).toBe(`${MINUS}1.50`);
  });
  it('極大值不炸', () => {
    expect(() => fmtSigned(Number.MAX_VALUE)).not.toThrow();
    expect(fmtSigned(Number.MAX_VALUE)).toMatch(/^\+/);
    expect(fmtSigned(-Number.MAX_VALUE)).toMatch(new RegExp(`^${MINUS}`));
  });
  it('自訂 digits', () => {
    expect(fmtSigned(1.234567, 4)).toBe('+1.2346');
    expect(fmtSigned(1.005, 2)).toMatch(/^\+1\.0[01]$/);
  });
});

describe('fmtSignedInt', () => {
  it.each(NUMERIC_JUNK)('junk %p → 不丟例外且不吐 NaN/Infinity', (v) => {
    expect(() => fmtSignedInt(anyIn(v))).not.toThrow();
    const out = fmtSignedInt(anyIn(v));
    expect(out).not.toMatch(/NaN|Infinity|∞/);
  });
  it('sentinel', () => {
    expect(fmtSignedInt(null)).toBe('—');
    expect(fmtSignedInt(NaN)).toBe('—');
    expect(fmtSignedInt(Infinity)).toBe('—');
  });
  it('四捨五入 + 符號', () => {
    expect(fmtSignedInt(0)).toBe('0');
    expect(fmtSignedInt(1.4)).toBe('+1');
    expect(fmtSignedInt(-1.6)).toBe(`${MINUS}2`);
  });
});

describe('fmtWan', () => {
  it.each(NUMERIC_JUNK)('junk %p → 不丟例外且不吐 NaN/Infinity/∞', (v) => {
    expect(() => fmtWan(anyIn(v))).not.toThrow();
    expect(fmtWan(anyIn(v))).not.toMatch(/NaN|Infinity|∞/);
  });
  it('null / NaN / Infinity → —', () => {
    expect(fmtWan(null)).toBe('—');
    expect(fmtWan(undefined)).toBe('—');
    expect(fmtWan(NaN)).toBe('—');
    expect(fmtWan(Infinity)).toBe('—');
    expect(fmtWan(-Infinity)).toBe('—');
  });
  it('分支', () => {
    expect(fmtWan(0)).toBe('0');
    expect(fmtWan(9999)).toBe('9,999');
    expect(fmtWan(-9999)).toBe('-9,999');
    expect(fmtWan(10000)).toBe('1.0 萬');
    expect(fmtWan(1_000_000)).toBe('100 萬');
    expect(fmtWan(-1_000_000)).toBe('-100 萬');
  });
  it('極大值不炸', () => {
    expect(() => fmtWan(Number.MAX_VALUE)).not.toThrow();
    expect(fmtWan(Number.MAX_VALUE)).toContain('萬');
  });
});

describe('clampReturnBar', () => {
  it('null / NaN / 0 → sign 0', () => {
    expect(clampReturnBar(null as unknown as number)).toEqual({ ratio: 0, over: false, sign: 0 });
    expect(clampReturnBar(NaN)).toEqual({ ratio: 0, over: false, sign: 0 });
    expect(clampReturnBar(0)).toEqual({ ratio: 0, over: false, sign: 0 });
  });
  it('邊界 40 / -40 / over', () => {
    expect(clampReturnBar(40)).toEqual({ ratio: 1, over: false, sign: 1 });
    expect(clampReturnBar(-40)).toEqual({ ratio: 1, over: false, sign: -1 });
    expect(clampReturnBar(41)).toEqual({ ratio: 1, over: true, sign: 1 });
    expect(clampReturnBar(-41)).toEqual({ ratio: 1, over: true, sign: -1 });
  });
  it('Infinity → over', () => {
    const r = clampReturnBar(Infinity);
    expect(r.over).toBe(true);
    expect(r.sign).toBe(1);
    expect(r.ratio).toBe(1);
    const rn = clampReturnBar(-Infinity);
    expect(rn.sign).toBe(-1);
  });
  it('自訂 scale', () => {
    expect(clampReturnBar(10, 20)).toEqual({ ratio: 0.5, over: false, sign: 1 });
  });
});

describe('daysBetween', () => {
  it('invalid → 0', () => {
    expect(daysBetween('garbage', 'garbage')).toBe(0);
    expect(daysBetween('2026-01-01', 'nope')).toBe(0);
  });
  it('負向差 → 0', () => {
    expect(daysBetween('2026-06-01', '2026-05-01')).toBe(0);
  });
  it('正常差', () => {
    expect(daysBetween('2026-01-01T00:00:00Z', '2026-01-11T00:00:00Z')).toBe(10);
  });
});

describe('fmtDate / fmtMD', () => {
  const JUNK: unknown[] = [null, undefined, '', 'garbage', 'not-a-date', NaN, {}, [], '2026-13-40', '2026/02/30'];
  it.each(JUNK)('junk %p → — 或不含 NaN', (v) => {
    expect(() => fmtDate(anyIn(v))).not.toThrow();
    expect(() => fmtMD(anyIn(v))).not.toThrow();
    expect(fmtDate(anyIn(v))).not.toMatch(/NaN/);
    expect(fmtMD(anyIn(v))).not.toMatch(/NaN/);
  });
  it('正常', () => {
    expect(fmtDate('2026-01-05T00:00:00Z')).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    expect(fmtMD('2026-01-05T00:00:00Z')).toMatch(/^\d{2}\/\d{2}$/);
  });
  it('極端 timestamp', () => {
    expect(() => fmtDate(8.64e15)).not.toThrow();
    expect(() => fmtDate(8.64e15 + 1)).not.toThrow();
    expect(fmtDate(8.64e15 + 1)).toBe('—');
  });
});
