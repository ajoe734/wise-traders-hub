import { describe, it, expect } from 'vitest';
import {
  buildBucketValuations,
  peerScopeLabel,
  PEER_SCOPE_LABEL,
  PORTFOLIO_BUCKET_VALUATION_CONTRACT,
  type BucketAssignment,
  type PortfolioValuationInput,
} from '@/checkup/lib/valuationRulers';

/** 造一組同業（n >= MIN_PEER_N），中位數可預測。 */
function peers(vals: number[]) {
  return vals.map((v, i) => ({ symbol: `P${i}`, pe: v, pb: v / 10, dividendYield: v / 10 }));
}

const row = (symbol: string, weight: number, pe: number, peerVals: number[]): PortfolioValuationInput => ({
  symbol,
  weight,
  pe,
  pb: pe / 10,
  dividendYield: pe / 10,
  peers: peers(peerVals),
});

describe('PORTFOLIO_BUCKET_VALUATION_V1 — 產業／族群分桶加權指數', () => {
  it('合約常數存在', () => {
    expect(PORTFOLIO_BUCKET_VALUATION_CONTRACT).toBe('PORTFOLIO_BUCKET_VALUATION_V1');
  });

  it('產業桶依 share 分攤市值，佔比合計 100%', () => {
    const rows = [row('1111', 600, 20, [10, 10, 10]), row('2222', 400, 10, [10, 10, 10])];
    const map: Record<string, BucketAssignment[]> = {
      '1111': [
        { kind: 'industry', key: '甲產業', share: 0.5 },
        { kind: 'industry', key: '乙產業', share: 0.5 },
      ],
      '2222': [{ kind: 'industry', key: '乙產業', share: 1 }],
    };
    const buckets = buildBucketValuations(rows, (s) => map[s] || []);
    const ind = buckets.filter((b) => b.kind === 'industry');
    const sum = ind.reduce((a, b) => a + b.weightShare, 0);
    expect(Math.round(sum * 100) / 100).toBe(1);
    expect(ind.find((b) => b.key === '甲產業')!.weight).toBe(300);
    expect(ind.find((b) => b.key === '乙產業')!.weight).toBe(700);
  });

  it('族群桶不互斥：一檔可落入多個族群，且不影響產業桶合計', () => {
    const rows = [row('3017', 1000, 30, [10, 10, 10])];
    const buckets = buildBucketValuations(rows, () => [
      { kind: 'industry', key: '散熱模組', share: 1 },
      { kind: 'marketGroup', key: '散熱三雄' },
      { kind: 'marketGroup', key: '液冷概念股' },
    ]);
    const groups = buckets.filter((b) => b.kind === 'marketGroup');
    expect(groups.map((g) => g.key).sort()).toEqual(['散熱三雄', '液冷概念股']);
    for (const g of groups) expect(g.weightShare).toBe(1);
    expect(buckets.filter((b) => b.kind === 'industry')[0].weightShare).toBe(1);
  });

  it('桶內加權溢折價：pe 20 vs 同業中位數 10 → +100%', () => {
    const buckets = buildBucketValuations([row('1111', 100, 20, [10, 10, 10])], () => [
      { kind: 'industry', key: '甲產業', share: 1 },
    ]);
    const pe = buckets[0].rulers.find((r) => r.key === 'pe')!;
    expect(pe.weightedPremium).toBe(1);
    expect(pe.text).toBe('高於同業');
    expect(buckets[0].coverage).toBe(1);
    expect(buckets[0].insufficient).toBe(false);
  });

  it('同業樣本不足（n < 3）→ 該桶標 insufficient、涵蓋率 0', () => {
    const thin: PortfolioValuationInput = {
      symbol: '9999',
      weight: 100,
      pe: 20,
      pb: 2,
      dividendYield: 2,
      peers: peers([10, 12]),
    };
    const buckets = buildBucketValuations([thin], () => [{ kind: 'industry', key: '冷門產業', share: 1 }]);
    expect(buckets[0].insufficient).toBe(true);
    expect(buckets[0].coverage).toBe(0);
    expect(buckets[0].rulers.every((r) => r.weightedPremium == null)).toBe(true);
    expect(buckets[0].rulers[0].text).toBe('資料不足');
  });

  it('桶內只有部分持股算得出溢折價 → 涵蓋率反映實際市值比', () => {
    const ok = row('1111', 300, 20, [10, 10, 10]);
    const thin: PortfolioValuationInput = { symbol: '2222', weight: 700, pe: 20, pb: 2, dividendYield: 2, peers: peers([10]) };
    const buckets = buildBucketValuations([ok, thin], () => [{ kind: 'industry', key: '甲產業', share: 1 }]);
    expect(buckets[0].coverage).toBe(0.3);
    expect(buckets[0].stockCount).toBe(2);
  });

  it('市值為 0 或負的持股整檔排除；無有效市值回空陣列', () => {
    const zero: PortfolioValuationInput = { symbol: '1111', weight: 0, pe: 20, pb: 2, dividendYield: 2, peers: peers([10, 10, 10]) };
    expect(buildBucketValuations([zero], () => [{ kind: 'industry', key: '甲', share: 1 }])).toEqual([]);
  });

  it('同一檔重複給同一個桶不會重複計算', () => {
    const buckets = buildBucketValuations([row('1111', 100, 20, [10, 10, 10])], () => [
      { kind: 'industry', key: '甲產業', share: 1 },
      { kind: 'industry', key: '甲產業', share: 1 },
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].weight).toBe(100);
  });

  it('依桶市值由大到小排序', () => {
    const rows = [row('1111', 100, 20, [10, 10, 10]), row('2222', 900, 20, [10, 10, 10])];
    const map: Record<string, BucketAssignment[]> = {
      '1111': [{ kind: 'industry', key: '小桶', share: 1 }],
      '2222': [{ kind: 'industry', key: '大桶', share: 1 }],
    };
    const buckets = buildBucketValuations(rows, (s) => map[s]);
    expect(buckets.map((b) => b.key)).toEqual(['大桶', '小桶']);
  });
});

describe('同業母體層級標示', () => {
  it('五段母體都有中文標籤', () => {
    expect(Object.keys(PEER_SCOPE_LABEL).sort()).toEqual(['broad', 'fine', 'fineWide', 'group', 'legacy']);
    expect(peerScopeLabel('group')).toBe('市場族群');
    expect(peerScopeLabel('fineWide')).toBe('細分產業（含次要）');
    expect(peerScopeLabel('broad')).toBe('產業大類');
  });

  it('未知或空值回細分產業（保守預設）', () => {
    expect(peerScopeLabel(null)).toBe('細分產業');
    expect(peerScopeLabel('what')).toBe('細分產業');
  });
});
