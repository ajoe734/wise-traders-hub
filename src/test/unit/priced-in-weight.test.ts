import { describe, it, expect } from 'vitest';
import { holdingWeights, weightByLevel } from '@/checkup/components/freecheckup/usePricedInList';

describe('持股比例', () => {
  it('市值 ÷ 總市值，同代碼合併', () => {
    const w = holdingWeights([{ code: '2330', value: 600 }, { code: '2308', value: 300 }, { code: '2330', value: 100 }]);
    expect(w.get('2330')).toBeCloseTo(0.7);
    expect(w.get('2308')).toBeCloseTo(0.3);
  });
  it('總市值為 0 或有市值缺漏 → 不顯示比例', () => {
    expect(holdingWeights([{ code: '2330', value: 0 }]).get('2330')).toBeNull();
    expect(holdingWeights([{ code: '2330', value: 100 }, { code: '2308', value: NaN }]).get('2330')).toBeNull();
  });
  it('各分級合計', () => {
    const r = weightByLevel([
      { code: 'a', name: '', price: 1, weight: 0.5, pricedIn: { level: 'heavy', label: '已大幅反映', ratioToBelt: 2, impliedPercentile: 1, sentence: '' } },
      { code: 'b', name: '', price: 1, weight: 0.3, pricedIn: { level: 'unknown', label: '無法判斷', reason: 'x' } },
      { code: 'c', name: '', price: 1, weight: 0.2, pricedIn: null },
    ]);
    expect(r).toEqual({ under: 0, partial: 0, heavy: 0.5, unknown: 0.3 });
  });
});
