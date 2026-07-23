import { describe, it, expect } from 'vitest';
import { pickSignalCurrency } from '../SignalRow';

describe('pickSignalCurrency — 週記管理列表幣別判定', () => {
  it('美股 asset_class（spec.currency=USD）即使 signal.currency 缺失也回 USD', () => {
    expect(pickSignalCurrency({ instrument: 'SPCX' }, 'USD', 'TWD')).toBe('USD');
    expect(pickSignalCurrency({ instrument: 'INTC' }, 'USD')).toBe('USD');
  });

  it('台股 spec 回 TWD', () => {
    expect(pickSignalCurrency({ instrument: '2330 台積電' }, 'TWD', 'TWD')).toBe('TWD');
  });

  it('明確 signal.currency 最優先，覆寫 asset_class 推斷', () => {
    expect(pickSignalCurrency({ currency: 'TWD', instrument: 'AAPL' }, 'USD', 'TWD')).toBe('TWD');
    expect(pickSignalCurrency({ currency: 'USD', instrument: '2330' }, 'TWD', 'TWD')).toBe('USD');
  });

  it('spec 是 TWD（asset_class 缺 / 為台股）但 instrument 是美股代號 → 推斷 USD', () => {
    expect(pickSignalCurrency({ instrument: 'AAPL' }, 'TWD', 'TWD')).toBe('USD');
    expect(pickSignalCurrency({ instrument: 'BRK.B' }, 'TWD', 'TWD')).toBe('USD');
  });

  it('無 currency / 無法推斷 → 回 defaultCurrency', () => {
    expect(pickSignalCurrency({ instrument: '比特幣' }, 'TWD', 'USD')).toBe('USD');
    expect(pickSignalCurrency({}, 'TWD', 'TWD')).toBe('TWD');
  });

  it('非法 signal.currency 值不會被採用', () => {
    expect(pickSignalCurrency({ currency: 'JPY', instrument: 'AAPL' }, 'USD', 'TWD')).toBe('USD');
    expect(pickSignalCurrency({ currency: null, instrument: 'SPCX' }, 'USD', 'TWD')).toBe('USD');
  });
});
