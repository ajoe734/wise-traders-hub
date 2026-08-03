import { describe, it, expect } from 'vitest';
import {
  rollingLots, buildTooltipRows, resistanceBadge, buildVolumeMetrics,
} from '../volumeReadout';

const mk = (n: number, vol: number | null = 1000) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i,
    volumeLots: vol == null ? null : vol + i,
  }));

describe('rollingLots', () => {
  it('視窗不足回 null，足夠回平均', () => {
    const r = rollingLots(mk(6), 5);
    expect(r.slice(0, 4)).toEqual([null, null, null, null]);
    expect(r[4]).toBeCloseTo(1002);
    expect(r[5]).toBeCloseTo(1003);
  });
  it('視窗內任一缺量即 null', () => {
    const bars = mk(6);
    bars[2].volumeLots = null;
    expect(rollingLots(bars, 5)[4]).toBeNull();
  });
});

describe('buildTooltipRows', () => {
  const bars = mk(25);
  const ma5 = rollingLots(bars, 5);
  const ma20 = rollingLots(bars, 20);

  it('hover 與 keyboard 取同一 index 得到完全相同內容', () => {
    const a = buildTooltipRows(bars, 20, { ma5, ma20 });
    const b = buildTooltipRows(bars, 20, { ma5, ma20 });
    expect(a).toEqual(b);
  });

  it('包含日期、OHLC、漲跌、量、MA5、MA20、相對量能', () => {
    const t = buildTooltipRows(bars, 20, { ma5, ma20 })!;
    expect(t.date).toBe('2026-07-21');
    expect(t.rows.map((r) => r.key)).toEqual(['oh', 'lc', 'chg', 'vol', 'ma5', 'ma20', 'rel']);
    expect(t.rows.find((r) => r.key === 'chg')!.value).toContain('+1.00');
    expect(t.rows.find((r) => r.key === 'rel')!.value).toMatch(/倍$/);
    expect(t.rows.find((r) => r.key === 'ma20')!.value).toMatch(/張$/);
  });

  it('第一根無前收 → 漲跌為 —；無量 → 量與相對量能為 —', () => {
    const noVol = mk(3, null);
    const t = buildTooltipRows(noVol, 0)!;
    expect(t.rows.find((r) => r.key === 'chg')!.value).toBe('—');
    expect(t.rows.find((r) => r.key === 'vol')!.value).toBe('—');
    expect(t.rows.find((r) => r.key === 'rel')!.value).toBe('—');
  });

  it('index 越界回 null', () => {
    expect(buildTooltipRows(bars, 999)).toBeNull();
  });
});

describe('resistanceBadge', () => {
  const zone = { lower: 100, upper: 104, basis: 'cluster' as const };

  it('三種狀態各有可讀文字，不只靠顏色', () => {
    const below = resistanceBadge({ zone, distance: { pct: 0.03, state: 'below' }, domain: { low: 90, high: 110 } });
    const testing = resistanceBadge({ zone, distance: { pct: 0, state: 'testing' }, domain: { low: 90, high: 110 } });
    const above = resistanceBadge({ zone, distance: { pct: 0.02, state: 'above' }, domain: { low: 90, high: 110 } });
    const ref = resistanceBadge({ zone: { ...zone, basis: 'reference' }, distance: { pct: 0.1, state: 'below' }, domain: null });
    expect(below.label).toBe('有效壓力區');
    expect(testing.label).toBe('測試壓力');
    expect(above.label).toBe('已突破');
    expect(ref.label).toBe('參考壓力');
    expect(new Set([below.state, testing.state, above.state, ref.state]).size).toBe(4);
  });

  it('壓力高於或低於 y 值域時標記 offDomain 並給文字', () => {
    const hi = resistanceBadge({ zone: { lower: 200, upper: 210, basis: 'cluster' }, distance: { pct: 0.5, state: 'below' }, domain: { low: 90, high: 110 } });
    expect(hi.offDomain).toBe(true);
    expect(hi.offDomainText).toBe('高於 30 日區間');
    const lo = resistanceBadge({ zone: { lower: 10, upper: 20, basis: 'cluster' }, distance: { pct: 0.5, state: 'above' }, domain: { low: 90, high: 110 } });
    expect(lo.offDomainText).toBe('低於 30 日區間');
    const inside = resistanceBadge({ zone, distance: null, domain: { low: 90, high: 110 } });
    expect(inside.offDomain).toBe(false);
  });

  it('無壓力區時給單一說明', () => {
    const b = resistanceBadge({ zone: null, distance: null, domain: { low: 1, high: 2 } });
    expect(b.state).toBe('none');
    expect(b.rangeText).toBeNull();
  });
});

describe('buildVolumeMetrics', () => {
  const badge = resistanceBadge({ zone: { lower: 100, upper: 104, basis: 'cluster' }, distance: { pct: 0.03, state: 'below' }, domain: { low: 90, high: 110 } });

  it('有量時 5 個 metric', () => {
    const m = buildVolumeMetrics({
      stats: { todayLabel: '今日量', todayLots: 1200, ma5Lots: 1000, ma20Lots: 900, relVolume: 1.33 },
      badge, hasVolume: true,
    });
    expect(m.map((x) => x.key)).toEqual(['today', 'ma5', 'ma20', 'rel', 'resistance']);
  });

  it('無量時只留壓力，不堆 0/5、0/20、相對量能 —', () => {
    const m = buildVolumeMetrics({ stats: null, badge, hasVolume: false });
    expect(m.map((x) => x.key)).toEqual(['resistance']);
    expect(JSON.stringify(m)).not.toContain('相對量能');
  });
});
