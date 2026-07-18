import { describe, it, expect } from 'vitest';
import {
  normalizeCurrency,
  inferCurrencyFromInstrument,
  resolveDisplayCurrency,
} from './currency';

describe('currency fallback helpers', () => {
  it('normalizeCurrency: 未知值 → TWD', () => {
    expect(normalizeCurrency(undefined)).toBe('TWD');
    expect(normalizeCurrency(null)).toBe('TWD');
    expect(normalizeCurrency('JPY')).toBe('TWD');
    expect(normalizeCurrency('USD')).toBe('USD');
    expect(normalizeCurrency('TWD')).toBe('TWD');
  });

  it('inferCurrencyFromInstrument: 台股代碼', () => {
    expect(inferCurrencyFromInstrument('2330 台積電')).toBe('TWD');
    expect(inferCurrencyFromInstrument('00631L 元大台灣50正2')).toBe('TWD');
    expect(inferCurrencyFromInstrument('006208')).toBe('TWD');
  });

  it('inferCurrencyFromInstrument: 美股代碼', () => {
    expect(inferCurrencyFromInstrument('AAPL Apple')).toBe('USD');
    expect(inferCurrencyFromInstrument('BRK.B Berkshire')).toBe('USD');
    expect(inferCurrencyFromInstrument('tsla')).toBe('USD');
  });

  it('inferCurrencyFromInstrument: 無法判定回 null', () => {
    expect(inferCurrencyFromInstrument('')).toBeNull();
    expect(inferCurrencyFromInstrument(null)).toBeNull();
    expect(inferCurrencyFromInstrument(undefined)).toBeNull();
    expect(inferCurrencyFromInstrument('比特幣')).toBeNull();
  });

  it('resolveDisplayCurrency: 明確 currency 最優先', () => {
    expect(resolveDisplayCurrency('USD', '2330 台積電')).toBe('USD');
    expect(resolveDisplayCurrency('TWD', 'AAPL Apple')).toBe('TWD');
  });

  it('resolveDisplayCurrency: 缺 currency 時從 instrument 推斷', () => {
    expect(resolveDisplayCurrency(null, 'AAPL Apple')).toBe('USD');
    expect(resolveDisplayCurrency(undefined, '2330 台積電')).toBe('TWD');
    expect(resolveDisplayCurrency('', '00631L')).toBe('TWD');
  });

  it('resolveDisplayCurrency: 完全無資訊回落 TWD 而非炸掉', () => {
    expect(resolveDisplayCurrency(null, null)).toBe('TWD');
    expect(resolveDisplayCurrency(undefined, undefined)).toBe('TWD');
    expect(resolveDisplayCurrency(null, '比特幣')).toBe('TWD');
  });
});
