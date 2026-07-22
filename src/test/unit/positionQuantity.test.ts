import { describe, expect, it } from 'vitest';
import {
  formatBaseQuantity,
  normalizeQuantityToBaseUnits,
  resolveMaxBuyDraftQuantity,
  resolvePositionQuantityDisplay,
} from '@/lib/positionQuantity';

describe('positionQuantity — base quantity / display quantity single source', () => {
  it('台股張：draft 1 張會轉成 1000 股 base quantity', () => {
    expect(normalizeQuantityToBaseUnits(1, '張')).toBe(1000);
    expect(normalizeQuantityToBaseUnits(2, '張')).toBe(2000);
  });

  it('台股股：draft 1 股維持 1 base quantity', () => {
    expect(normalizeQuantityToBaseUnits(1, '股')).toBe(1);
    expect(normalizeQuantityToBaseUnits(999, '股')).toBe(999);
  });

  it('台股張持倉：1000 base 股數顯示/帶入為 1 張，不再顯示 1000 股', () => {
    expect(resolvePositionQuantityDisplay(1000, '張', 'tw_stock')).toEqual({
      baseQuantity: 1000,
      unit: '張',
      inputQuantity: 1,
      label: '1 張',
    });
  });

  it('台股股持倉：1 base 股數顯示/帶入仍是 1 股，不會被換成 1 張', () => {
    expect(resolvePositionQuantityDisplay(1, '股', 'tw_stock')).toEqual({
      baseQuantity: 1,
      unit: '股',
      inputQuantity: 1,
      label: '1 股',
    });
  });

  it('台股張但 base 不足一張：回退成股，避免 fractional lot 寫入整數欄位', () => {
    expect(resolvePositionQuantityDisplay(500, '張', 'tw_stock')).toEqual({
      baseQuantity: 500,
      unit: '股',
      inputQuantity: 500,
      label: '500 股',
    });
  });

  it('美股/期貨/選擇權：不會套用台股 ×1000', () => {
    expect(normalizeQuantityToBaseUnits(3, '股')).toBe(3);
    expect(normalizeQuantityToBaseUnits(2, '口')).toBe(2);
    expect(formatBaseQuantity(2, '口', 'us_future')).toBe('2 口');
  });

  it('最大可買：台股預設張時先取整張，不足一張才回退股', () => {
    expect(resolveMaxBuyDraftQuantity(2000, '張', 'tw_stock')).toEqual({ quantity: '2', quantityUnit: '張' });
    expect(resolveMaxBuyDraftQuantity(999, '張', 'tw_stock')).toEqual({ quantity: '999', quantityUnit: '股' });
  });
});