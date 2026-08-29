import { describe, it, expect } from 'vitest';
import {
  normalizeStockCode,
  isTaiwanStockCode,
  isUsTicker,
  classifyCode,
  isSupportedCode,
  TW_CODE_RE,
  US_CODE_RE,
} from '@/checkup/lib/stockIdentity';
import { getAssetSpec } from '@/lib/asset';

describe('stockIdentity — normalize', () => {
  it('trim + uppercase', () => {
    expect(normalizeStockCode(' 00637l ')).toBe('00637L');
    expect(normalizeStockCode('amd')).toBe('AMD');
    expect(normalizeStockCode(null)).toBe('');
    expect(normalizeStockCode(undefined)).toBe('');
  });
});

describe('stockIdentity — TW universe', () => {
  it.each(['2330', '00637L', '00878', '911616', '6505'])('%s 合法', (c) => {
    expect(isTaiwanStockCode(c)).toBe(true);
    expect(classifyCode(c)).toBe('TW');
  });

  it.each(['12', '123', '1234567', '2330LL'])('%s 非法台股', (c) => {
    expect(isTaiwanStockCode(c)).toBe(false);
  });

  it('小寫後綴需先正規化才通過（大小寫敏感契約）', () => {
    expect(isTaiwanStockCode('00637l')).toBe(false);
    expect(isTaiwanStockCode(normalizeStockCode('00637l'))).toBe(true);
    expect(classifyCode('00637l')).toBe('TW');
  });
});

describe('stockIdentity — US universe', () => {
  it.each(['AMD', 'SOXL', 'BRK.B', 'F', 'GOOGL'])('%s 合法', (c) => {
    expect(isUsTicker(c)).toBe(true);
    expect(classifyCode(c)).toBe('US');
  });

  it.each(['TOOLONGX', 'AB.CD', '', 'AA-BB'])('%s 非法美股', (c) => {
    expect(isUsTicker(c)).toBe(false);
  });

  it('小寫自動正規化', () => {
    expect(isUsTicker('amd')).toBe(true);
  });
});

describe('parity — 與全站既有 regex 不得 drift', () => {
  it('TW regex 與 asset.ts tw_stock.symbolRegex 相同', () => {
    expect(TW_CODE_RE.source).toBe(getAssetSpec('tw_stock').symbolRegex.source);
  });

  it('US regex 與 asset.ts us_stock.symbolRegex 相同', () => {
    expect(US_CODE_RE.source).toBe(getAssetSpec('us_stock').symbolRegex.source);
  });

  it('chipsRepository 仍 re-export 同一實作', async () => {
    const repo = await import('@/checkup/lib/chipsRepository');
    expect(repo.normalizeStockCode).toBe(normalizeStockCode);
    expect(repo.isTaiwanStockCode).toBe(isTaiwanStockCode);
  });
});

describe('isSupportedCode', () => {
  it('unknown 一律 false', () => {
    expect(isSupportedCode('12')).toBe(false);
    expect(isSupportedCode('TOOLONGX')).toBe(false);
    expect(isSupportedCode('2330')).toBe(true);
    expect(isSupportedCode('brk.b')).toBe(true);
  });
});
