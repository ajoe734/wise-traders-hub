import { describe, it, expect } from 'vitest';
import {
  resolveKlineLayout,
  yUnitsFor,
  unitsToPx,
  resistanceLabelTop,
  KLINE_CHART_HEIGHT,
  KLINE_TOP_SAFE_INSET,
  KLINE_BOTTOM_SAFE_INSET,
  KLINE_LABEL_HEIGHT,
  KLINE_MARKER_HEIGHT,
  KLINE_SAFE_GAP,
  KLINE_VIEWBOX_H,
} from './klineLayout';

const domain = { lo: 2410, hi: 2790 };
const layout = resolveKlineLayout();

describe('klineLayout — safe bounds', () => {
  it('plot 高度足夠且 inset 生效', () => {
    expect(layout.height).toBe(KLINE_CHART_HEIGHT);
    expect(KLINE_CHART_HEIGHT).toBe(92);
    expect(layout.plotTopPx).toBe(KLINE_TOP_SAFE_INSET);
    expect(layout.plotBottomPx).toBe(KLINE_CHART_HEIGHT - KLINE_BOTTOM_SAFE_INSET);
    expect(layout.plotBottomPx - layout.plotTopPx).toBeGreaterThanOrEqual(48);
  });

  it('最高價不貼頂、最低價不貼底（保留 headroom/footroom）', () => {
    const topPx = unitsToPx(yUnitsFor(domain.hi, domain, layout), layout);
    const botPx = unitsToPx(yUnitsFor(domain.lo, domain, layout), layout);
    expect(topPx).toBeCloseTo(KLINE_TOP_SAFE_INSET, 5);
    expect(botPx).toBeCloseTo(KLINE_CHART_HEIGHT - KLINE_BOTTOM_SAFE_INSET, 5);
    expect(topPx).toBeGreaterThanOrEqual(KLINE_LABEL_HEIGHT + KLINE_SAFE_GAP);
    expect(KLINE_CHART_HEIGHT - botPx).toBeGreaterThanOrEqual(KLINE_SAFE_GAP);
  });

  it('所有價位都落在 plot safe bounds 內（含越界輸入）', () => {
    for (const v of [domain.lo - 500, domain.lo, 2600, domain.hi, domain.hi + 500]) {
      const px = unitsToPx(yUnitsFor(v, domain, layout), layout);
      expect(px).toBeGreaterThanOrEqual(layout.plotTopPx - 1e-6);
      expect(px).toBeLessThanOrEqual(layout.plotBottomPx + 1e-6);
    }
  });

  it('退化 domain 回傳中線，不 NaN', () => {
    expect(yUnitsFor(10, { lo: 5, hi: 5 }, layout)).toBe(KLINE_VIEWBOX_H / 2);
    expect(Number.isFinite(unitsToPx(yUnitsFor(NaN, domain, layout), layout))).toBe(true);
  });
});

describe('klineLayout — 壓力標籤與最高 K 棒不碰撞', () => {
  const highWickTop = unitsToPx(yUnitsFor(domain.hi, domain, layout), layout);

  it('壓力帶貼齊最高價時，標籤仍在圖內且與最高 wick 間距 ≥ SAFE_GAP', () => {
    const zoneTopUnits = yUnitsFor(domain.hi, domain, layout);
    const labelTop = resistanceLabelTop(zoneTopUnits, layout);
    expect(labelTop).toBeGreaterThanOrEqual(0);
    const labelBottom = labelTop + KLINE_LABEL_HEIGHT;
    expect(highWickTop - labelBottom).toBeGreaterThanOrEqual(KLINE_SAFE_GAP - 1e-6);
  });

  it('壓力帶在中段時標籤也不越界', () => {
    for (const price of [2450, 2600, 2700, 2775, 2790]) {
      const labelTop = resistanceLabelTop(yUnitsFor(price, domain, layout), layout);
      expect(labelTop).toBeGreaterThanOrEqual(0);
      expect(labelTop + KLINE_LABEL_HEIGHT).toBeLessThanOrEqual(layout.height);
      // 不論壓力帶落在哪，標籤底緣都必須高於最高 wick 至少 SAFE_GAP
      expect(highWickTop - (labelTop + KLINE_LABEL_HEIGHT)).toBeGreaterThanOrEqual(KLINE_SAFE_GAP - 1e-6);
    }
  });

  it('棒上 marker 的視覺高度可被 top inset 容納（不被裁切）', () => {
    const anchorPx = unitsToPx(yUnitsFor(domain.hi, domain, layout), layout);
    const markerTop = anchorPx - 3 - KLINE_MARKER_HEIGHT + 3; // -3 offset + translateY(-100%)
    expect(markerTop).toBeGreaterThanOrEqual(0);
  });

  it('棒下 marker 不超出圖表底部', () => {
    const anchorPx = unitsToPx(yUnitsFor(domain.lo, domain, layout), layout);
    expect(anchorPx + 3 + KLINE_MARKER_HEIGHT).toBeLessThanOrEqual(layout.height);
  });
});

describe('klineLayout — 折線模式（無 inset）維持全幅', () => {
  const flat = resolveKlineLayout({ topInset: 0, bottomInset: 0 });
  it('padding 為 0 時 plot 佔滿 viewBox', () => {
    expect(flat.plotH).toBe(KLINE_VIEWBOX_H);
    expect(unitsToPx(yUnitsFor(domain.hi, domain, flat), flat)).toBe(0);
    expect(unitsToPx(yUnitsFor(domain.lo, domain, flat), flat)).toBe(flat.height);
  });
});
