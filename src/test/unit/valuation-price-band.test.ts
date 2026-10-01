/**
 * VALUATION_PRICE_BAND_V1 —— 三把尺換算歷史估值參考區間。
 *
 * 真實向量：3443 創意 / 2882 國泰金，2026-09-23 估值日（tw_valuation_daily）
 * 與同日收盤價（daily_price_snapshots）。歷史分布以「線性 ramp 使 30/70 分位
 * 精確等於 DB percentile_cont 實測值」重建（DB 讀回值見下方常數），避免把 5 年逐日數列寫死。
 */
import { describe, expect, it } from 'vitest';
import {
  buildValuationPriceBand,
  priceVsBandText,
  roundPrice,
  quantile,
  type PriceBandInput,
} from '@/checkup/lib/valuationRulers';

/** 產生 n 點線性序列，使其 30/70 分位（linear interpolation）恰為 q30/q70。 */
function rampFor(q30: number, q70: number, n = 1208): number[] {
  const span = (q70 - q30) / 0.4;
  const a = q30 - 0.3 * span;
  return Array.from({ length: n }, (_, i) => a + (span * i) / (n - 1));
}

// DB 讀回（2021-10-01 ~ 2026-09-23，n=1208）
const REAL = {
  '3443': {
    asOf: '2026-09-23', close: 8385, pe: 214.94, pb: 83.45, dy: 0.24,
    q: { pe: [42.99, 55.137], pb: [14.831, 21.869], dy: [0.87, 1.2] },
  },
  '2882': {
    asOf: '2026-09-23', close: 111.5, pe: 13.15, pb: 1.61, dy: 3.14,
    q: { pe: [8.805, 14.87], pb: [1.07, 1.28], dy: [3.061, 5.33] },
  },
} as const;

function inputFor(code: keyof typeof REAL, over: Partial<PriceBandInput> = {}): PriceBandInput {
  const r = REAL[code];
  return {
    asOf: r.asOf,
    closeAtAsOf: r.close,
    pe: r.pe,
    pb: r.pb,
    dividendYield: r.dy,
    history: {
      pe: rampFor(r.q.pe[0], r.q.pe[1]),
      pb: rampFor(r.q.pb[0], r.q.pb[1]),
      dividendYield: rampFor(r.q.dy[0], r.q.dy[1]),
    },
    ...over,
  };
}

const near = (a: number | null, b: number, tol = 0.005) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b) / b).toBeLessThan(tol);
};

describe('rampFor 重建分位', () => {
  it('30/70 分位與 DB 實測一致', () => {
    const h = rampFor(42.99, 55.137);
    expect(quantile(h, 0.3)).toBeCloseTo(42.99, 6);
    expect(quantile(h, 0.7)).toBeCloseTo(55.137, 6);
  });
});

describe('buildValuationPriceBand — 真實向量', () => {
  it('3443 創意：三尺交集 NT$1,677–2,151，現價 8,385 高於上緣', () => {
    const b = buildValuationPriceBand(inputFor('3443'));
    expect(b.status).toBe('consensus');
    expect(b.validCount).toBe(3);
    const [pe, pb, dy] = b.ranges;
    near(pe.low, 1677); near(pe.high, 2151);
    near(pb.low, 1490); near(pb.high, 2197);
    near(dy.low, 1677); near(dy.high, 2313);
    near(b.low, 1677); near(b.high, 2151);
    expect(priceVsBandText(8385, b)).toMatch(/高於區間上緣 29\d%/);
  });

  it('2882 國泰金：三尺交集 NT$74.7–88.6', () => {
    const b = buildValuationPriceBand(inputFor('2882'));
    expect(b.status).toBe('consensus');
    near(b.low, 74.7); near(b.high, 88.6);
    expect(priceVsBandText(111.5, b)).toMatch(/高於區間上緣/);
  });

  it('殖利率上下界反轉：q70（高殖利率）對應下界', () => {
    const b = buildValuationPriceBand(inputFor('3443'));
    const dy = b.ranges[2];
    expect(dy.low! < dy.high!).toBe(true);
    expect(dy.low).toBeCloseTo(dy.base! / (dy.q70! / 100), 6);
  });
});

describe('buildValuationPriceBand — 規則', () => {
  it('缺同日收盤價 → insufficient，不回退', () => {
    const b = buildValuationPriceBand(inputFor('3443', { closeAtAsOf: null }));
    expect(b.status).toBe('insufficient');
    expect(b.reason).toContain('2026/09/23 收盤價');
    expect(b.low).toBeNull();
  });

  it('EPS<=0 排除 P/E，其餘兩尺仍可合成', () => {
    const b = buildValuationPriceBand(inputFor('3443', { pe: -5 }));
    expect(b.ranges[0].low).toBeNull();
    expect(b.validCount).toBe(2);
    expect(b.status).toBe('consensus');
  });

  it('未配息排除殖利率尺', () => {
    const b = buildValuationPriceBand(inputFor('3443', { dividendYield: 0 }));
    expect(b.ranges[2].low).toBeNull();
    expect(b.ranges[2].ruler.naReason).toBe('no_dividend');
  });

  it('樣本 < 250 排除該尺；有效尺 < 2 → insufficient', () => {
    const inp = inputFor('3443');
    const b = buildValuationPriceBand({
      ...inp,
      history: { ...inp.history, pe: inp.history.pe.slice(0, 100), pb: inp.history.pb.slice(0, 100) },
    });
    expect(b.validCount).toBe(1);
    expect(b.status).toBe('insufficient');
    expect(b.reason).toContain('有效尺少於 2 把');
  });

  it('各尺無交集 → divergent，不給單一區間', () => {
    const inp = inputFor('3443');
    const b = buildValuationPriceBand({ ...inp, history: { ...inp.history, pb: rampFor(40, 45) } });
    expect(b.status).toBe('divergent');
    expect(b.low).toBeNull();
    expect(b.high).toBeNull();
  });

  it('交集寬度 < 中點 3% → divergent', () => {
    // P/E 1677–2151；P/B 調到 2130–2300 → 交集 2130–2151（約 1%）
    const inp = inputFor('3443');
    const bvps = 8385 / 83.45;
    const b = buildValuationPriceBand({ ...inp, history: { ...inp.history, pb: rampFor(2130 / bvps, 2300 / bvps) } });
    expect(b.status).toBe('divergent');
  });

  it('roundPrice：≥1000 個位、100–1000 0.5、<100 0.05', () => {
    expect(roundPrice(1676.6)).toBe(1677);
    expect(roundPrice(126.3)).toBe(126.5);
    expect(roundPrice(74.72)).toBe(74.7);
  });
});
