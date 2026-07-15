import { describe, it, expect } from 'vitest';
import {
  normalizeCurrency,
  formatMoneyByCurrency,
  formatPriceByCurrency,
  isValidSymbol,
} from '../currency';

const anyIn = (x: unknown) => x as any;

const NUMERIC_JUNK: unknown[] = [
  null, undefined, NaN, Infinity, -Infinity,
  '', '   ', 'abc', '12.5abc', true, false, {}, [], '一二三',
];

describe('normalizeCurrency', () => {
  it.each([
    ['USD', 'USD'],
    ['usd', 'TWD'], // 只有嚴格 'USD' 判定
    ['TWD', 'TWD'],
    [null, 'TWD'],
    [undefined, 'TWD'],
    ['', 'TWD'],
    ['JPY', 'TWD'],
    [{}, 'TWD'],
    [123, 'TWD'],
  ])('%p → %s', (input, expected) => {
    expect(normalizeCurrency(input)).toBe(expected);
  });
});

describe('formatMoneyByCurrency', () => {
  it.each(NUMERIC_JUNK)('junk %p → 不丟例外', (v) => {
    expect(() => formatMoneyByCurrency(anyIn(v))).not.toThrow();
    expect(formatMoneyByCurrency(anyIn(v))).not.toMatch(/NaN|∞|Infinity/);
  });
  it('null / NaN / Infinity → —', () => {
    expect(formatMoneyByCurrency(null)).toBe('—');
    expect(formatMoneyByCurrency(undefined)).toBe('—');
    expect(formatMoneyByCurrency(NaN)).toBe('—');
    expect(formatMoneyByCurrency(Infinity)).toBe('—');
    expect(formatMoneyByCurrency(-Infinity)).toBe('—');
  });
  it('正常值 + 幣別 + 負值', () => {
    expect(formatMoneyByCurrency(0)).toBe('NT$0');
    expect(formatMoneyByCurrency(0, 'USD')).toBe('US$0');
    expect(formatMoneyByCurrency(1234567)).toBe('NT$1,234,567');
    expect(formatMoneyByCurrency(-1234)).toBe('-NT$1,234');
    expect(formatMoneyByCurrency(1000, 'USD')).toBe('US$1,000');
  });
  it('四捨五入', () => {
    expect(formatMoneyByCurrency(1.5)).toBe('NT$2');
    expect(formatMoneyByCurrency(-1.5)).toMatch(/^-NT\$[12]$/);
  });
  it('極大值不崩', () => {
    expect(() => formatMoneyByCurrency(Number.MAX_VALUE)).not.toThrow();
    // MAX_VALUE 是有限值但 round 後仍是巨大 finite
    expect(formatMoneyByCurrency(Number.MAX_VALUE)).toMatch(/^NT\$/);
  });
});

describe('formatPriceByCurrency', () => {
  it.each(NUMERIC_JUNK)('junk %p → 不丟例外且不吐 NaN', (v) => {
    expect(() => formatPriceByCurrency(anyIn(v))).not.toThrow();
    expect(formatPriceByCurrency(anyIn(v))).not.toMatch(/NaN|Infinity|∞/);
  });
  it('null / NaN / Infinity / 字串 → —', () => {
    expect(formatPriceByCurrency(null)).toBe('—');
    expect(formatPriceByCurrency(undefined)).toBe('—');
    expect(formatPriceByCurrency(NaN)).toBe('—');
    expect(formatPriceByCurrency(Infinity)).toBe('—');
    expect(formatPriceByCurrency(anyIn('abc'))).toBe('—');
  });
  it('digits', () => {
    expect(formatPriceByCurrency(1.2345)).toBe('1.23');
    expect(formatPriceByCurrency(1.2345, 'USD', 4)).toBe('1.2345');
    expect(formatPriceByCurrency(0)).toBe('0.00');
    expect(formatPriceByCurrency(-1.5)).toBe('-1.50');
  });
  it('極大 / 極小', () => {
    expect(() => formatPriceByCurrency(Number.MAX_VALUE)).not.toThrow();
    expect(formatPriceByCurrency(Number.MIN_VALUE)).toBe('0.00');
  });
});

describe('isValidSymbol', () => {
  it('TW 有效', () => {
    ['2330', '00631L', '006208', '2330 ', ' 2330', '2330b'].forEach((s) => {
      expect(isValidSymbol(s, 'TWD')).toBe(true);
    });
  });
  it('TW 無效', () => {
    ['', '  ', 'AAPL', '233', '1234567', '2330LL', '中文', '2330.B'].forEach((s) => {
      expect(isValidSymbol(s, 'TWD')).toBe(false);
    });
  });
  it('US 有效', () => {
    ['AAPL', 'A', 'BRK.B', 'tsla', 'AMZN'].forEach((s) => {
      expect(isValidSymbol(s, 'USD')).toBe(true);
    });
  });
  it('US 無效', () => {
    ['', '  ', '2330', 'AAPLE1', 'BRK.BB', '中文', 'AAAAAA'].forEach((s) => {
      expect(isValidSymbol(s, 'USD')).toBe(false);
    });
  });
  it('null-ish 不炸', () => {
    expect(isValidSymbol(anyIn(null), 'TWD')).toBe(false);
    expect(isValidSymbol(anyIn(undefined), 'USD')).toBe(false);
  });
});
