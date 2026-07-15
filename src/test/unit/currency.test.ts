import { describe, it, expect } from 'vitest';
import {
  formatMoneyByCurrency,
  isValidSymbol,
  normalizeCurrency,
  allowedQuantityUnits,
  defaultQuantityUnit,
  CURRENCY_SYMBOL,
} from '@/lib/currency';

describe('currency utils', () => {
  describe('formatMoneyByCurrency', () => {
    it('TWD 預設 NT$ 前綴', () => {
      expect(formatMoneyByCurrency(1234)).toBe('NT$1,234');
      expect(formatMoneyByCurrency(1234, 'TWD')).toBe('NT$1,234');
    });
    it('USD 切 US$ 前綴', () => {
      expect(formatMoneyByCurrency(1234.56, 'USD')).toBe('US$1,235');
    });
    it('負數把符號擺前面', () => {
      expect(formatMoneyByCurrency(-500, 'TWD')).toBe('-NT$500');
      expect(formatMoneyByCurrency(-99.9, 'USD')).toBe('-US$100');
    });
    it('null / NaN 視為 0', () => {
      expect(formatMoneyByCurrency(null)).toBe('NT$0');
      expect(formatMoneyByCurrency(undefined, 'USD')).toBe('US$0');
      expect(formatMoneyByCurrency(NaN)).toBe('NT$0');
    });
  });

  describe('isValidSymbol', () => {
    it('TWD 接受 4–6 位數字（純數字）', () => {
      expect(isValidSymbol('2330', 'TWD')).toBe(true);
      expect(isValidSymbol('0050', 'TWD')).toBe(true);
      expect(isValidSymbol('00878', 'TWD')).toBe(true);
      expect(isValidSymbol('123', 'TWD')).toBe(false);
      expect(isValidSymbol('AAPL', 'TWD')).toBe(false);
    });
    it('TWD 接受 4–6 位數字 + 選填 1 個英文字母（涵蓋槓桿/反向/債券 ETF）', () => {
      expect(isValidSymbol('00631L', 'TWD')).toBe(true);   // 元大台灣 50 正 2
      expect(isValidSymbol('00632R', 'TWD')).toBe(true);   // 元大台灣 50 反 1
      expect(isValidSymbol('00878B', 'TWD')).toBe(true);   // 國泰投資級公司債
      expect(isValidSymbol('00679B', 'TWD')).toBe(true);   // 元大美債 20 年
      expect(isValidSymbol('12345B', 'TWD')).toBe(true);   // 5 碼 + 字母
      expect(isValidSymbol('9999X', 'TWD')).toBe(true);    // 4 碼 + 字母
    });
    it('TWD 小寫字母自動 uppercase 後接受', () => {
      expect(isValidSymbol('00631l', 'TWD')).toBe(true);
      expect(isValidSymbol('00878b', 'TWD')).toBe(true);
    });
    it('TWD 拒絕雙字母尾或不合格式', () => {
      expect(isValidSymbol('00631LR', 'TWD')).toBe(false); // 雙字母
      expect(isValidSymbol('L00631', 'TWD')).toBe(false);  // 字母開頭
      expect(isValidSymbol('006318', 'TWD')).toBe(true);   // 6 碼純數字
      expect(isValidSymbol('0063189', 'TWD')).toBe(false); // 7 碼超長
      expect(isValidSymbol('006318BB', 'TWD')).toBe(false);
    });
    it('USD 接受 1–5 大寫字母與 .X 後綴', () => {
      expect(isValidSymbol('AAPL', 'USD')).toBe(true);
      expect(isValidSymbol('TSLA', 'USD')).toBe(true);
      expect(isValidSymbol('BRK.B', 'USD')).toBe(true);
      expect(isValidSymbol('GOOGL', 'USD')).toBe(true);
      expect(isValidSymbol('2330', 'USD')).toBe(false);
      expect(isValidSymbol('TOOLONG', 'USD')).toBe(false);
    });
    it('空字串永遠無效', () => {
      expect(isValidSymbol('', 'TWD')).toBe(false);
      expect(isValidSymbol('  ', 'USD')).toBe(false);
    });
  });

  describe('normalizeCurrency', () => {
    it('未知值 fallback TWD', () => {
      expect(normalizeCurrency(null)).toBe('TWD');
      expect(normalizeCurrency('JPY')).toBe('TWD');
      expect(normalizeCurrency(undefined)).toBe('TWD');
    });
    it('正確值原樣回', () => {
      expect(normalizeCurrency('USD')).toBe('USD');
      expect(normalizeCurrency('TWD')).toBe('TWD');
    });
  });

  describe('quantity unit rules', () => {
    it('USD 只能用「股」', () => {
      expect(allowedQuantityUnits('USD')).toEqual(['股']);
      expect(defaultQuantityUnit('USD')).toBe('股');
    });
    it('TWD 可以「張」或「股」', () => {
      expect(allowedQuantityUnits('TWD')).toEqual(['張', '股']);
      expect(defaultQuantityUnit('TWD')).toBe('張');
    });
  });

  it('CURRENCY_SYMBOL 對照表', () => {
    expect(CURRENCY_SYMBOL.TWD).toBe('NT$');
    expect(CURRENCY_SYMBOL.USD).toBe('US$');
  });
});
