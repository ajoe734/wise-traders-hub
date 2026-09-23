/**
 * VALUATION_PEER_CHARTS_V1 —— 同業明細圖表純函式。
 * 鎖死：分布母體＝computePeerStat 的有效值口徑、不足 3 家回 insufficient、
 *       winsorize 後才分桶（單一極端值不得把所有人擠到第一格）、趨勢點數門檻。
 */
import { describe, expect, it } from 'vitest';
import {
  buildPeerDistribution,
  buildTrendSeries,
  buildValuationView,
  TREND_MIN_POINTS,
  type PeerRow,
  type TrendPoint,
} from '@/checkup/lib/valuationRulers';

const peers: PeerRow[] = [
  { symbol: 'A', name: 'A', pe: 10, pb: 1, dividendYield: 2 },
  { symbol: 'B', name: 'B', pe: 14, pb: 1.2, dividendYield: 3 },
  { symbol: 'C', name: 'C', pe: 18, pb: 1.4, dividendYield: 4 },
  { symbol: 'D', name: 'D', pe: 22, pb: 1.6, dividendYield: 5 },
  { symbol: 'E', name: 'E', pe: 400, pb: 1.8, dividendYield: 6 },
];

function trend(n: number, from = 10, to = 20): TrendPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-${String((i % 12) + 1).padStart(2, '0')}-28`,
    pe: from + ((to - from) * i) / Math.max(1, n - 1),
    pb: 1 + i * 0.01,
    dividendYield: 3,
  }));
}

describe('buildPeerDistribution', () => {
  it('同業不足 3 家 → insufficient，且不產生任何桶', () => {
    const d = buildPeerDistribution('pe', 20, peers.slice(0, 2));
    expect(d.insufficient).toBe(true);
    expect(d.buckets).toHaveLength(0);
    expect(d.n).toBe(2);
  });

  it('極端值 winsorize 後分桶，本檔與中位數各自標記', () => {
    const d = buildPeerDistribution('pe', 20, peers);
    expect(d.insufficient).toBe(false);
    expect(d.n).toBe(5);
    expect(d.total).toBe(6); // 5 同業 + 本檔
    expect(d.buckets).toHaveLength(5);
    expect(d.buckets.reduce((s, b) => s + b.count, 0)).toBe(6);
    // 極端值 400 被夾回 95% 邊界，不得讓其他 5 檔全擠在第一桶
    expect(d.buckets[0].count).toBeLessThan(6);
    expect(d.buckets.filter((b) => b.hasSelf)).toHaveLength(1);
    expect(d.buckets.filter((b) => b.hasMedian)).toHaveLength(1);
    expect(d.selfBucket).not.toBeNull();
  });

  it('本檔值無效（PE 缺值）→ 仍畫同業分布，但沒有本檔標記', () => {
    const d = buildPeerDistribution('pe', null, peers);
    expect(d.insufficient).toBe(false);
    expect(d.selfValue).toBeNull();
    expect(d.selfBucket).toBeNull();
    expect(d.buckets.some((b) => b.hasSelf)).toBe(false);
    expect(d.total).toBe(5);
  });

  it('殖利率 0（無配息）不計入母體', () => {
    const rows: PeerRow[] = [
      { symbol: 'A', name: 'A', pe: 10, pb: 1, dividendYield: 0 },
      { symbol: 'B', name: 'B', pe: 10, pb: 1, dividendYield: 3 },
      { symbol: 'C', name: 'C', pe: 10, pb: 1, dividendYield: 4 },
    ];
    expect(buildPeerDistribution('dividendYield', 2, rows).insufficient).toBe(true);
  });

  it('所有值相同時仍能分桶且不產生 NaN 邊界', () => {
    const rows: PeerRow[] = ['A', 'B', 'C'].map((s) => ({ symbol: s, name: s, pe: 12, pb: 1, dividendYield: 2 }));
    const d = buildPeerDistribution('pe', 12, rows);
    expect(d.insufficient).toBe(false);
    expect(d.buckets.every((b) => Number.isFinite(b.from) && Number.isFinite(b.to))).toBe(true);
    expect(d.buckets.reduce((s, b) => s + b.count, 0)).toBe(4);
  });
});

describe('buildTrendSeries', () => {
  it(`點數 < ${TREND_MIN_POINTS} → 資料不足`, () => {
    const s = buildTrendSeries('pe', trend(TREND_MIN_POINTS - 1));
    expect(s.insufficient).toBe(true);
    expect(s.rangeText).toBe('資料不足');
  });

  it('依日期排序，輸出最低／最高／最新', () => {
    const pts = trend(12, 10, 20).slice().reverse();
    const s = buildTrendSeries('pe', pts);
    expect(s.insufficient).toBe(false);
    expect(s.points[0].date < s.points[s.points.length - 1].date).toBe(true);
    expect(s.min).toBeCloseTo(10, 6);
    expect(s.max).toBeCloseTo(20, 6);
    expect(s.latest).toBeCloseTo(s.points[s.points.length - 1].value, 6);
    expect(s.rangeText).toContain('最新');
  });

  it('剔除無效值（PE <= 0 / null）', () => {
    const pts: TrendPoint[] = [
      { date: '2026-01-28', pe: -3, pb: 1, dividendYield: 2 },
      { date: '2026-02-28', pe: null, pb: 1, dividendYield: 2 },
      { date: '2026-03-28', pe: 12, pb: 1, dividendYield: 2 },
      { date: '2026-04-28', pe: 13, pb: 1, dividendYield: 2 },
      { date: '2026-05-28', pe: 14, pb: 1, dividendYield: 2 },
      { date: '2026-06-28', pe: 15, pb: 1, dividendYield: 2 },
    ];
    const s = buildTrendSeries('pe', pts);
    expect(s.points).toHaveLength(4);
    expect(s.min).toBe(12);
  });

  it('殖利率 0 視為有效點（有資料但無配息）', () => {
    const pts: TrendPoint[] = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-0${i + 1}-28`,
      pe: 10,
      pb: 1,
      dividendYield: 0,
    }));
    expect(buildTrendSeries('dividendYield', pts).insufficient).toBe(false);
  });
});

describe('buildValuationView 掛上圖表資料', () => {
  it('三把尺各有一組分布與趨勢', () => {
    const view = buildValuationView({
      symbol: '3443',
      asOf: '2026-09-18',
      source: 'twse_bwibbu',
      pe: 20,
      pb: 1.5,
      dividendYield: 3,
      history: { pe: [], pb: [], dividendYield: [] },
      peers,
      trend: trend(24),
    });
    expect(view.distributions.map((d) => d.key)).toEqual(['pe', 'pb', 'dividendYield']);
    expect(view.trends.map((t) => t.key)).toEqual(['pe', 'pb', 'dividendYield']);
    expect(view.distributions[0].insufficient).toBe(false);
    expect(view.trends[0].insufficient).toBe(false);
  });

  it('沒有 trend 欄位（舊 payload）→ 趨勢為資料不足，不得拋錯', () => {
    const view = buildValuationView({
      symbol: 'X',
      asOf: null,
      source: null,
      pe: 20,
      pb: 1.5,
      dividendYield: 3,
      history: { pe: [], pb: [], dividendYield: [] },
      peers,
    });
    expect(view.trends.every((t) => t.insufficient)).toBe(true);
  });
});
