import { describe, it, expect } from 'vitest';
import { resolveKlineXScale, KLINE_SLOTS, KLINE_BAR_MAX_W } from './klineXScale';
import { resolvePartialSeries, PARTIAL_BAR_THRESHOLD } from './partialSeries';

const PAD = 2.4;
const RIGHT = 100 - PAD;

describe('klineXScale — 固定 30 slot、靠右對齊', () => {
  for (const n of [1, 2, 4, 30]) {
    it(`N=${n}：最新一根貼右緣、bar 寬與 N=30 相同`, () => {
      const s = resolveKlineXScale({ count: n, padX: PAD });
      const full = resolveKlineXScale({ count: 30, padX: PAD });
      expect(s.slotCount).toBe(KLINE_SLOTS);
      expect(s.xAt(n - 1)).toBeCloseTo(RIGHT, 6);
      expect(s.bodyW).toBeCloseTo(full.bodyW, 6);
      expect(s.bodyW).toBeLessThanOrEqual(KLINE_BAR_MAX_W);
      // 所有 x 都在 plot 範圍內，且不會出現在最左（除非資料滿 30 根）
      for (let i = 0; i < n; i += 1) {
        expect(s.xAt(i)).toBeGreaterThanOrEqual(PAD - 1e-9);
        expect(s.xAt(i)).toBeLessThanOrEqual(RIGHT + 1e-9);
      }
      if (n < 30) expect(s.xAt(0)).toBeGreaterThan(PAD + 1);
    });
  }

  it('N=2 不再被分置左右兩端（間距 = 單一 slot 寬）', () => {
    const s = resolveKlineXScale({ count: 2, padX: PAD });
    expect(s.xAt(1) - s.xAt(0)).toBeCloseTo(s.step, 6);
    expect(s.xAt(1) - s.xAt(0)).toBeLessThan(5);
  });

  it('資料超過 30 根時 slot 數跟著資料走', () => {
    const s = resolveKlineXScale({ count: 65, padX: PAD });
    expect(s.slotCount).toBe(65);
    expect(s.xAt(64)).toBeCloseTo(RIGHT, 6);
  });

  it('indexAtRatio 只回傳有效索引，並在資料區外夾住', () => {
    const s = resolveKlineXScale({ count: 2, padX: PAD });
    expect(s.indexAtRatio(0)).toBe(0);
    expect(s.indexAtRatio(1)).toBe(1);
    expect(s.indexAtRatio(0.5)).toBe(0);
    expect(resolveKlineXScale({ count: 0, padX: PAD }).indexAtRatio(0.5)).toBeNull();
  });
});

describe('partialSeries — 單一提示', () => {
  it('N<5 進 partial，且只有一句提示', () => {
    for (let n = 1; n < PARTIAL_BAR_THRESHOLD; n += 1) {
      const st = resolvePartialSeries(n);
      expect(st.partial).toBe(true);
      expect(st.full).toBe(false);
      expect(st.text).toBe(`日 K 資料暫時不完整（${n}/30），均量與壓力暫不判讀`);
    }
  });

  it('N>=5 離開 partial；N>=20 回復完整 metrics', () => {
    expect(resolvePartialSeries(5).partial).toBe(false);
    expect(resolvePartialSeries(5).full).toBe(false);
    expect(resolvePartialSeries(20).full).toBe(true);
    expect(resolvePartialSeries(30).text).toBeNull();
  });

  it('N=0 不顯示 partial 提示（走既有 empty state）', () => {
    expect(resolvePartialSeries(0).partial).toBe(false);
    expect(resolvePartialSeries(0).text).toBeNull();
  });
});
