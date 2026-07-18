import { describe, it, expect } from 'vitest';
import { parseInstrument, formatInstrument, extractInstrumentCode } from '../instrument';

describe('parseInstrument', () => {
  it('TW ETF 字尾（L/R/B）保留完整代號', () => {
    expect(parseInstrument('00631L 元大台灣50正2')).toEqual({ code: '00631L', name: '元大台灣50正2' });
    expect(parseInstrument('00878B 國泰永續高股息')).toEqual({ code: '00878B', name: '國泰永續高股息' });
    expect(parseInstrument('00664R 富邦臺灣加權反1')).toEqual({ code: '00664R', name: '富邦臺灣加權反1' });
    expect(parseInstrument('00679B 元大美債20年')).toEqual({ code: '00679B', name: '元大美債20年' });
  });
  it('純代號無名稱', () => {
    expect(parseInstrument('00631L')).toEqual({ code: '00631L', name: '' });
    expect(parseInstrument('2330')).toEqual({ code: '2330', name: '' });
  });
  it('台股 4-6 位純數字', () => {
    expect(parseInstrument('2330 台積電')).toEqual({ code: '2330', name: '台積電' });
    expect(parseInstrument('006208 富邦台50')).toEqual({ code: '006208', name: '富邦台50' });
  });
  it('美股', () => {
    expect(parseInstrument('AAPL Apple Inc.')).toEqual({ code: 'AAPL', name: 'Apple Inc.' });
    expect(parseInstrument('BRK.B Berkshire B')).toEqual({ code: 'BRK.B', name: 'Berkshire B' });
    expect(parseInstrument('A')).toEqual({ code: 'A', name: '' });
  });
  it('多個空白 tolerant', () => {
    expect(parseInstrument('  00631L   元大台灣50正2  ')).toEqual({ code: '00631L', name: '元大台灣50正2' });
  });
  it('無法解析 → 全部當名稱', () => {
    expect(parseInstrument('中文開頭')).toEqual({ code: '', name: '中文開頭' });
    expect(parseInstrument('')).toEqual({ code: '', name: '' });
    expect(parseInstrument(null)).toEqual({ code: '', name: '' });
    expect(parseInstrument(undefined)).toEqual({ code: '', name: '' });
  });
  it('美股選擇權 OCC 21 字元', () => {
    expect(parseInstrument('AAPL240119C00150000 Apple Call 150')).toEqual({
      code: 'AAPL240119C00150000',
      name: 'Apple Call 150',
    });
    expect(parseInstrument('SPXW240119P04500000')).toEqual({
      code: 'SPXW240119P04500000',
      name: '',
    });
  });
  it('美股期貨 /XX', () => {
    expect(parseInstrument('/ES E-mini S&P')).toEqual({ code: '/ES', name: 'E-mini S&P' });
    expect(parseInstrument('/NQ')).toEqual({ code: '/NQ', name: '' });
    expect(parseInstrument('/CL 原油')).toEqual({ code: '/CL', name: '原油' });
    expect(parseInstrument('/ESZ5')).toEqual({ code: '/ESZ5', name: '' });
  });
});

describe('extractInstrumentCode', () => {
  it('保留 ETF 字尾', () => {
    expect(extractInstrumentCode('00631L 元大台灣50正2')).toBe('00631L');
    expect(extractInstrumentCode('00878B 國泰永續高股息')).toBe('00878B');
    expect(extractInstrumentCode('2330 台積電')).toBe('2330');
    expect(extractInstrumentCode('AAPL Apple')).toBe('AAPL');
    expect(extractInstrumentCode(null)).toBe('');
  });
});

describe('formatInstrument', () => {
  it('組合代號 + 名稱', () => {
    expect(formatInstrument('00631L 元大台灣50正2')).toBe('00631L 元大台灣50正2');
    expect(formatInstrument('00631L')).toBe('00631L');
    expect(formatInstrument('00631L', '元大台灣50正2')).toBe('00631L 元大台灣50正2');
  });
  it('name fallback 只在 instrument 沒名稱時生效', () => {
    expect(formatInstrument('2330 台積電', '別名')).toBe('2330 台積電');
  });
  it('空值', () => {
    expect(formatInstrument(null)).toBe('');
    expect(formatInstrument('')).toBe('');
  });
});
