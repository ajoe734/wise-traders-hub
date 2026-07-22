/**
 * P0 Step 7 regression: 顯示層 (SignalDetail / JournalDetail) 的單位解析必須以 asset_class 為主，
 * 不得因 quantity_unit 缺值或 currency 錯配而退回硬編「張」或「股」。
 *
 * 舊實作：sanitizeQuantityUnit(raw, currency) 只輸出「張/股」，us_future 會被誤印為「股」。
 * 新實作：SignalDetail / JournalDetail 已改用 sanitizeAssetQuantityUnit(raw, asset_class)。
 */
import { describe, it, expect } from 'vitest';
import { sanitizeAssetQuantityUnit } from '@/lib/asset';

describe('sanitizeAssetQuantityUnit — 顯示層 asset_class 主導', () => {
  it('us_future + null → 口（絕不退成股）', () => {
    expect(sanitizeAssetQuantityUnit(null, 'us_future')).toBe('口');
    expect(sanitizeAssetQuantityUnit('', 'us_future')).toBe('口');
    expect(sanitizeAssetQuantityUnit('股', 'us_future')).toBe('口');
    expect(sanitizeAssetQuantityUnit('張', 'us_future')).toBe('口');
  });
  it('us_option + null → 口', () => {
    expect(sanitizeAssetQuantityUnit(null, 'us_option')).toBe('口');
    expect(sanitizeAssetQuantityUnit('張', 'us_option')).toBe('口');
  });
  it('crypto + null → 顆', () => {
    expect(sanitizeAssetQuantityUnit(null, 'crypto')).toBe('顆');
    expect(sanitizeAssetQuantityUnit('股', 'crypto')).toBe('顆');
  });
  it('us_stock + null → 股（不允許張）', () => {
    expect(sanitizeAssetQuantityUnit(null, 'us_stock')).toBe('股');
    expect(sanitizeAssetQuantityUnit('張', 'us_stock')).toBe('股');
    expect(sanitizeAssetQuantityUnit('股', 'us_stock')).toBe('股');
  });
  it('tw_stock 保留張/股，缺值預設張', () => {
    expect(sanitizeAssetQuantityUnit('張', 'tw_stock')).toBe('張');
    expect(sanitizeAssetQuantityUnit('股', 'tw_stock')).toBe('股');
    expect(sanitizeAssetQuantityUnit(null, 'tw_stock')).toBe('張');
    expect(sanitizeAssetQuantityUnit('口', 'tw_stock')).toBe('張');
  });
  it('未知 asset_class → normalize 為 tw_stock 預設', () => {
    expect(sanitizeAssetQuantityUnit(null, '')).toBe('張');
    expect(sanitizeAssetQuantityUnit(null, null)).toBe('張');
  });
});
