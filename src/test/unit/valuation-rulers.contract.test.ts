import { describe, it, expect } from 'vitest';
import contract from '@/checkup/lib/valuationRulers.contract.json';
import {
  buildValuationView,
  computePeerStat,
  computeRuler,
  median,
  winsorize,
  percentileRank,
  quantile,
  bandFromPercentile,
  summarizeRulers,
  isFinancialIndustry,
  formatPremium,
  nearestPeers,
  MIN_HISTORY_SAMPLES,
  MIN_PEER_N,
  PERCENTILE_LOW,
  PERCENTILE_HIGH,
  VALUATION_RULERS_CONTRACT,
  type RulerKey,
} from '@/checkup/lib/valuationRulers';

function series(spec: { from: number; to: number; n: number }): number[] {
  const { from, to, n } = spec;
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

describe('VALUATION_RULERS_V1 — 門檻常數與合約一致', () => {
  it('contract 常數與程式碼一致', () => {
    expect(VALUATION_RULERS_CONTRACT).toBe(contract.contract);
    expect(PERCENTILE_LOW).toBe(contract.thresholds.percentileLow);
    expect(PERCENTILE_HIGH).toBe(contract.thresholds.percentileHigh);
    expect(MIN_HISTORY_SAMPLES).toBe(contract.thresholds.minHistorySamples);
    expect(MIN_PEER_N).toBe(contract.thresholds.minPeerN);
  });
});

describe('VALUATION_RULERS_V1 — 固定 vectors（真實個股）', () => {
  for (const v of contract.vectors as any[]) {
    it(v.name, () => {
      const view = buildValuationView({
        symbol: v.name.slice(0, 4),
        asOf: v.asOf ?? null,
        source: 'twse_bwibbu',
        pe: v.input.pe,
        pb: v.input.pb,
        dividendYield: v.input.dividendYield,
        history: {
          pe: series(v.historySpec.pe),
          pb: series(v.historySpec.pb),
          dividendYield: series(v.historySpec.dividendYield),
        },
      });
      const by = (k: RulerKey) => view.rulers.find((r) => r.key === k)!;
      expect(by('pe').band).toBe(v.expect.pe);
      if (v.expect.peNaReason) expect(by('pe').naReason).toBe(v.expect.peNaReason);
      if (v.expect.pb) expect(by('pb').band).toBe(v.expect.pb);
      if (v.expect.dividendYield) expect(by('dividendYield').band).toBe(v.expect.dividendYield);
      if (v.expect.dividendYieldNaReason) {
        expect(by('dividendYield').naReason).toBe(v.expect.dividendYieldNaReason);
      }
      expect(view.summary.overall).toBe(v.expect.overall ?? null);
      // 任何輸出都不得含買賣建議字眼
      expect(view.summary.text).not.toMatch(/買|賣|加碼|減碼|進場|出場/);
    });
  }

  it('2882 國泰金被判定為金融股', () => {
    expect(isFinancialIndustry('金融保險')).toBe(true);
    expect(isFinancialIndustry('金控')).toBe(true);
    expect(isFinancialIndustry('半導體業')).toBe(false);
    expect(isFinancialIndustry(null)).toBe(false);
  });
});

describe('VALUATION_RULERS_V1 — 同業 vectors', () => {
  for (const pv of contract.peerVectors as any[]) {
    it(pv.name, () => {
      const stat = computePeerStat(
        'pe',
        pv.self.pe,
        pv.peers.map((p: any, i: number) => ({ symbol: `P${i}`, pe: p.pe, pb: null, dividendYield: null })),
      );
      expect(stat.n).toBe(pv.expect.n);
      expect(stat.median).toBe(pv.expect.median);
      expect(stat.premium).toBe(pv.expect.premium);
    });
  }

  it('同業不足 3 家時不給中位數，但保留 n', () => {
    const stat = computePeerStat('pb', 2, [
      { symbol: 'A', pe: null, pb: 1, dividendYield: null },
      { symbol: 'B', pe: null, pb: 3, dividendYield: null },
    ]);
    expect(stat.median).toBeNull();
    expect(stat.n).toBe(2);
  });

  it('殖利率為 0 的同業不計入母體', () => {
    const rows = [0, 0, 2, 3, 4].map((y, i) => ({ symbol: `S${i}`, pe: null, pb: null, dividendYield: y }));
    const stat = computePeerStat('dividendYield', 3, rows);
    expect(stat.n).toBe(3);
    expect(stat.median).toBe(3);
  });

  it('最接近同業取 3 家，其餘進展開區', () => {
    const rows = [5, 9, 11, 30, 60].map((pe, i) => ({ symbol: `S${i}`, pe, pb: null, dividendYield: null }));
    const near = nearestPeers(10, rows, 3);
    expect(near.map((r) => r.pe)).toEqual([9, 11, 5]);
    const view = buildValuationView({
      symbol: '0000', asOf: '2026-09-18', source: 'finmind',
      pe: 10, pb: null, dividendYield: null,
      history: { pe: [], pb: [], dividendYield: [] },
      peers: rows,
    });
    expect(view.nearestPeers).toHaveLength(3);
    expect(view.restPeers).toHaveLength(2);
    expect(view.peerCount).toBe(5);
  });

  it('溢折價文字精確可重算', () => {
    expect(formatPremium(0.111)).toBe('較同業中位數溢價 11.1%');
    expect(formatPremium(-0.2345)).toBe('較同業中位數折價 23.5%');
    expect(formatPremium(0)).toBe('與同業中位數相當');
    expect(formatPremium(null)).toBe('—');
  });
});

describe('VALUATION_RULERS_V1 — 邊界', () => {
  const hist = Array.from({ length: 500 }, (_, i) => 5 + i * 0.05);

  it('P/E 負值、0、NaN、缺值都是 na，且不得回 0', () => {
    for (const bad of [-1, 0, Number.NaN, null, undefined]) {
      const r = computeRuler('pe', { value: bad as any, history: hist });
      expect(r.band).toBe('na');
      expect(r.value).toBeNull();
    }
  });

  it('P/B <= 0 是 na（淨值為負）', () => {
    expect(computeRuler('pb', { value: 0, history: hist }).naReason).toBe('non_positive_denominator');
    expect(computeRuler('pb', { value: -0.5, history: hist }).naReason).toBe('non_positive_denominator');
  });

  it('殖利率 0 為「無現金股利」而非偏貴', () => {
    const r = computeRuler('dividendYield', { value: 0, history: hist });
    expect(r.band).toBe('na');
    expect(r.naReason).toBe('no_dividend');
    expect(r.value).toBe(0);
  });

  it('歷史樣本 249 筆不足、250 筆足夠', () => {
    const h249 = hist.slice(0, 249);
    const h250 = hist.slice(0, 250);
    expect(computeRuler('pe', { value: 10, history: h249 }).naReason).toBe('insufficient_history');
    expect(computeRuler('pe', { value: 10, history: h250 }).band).not.toBe('na');
  });

  it('極端值不吃掉中位數（winsorize）', () => {
    expect(median([1, 2, 3, 4, 1e9])).toBe(3);
    expect(winsorize([1, 2, 3, 4, 1e9]).slice(-1)[0]).toBeLessThan(1e9);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(winsorize([])).toEqual([]);
    expect(median([])).toBeNull();
  });

  it('分位與分級方向正確（殖利率相反）', () => {
    expect(percentileRank([1, 2, 3, 4], 2)).toBe(50);
    expect(percentileRank([], 2)).toBeNull();
    expect(bandFromPercentile(10)).toBe('low');
    expect(bandFromPercentile(50)).toBe('fair');
    expect(bandFromPercentile(90)).toBe('high');
    expect(bandFromPercentile(90, true)).toBe('low');
    expect(bandFromPercentile(10, true)).toBe('high');
  });

  it('有效尺 < 2 時不給整體判定', () => {
    const naRuler = computeRuler('pe', { value: null, history: [] });
    const oneFair = computeRuler('pb', { value: 10, history: hist });
    expect(summarizeRulers([naRuler, naRuler, oneFair]).overall).toBeNull();
    expect(summarizeRulers([naRuler, naRuler, oneFair]).text).toContain('資料不足');
  });

  it('平手時取合理', () => {
    const low = { ...computeRuler('pe', { value: 5, history: hist }), band: 'low' as const };
    const high = { ...low, band: 'high' as const };
    const fair = { ...low, band: 'fair' as const };
    expect(summarizeRulers([low, high, fair]).overall).toBe('fair');
  });

  it('view 保留 as-of 與 source', () => {
    const view = buildValuationView({
      symbol: '2330', asOf: '2026-09-18', source: 'twse_bwibbu',
      pe: 28.52, pb: 9.92, dividendYield: 0.89,
      history: { pe: [], pb: [], dividendYield: [] },
    });
    expect(view.asOf).toBe('2026-09-18');
    expect(view.source).toBe('twse_bwibbu');
    expect(view.peerInsufficient).toBe(true);
  });
});
