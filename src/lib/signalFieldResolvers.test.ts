import { describe, it, expect } from 'vitest';
import {
  resolveInstrument,
  resolveNumeric,
  safeMultiply,
  INSTRUMENT_MARKET_LABEL,
  INSTRUMENT_SOURCE_LABEL,
  NUMERIC_SOURCE_LABEL,
} from './signalFieldResolvers';

describe('resolveInstrument', () => {
  it('完整 TW 股票（含名稱）→ parsed / tw-stock', () => {
    const r = resolveInstrument('2330 台積電');
    expect(r).toMatchObject({ code: '2330', name: '台積電', market: 'tw-stock', source: 'parsed', display: '2330 台積電' });
  });

  it('ETF 字尾 L 不被截掉', () => {
    const r = resolveInstrument('00631L 元大台灣50正2');
    expect(r.code).toBe('00631L');
    expect(r.market).toBe('tw-stock');
  });

  it('美股 → us-stock', () => {
    expect(resolveInstrument('AAPL Apple Inc.').market).toBe('us-stock');
    expect(resolveInstrument('BRK.B Berkshire').code).toBe('BRK.B');
  });

  it('美股選擇權 → us-option（不會被 us-stock 吃掉）', () => {
    const r = resolveInstrument('AAPL240119C00150000 Apple C150');
    expect(r.code).toBe('AAPL240119C00150000');
    expect(r.market).toBe('us-option');
  });

  it('美股期貨 → us-future', () => {
    expect(resolveInstrument('/ES E-mini S&P').market).toBe('us-future');
  });

  it('僅代號 → code-only', () => {
    const r = resolveInstrument('2330');
    expect(r.source).toBe('code-only');
    expect(r.name).toBe('');
    expect(r.display).toBe('2330');
  });

  it('無代號中文名 → name-only', () => {
    const r = resolveInstrument('中文商品名');
    expect(r.source).toBe('name-only');
    expect(r.market).toBe('unknown');
    expect(r.display).toBe('中文商品名');
  });

  it('null / undefined / 空字串 → missing 且 display "—"', () => {
    for (const raw of [null, undefined, '', '   ']) {
      const r = resolveInstrument(raw as any);
      expect(r.source).toBe('missing');
      expect(r.market).toBe('unknown');
      expect(r.display).toBe('—');
      expect(r.raw).toBe('');
    }
  });

  it('市場與來源標籤字典完整', () => {
    (['tw-stock', 'us-stock', 'us-option', 'us-future', 'unknown'] as const).forEach((k) => {
      expect(INSTRUMENT_MARKET_LABEL[k]).toBeTruthy();
    });
    (['parsed', 'code-only', 'name-only', 'raw-only', 'missing'] as const).forEach((k) => {
      expect(INSTRUMENT_SOURCE_LABEL[k]).toBeTruthy();
    });
  });
});

describe('resolveNumeric', () => {
  it('正常 number → explicit', () => {
    expect(resolveNumeric(123.45)).toEqual({ value: 123.45, source: 'explicit', rawType: 'number' });
  });

  it('數字字串 → coerced-string', () => {
    expect(resolveNumeric('88')).toMatchObject({ value: 88, source: 'coerced-string' });
    expect(resolveNumeric('  99.5  ')).toMatchObject({ value: 99.5, source: 'coerced-string' });
  });

  it('null / undefined / 空字串 / 全空白 → missing', () => {
    for (const raw of [null, undefined, '', '   ']) {
      expect(resolveNumeric(raw)).toMatchObject({ value: null, source: 'missing' });
    }
  });

  it('NaN / Infinity / 非數字字串 → invalid', () => {
    expect(resolveNumeric(NaN)).toMatchObject({ value: null, source: 'invalid' });
    expect(resolveNumeric(Infinity)).toMatchObject({ value: null, source: 'invalid' });
    expect(resolveNumeric('abc')).toMatchObject({ value: null, source: 'invalid' });
    expect(resolveNumeric('NaN')).toMatchObject({ value: null, source: 'invalid' });
  });

  it('物件 / 布林 → invalid', () => {
    expect(resolveNumeric({} as unknown)).toMatchObject({ value: null, source: 'invalid' });
    expect(resolveNumeric(true as unknown)).toMatchObject({ value: null, source: 'invalid' });
  });

  it('0：allowZero=true 通過，allowZero=false 視為 invalid', () => {
    expect(resolveNumeric(0, { allowZero: true })).toMatchObject({ value: 0, source: 'explicit' });
    expect(resolveNumeric(0, { allowZero: false })).toMatchObject({ value: null, source: 'invalid' });
  });

  it('負值：預設拒絕，allowNegative=true 通過', () => {
    expect(resolveNumeric(-5)).toMatchObject({ value: null, source: 'invalid' });
    expect(resolveNumeric(-5, { allowNegative: true })).toMatchObject({ value: -5, source: 'explicit' });
  });

  it('rawType 除錯欄位正確', () => {
    expect(resolveNumeric(null).rawType).toBe('null');
    expect(resolveNumeric(undefined).rawType).toBe('undefined');
    expect(resolveNumeric('1').rawType).toBe('string');
    expect(resolveNumeric(1).rawType).toBe('number');
  });

  it('來源標籤字典完整', () => {
    (['explicit', 'coerced-string', 'invalid', 'missing'] as const).forEach((k) => {
      expect(NUMERIC_SOURCE_LABEL[k]).toBeTruthy();
    });
  });
});

describe('safeMultiply', () => {
  it('任一為 null → null', () => {
    expect(safeMultiply(null, 10)).toBeNull();
    expect(safeMultiply(10, null)).toBeNull();
    expect(safeMultiply(null, null)).toBeNull();
  });

  it('正常相乘', () => {
    expect(safeMultiply(2, 3)).toBe(6);
    expect(safeMultiply(0, 5)).toBe(0);
  });

  it('結果非有限 → null', () => {
    expect(safeMultiply(Infinity, 1)).toBeNull();
    expect(safeMultiply(1e308, 1e308)).toBeNull();
  });
});
