import { describe, it, expect } from 'vitest';
import {
  getAssetSpec,
  resolveAssetClass,
  isValidAssetSymbol,
  isMarketClosedFor,
  normalizeAssetClass,
} from '@/lib/asset';

describe('asset spec', () => {
  it('resolves asset_class from expert.currency fallback', () => {
    expect(resolveAssetClass({ currency: 'USD' })).toBe('us_stock');
    expect(resolveAssetClass({ currency: 'TWD' })).toBe('tw_stock');
    expect(resolveAssetClass({ asset_class: 'crypto', currency: 'USD' })).toBe('crypto');
    expect(resolveAssetClass(null)).toBe('tw_stock');
  });

  it('normalizes unknown values safely', () => {
    expect(normalizeAssetClass('foo')).toBe('tw_stock');
    expect(normalizeAssetClass(undefined)).toBe('tw_stock');
    expect(normalizeAssetClass('us_stock')).toBe('us_stock');
  });

  it('provides correct spec per class', () => {
    expect(getAssetSpec('tw_stock').defaultUnit).toBe('張');
    expect(getAssetSpec('us_stock').defaultUnit).toBe('股');
    expect(getAssetSpec('us_stock').units).toEqual(['股']);
    expect(getAssetSpec('crypto').defaultUnit).toBe('顆');
    expect(getAssetSpec('crypto').quantityAllowsDecimal).toBe(true);
    expect(getAssetSpec('crypto').marketHours).toBe('24x7');
  });

  it('validates symbols per class', () => {
    expect(isValidAssetSymbol('2330', 'tw_stock')).toBe(true);
    expect(isValidAssetSymbol('AAPL', 'tw_stock')).toBe(false);
    expect(isValidAssetSymbol('AAPL', 'us_stock')).toBe(true);
    expect(isValidAssetSymbol('BRK.B', 'us_stock')).toBe(true);
    expect(isValidAssetSymbol('2330', 'us_stock')).toBe(false);
    expect(isValidAssetSymbol('BTC', 'crypto')).toBe(true);
    expect(isValidAssetSymbol('ETH', 'crypto')).toBe(true);
    expect(isValidAssetSymbol('中文', 'crypto')).toBe(false);
    expect(isValidAssetSymbol('', 'tw_stock')).toBe(false);
  });

  it('tw_stock 接受英數字尾 ETF 代碼（槓桿 / 反向 / 債券）', () => {
    expect(isValidAssetSymbol('00631L', 'tw_stock')).toBe(true);
    expect(isValidAssetSymbol('00632R', 'tw_stock')).toBe(true);
    expect(isValidAssetSymbol('00878B', 'tw_stock')).toBe(true);
    expect(isValidAssetSymbol('00679B', 'tw_stock')).toBe(true);
    // uppercaseSymbol=true → 小寫輸入被 uppercase 後接受
    expect(isValidAssetSymbol('00631l', 'tw_stock')).toBe(true);
    // 雙字母 / 字母開頭 / 超長 一律拒絕
    expect(isValidAssetSymbol('00631LR', 'tw_stock')).toBe(false);
    expect(isValidAssetSymbol('L0050', 'tw_stock')).toBe(false);
    expect(isValidAssetSymbol('0063180', 'tw_stock')).toBe(false);
  });

  it('tw_stock uppercaseSymbol 已開啟（避免大小寫快取分裂）', () => {
    expect(getAssetSpec('tw_stock').uppercaseSymbol).toBe(true);
  });
});

describe('isMarketClosedFor', () => {
  it('crypto is always open', () => {
    expect(isMarketClosedFor('24x7', new Date('2026-07-14T03:00:00Z'))).toBe(false);
    expect(isMarketClosedFor('24x7', new Date('2026-07-19T20:00:00Z'))).toBe(false); // Sunday
  });

  it('us market: closed on weekends', () => {
    // 2026-07-18 Sat 15:00 UTC
    expect(isMarketClosedFor('us', new Date('2026-07-18T15:00:00Z'))).toBe(true);
  });

  it('us market: open at 14:30 UTC on weekday (9:30 ET summer = 13:30 UTC EDT)', () => {
    // 2026-07-14 Tue 15:00 UTC = 11:00 EDT → open
    expect(isMarketClosedFor('us', new Date('2026-07-14T15:00:00Z'))).toBe(false);
  });

  it('us market: closed after 20:00 UTC on weekday (16:00 EDT)', () => {
    // 2026-07-14 Tue 21:00 UTC = 17:00 EDT → closed
    expect(isMarketClosedFor('us', new Date('2026-07-14T21:00:00Z'))).toBe(true);
  });

  it('tw market: closed on weekends', () => {
    expect(isMarketClosedFor('tw', new Date('2026-07-18T03:00:00Z'))).toBe(true); // Sat
  });

  it('tw market: open Tue 05:00 UTC (13:00 TW)', () => {
    expect(isMarketClosedFor('tw', new Date('2026-07-14T05:00:00Z'))).toBe(false);
  });

  it('tw market: closed Tue 06:00 UTC (14:00 TW, after 13:30)', () => {
    expect(isMarketClosedFor('tw', new Date('2026-07-14T06:00:00Z'))).toBe(true);
  });
});
