import { describe, it, expect } from 'vitest';
import {
  analyzeCombo,
  buildOccSymbol,
  calcNetPremium,
  detectComboStrategy,
  formatComboLabel,
  validateCombo,
  type ComboLeg,
} from '@/lib/optionCombo';
import { getAssetSpec, sanitizeAssetQuantityUnit } from '@/lib/asset';

const leg = (p: Partial<ComboLeg>): ComboLeg => ({
  underlying: 'SNDK',
  expiry: '2026-08-21',
  right: 'P',
  strike: 100,
  side: 'long',
  ratio: 1,
  price: 1,
  ...p,
});

describe('asset spec — us_option 支援「組」', () => {
  it('units 含 口 與 組', () => {
    expect(getAssetSpec('us_option').units).toEqual(['口', '組']);
  });
  it('sanitize 保留「組」', () => {
    expect(sanitizeAssetQuantityUnit('組', 'us_option')).toBe('組');
  });
  it('台股不接受「組」', () => {
    expect(sanitizeAssetQuantityUnit('組', 'tw_stock')).toBe('張');
  });
});

describe('buildOccSymbol', () => {
  it('組出 21 字元 OCC', () => {
    const s = buildOccSymbol({ underlying: 'aapl', expiry: '2024-01-19', right: 'C', strike: 150 });
    expect(s).toBe('AAPL240119C00150000');
  });
  it('小數履約價', () => {
    expect(buildOccSymbol({ underlying: 'SPY', expiry: '2026-08-21', right: 'P', strike: 512.5 }))
      .toBe('SPY260821P00512500');
  });
  it('缺資料回空字串', () => {
    expect(buildOccSymbol({ underlying: '', expiry: '2026-08-21', right: 'P', strike: 100 })).toBe('');
  });
});

describe('combo 損益計算', () => {
  it('Bull Put credit spread：賣 950P / 買 925P，權利金淨收 10 → 最大損失 = 25*100-1000', () => {
    const legs = [
      leg({ right: 'P', strike: 950, side: 'short', price: 20 }),
      leg({ right: 'P', strike: 925, side: 'long', price: 10 }),
    ];
    expect(calcNetPremium(legs)).toBe(1000);
    const m = analyzeCombo(legs);
    expect(m.maxProfitPerUnit).toBe(1000);
    expect(m.maxLossPerUnit).toBe(1500);
    expect(m.definedRisk).toBe(true);
    expect(detectComboStrategy(legs)).toBe('vertical_put');
  });

  it('Bear Call credit spread：賣 1600C / 買 1625C', () => {
    const legs = [
      leg({ right: 'C', strike: 1600, side: 'short', price: 15 }),
      leg({ right: 'C', strike: 1625, side: 'long', price: 9 }),
    ];
    const m = analyzeCombo(legs);
    expect(m.netPremium).toBe(600);
    expect(m.maxProfitPerUnit).toBe(600);
    expect(m.maxLossPerUnit).toBe(1900);
    expect(detectComboStrategy(legs)).toBe('vertical_call');
  });

  it('Debit spread：買 100C / 賣 110C，付出 400 → 最大損失即付出的權利金', () => {
    const legs = [
      leg({ right: 'C', strike: 100, side: 'long', price: 6 }),
      leg({ right: 'C', strike: 110, side: 'short', price: 2 }),
    ];
    expect(calcNetPremium(legs)).toBe(-400);
    const m = analyzeCombo(legs);
    expect(m.maxLossPerUnit).toBe(400);
    expect(m.maxProfitPerUnit).toBe(600);
  });

  it('Iron Condor 四腿：最大損失 = 較寬那側寬度 - 淨權利金', () => {
    const legs = [
      leg({ right: 'P', strike: 925, side: 'long', price: 5 }),
      leg({ right: 'P', strike: 950, side: 'short', price: 12 }),
      leg({ right: 'C', strike: 1600, side: 'short', price: 11 }),
      leg({ right: 'C', strike: 1625, side: 'long', price: 4 }),
    ];
    const m = analyzeCombo(legs);
    expect(m.netPremium).toBe(1400);
    expect(m.maxProfitPerUnit).toBe(1400);
    expect(m.maxLossPerUnit).toBe(1100); // 2500 - 1400
    expect(detectComboStrategy(legs)).toBe('iron_condor');
  });

  it('裸賣 → 風險無限，擋下發布', () => {
    const legs = [leg({ right: 'C', strike: 1600, side: 'short', price: 15 })];
    const r = validateCombo([...legs, leg({ right: 'P', strike: 900, side: 'short', price: 8 })]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('風險無限');
  });

  it('圖中案例：SNDK 950/925P + 1600/1625C 淨收 775 → 最大損失 1725', () => {
    const legs = [
      leg({ right: 'P', strike: 950, side: 'short', price: 10 }),
      leg({ right: 'P', strike: 925, side: 'long', price: 4 }),
      leg({ right: 'C', strike: 1600, side: 'short', price: 5.75 }),
      leg({ right: 'C', strike: 1625, side: 'long', price: 4 }),
    ];
    const m = analyzeCombo(legs);
    expect(m.netPremium).toBe(775);
    expect(m.maxLossPerUnit).toBe(1725);
  });
});

describe('formatComboLabel', () => {
  it('賣方在前、買方在後', () => {
    const legs = [
      leg({ right: 'P', strike: 925, side: 'long', price: 4 }),
      leg({ right: 'P', strike: 950, side: 'short', price: 10 }),
      leg({ right: 'C', strike: 1600, side: 'short', price: 6 }),
      leg({ right: 'C', strike: 1625, side: 'long', price: 4 }),
    ];
    expect(formatComboLabel(legs)).toBe('SNDK 950/925P + 1600/1625C');
  });
});

describe('validateCombo', () => {
  it('通過時回傳 metrics', () => {
    const r = validateCombo([
      leg({ right: 'P', strike: 950, side: 'short', price: 10 }),
      leg({ right: 'P', strike: 925, side: 'long', price: 4 }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.metrics?.maxLossPerUnit).toBe(1900);
  });
  it('不同標的擋下', () => {
    const r = validateCombo([
      leg({ right: 'P', strike: 950, side: 'short', price: 10 }),
      leg({ underlying: 'AAPL', right: 'P', strike: 925, side: 'long', price: 4 }),
    ]);
    expect(r.ok).toBe(false);
  });
});
