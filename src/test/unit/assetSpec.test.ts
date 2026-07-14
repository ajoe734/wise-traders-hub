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
