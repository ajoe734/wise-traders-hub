import { describe, it, expect } from 'vitest';
import { holdingsValueKeyShort } from '@/checkup/lib/holdingsSort';
import { aggregateBySector } from '@/checkup/lib/holdingUtils.js';

const meta = { '2330': { industry: '半導體' }, '2881': { industry: '金融' } } as any;
const before = [
  { code: '2330', qty: 1000, price: 1000, cost: 800, value: 1_000_000 },
  { code: '2881', qty: 10000, price: 100, cost: 80, value: 1_000_000 },
];
// 賣出 2330 一半：沿用現價重算市值
const after = [{ ...before[0], qty: 500, value: 500_000 }, before[1]];

describe('賣出後族群權重以持倉即時市值重算', () => {
  it('股數改變會改變持倉 key（觸發重算，不需等報價）', () => {
    expect(holdingsValueKeyShort(after)).not.toBe(holdingsValueKeyShort(before));
  });

  it('產業佔比依賣出後市值：半導體 50% → 33.3%', () => {
    const pct = (r: any, k: string) => r.industryByValue.find((x: any) => x.key === k)?.pct;
    expect(pct(aggregateBySector(before, meta, {}), '半導體')).toBeCloseTo(50, 0);
    const r = aggregateBySector(after, meta, {});
    expect(r.totalValue).toBe(1_500_000);
    expect(pct(r, '半導體')).toBeCloseTo(33.3, 0);
  });

  it('全部賣出後該產業消失', () => {
    const r = aggregateBySector([before[1]], meta, {});
    expect(r.industryByValue.map((x: any) => x.key)).toEqual(['金融']);
  });
});
