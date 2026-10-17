import { describe, expect, it } from 'vitest';
import { selectedRulerBand, buildDrawerStations } from './HoldingsDetailPanel';

// 240 日 PE 序列 60..119.75（線性），P20/P80 可預期
const peHist = Array.from({ length: 240 }, (_, i) => 60 + i * 0.25);
const view = { industry: '半導體', rulers: [{ key: 'pe', value: 70 }], rawHistory: { pe: peHist, pb: peHist.map((x) => x / 10) } };
const band = {
  rows: [
    { key: 'pe', basisOk: true, basis: { kind: 'reported', value: 39.01, period: '近四季' } },
    { key: 'pb', basisOk: true, basis: { kind: 'reported', value: 200, period: '最新一季' } },
    { key: 'ps', basisOk: false, basis: null, notApplicable: '缺營收分母' },
  ],
  nextQuarter: { quarter: '2026Q3', estEps: 48.21, pe: 48.21, ps: null, months: ['2026-07', '2026-08', '2026-09'], latestEps: 10, ratio: 1.2 },
};

describe('selectedRulerBand：與站牌同一口徑', () => {
  it('目標價、站牌模式不畫', () => {
    expect(selectedRulerBand(band, 'target', view)).toBeNull();
    expect(selectedRulerBand(band, 'stations', view)).toBeNull();
  });
  it('創意 PE：分母用近三季＋推估一季 48.21，區間＝站牌上車站到高壓站', () => {
    const r: any = selectedRulerBand(band, 'pe', view);
    const st: any = buildDrawerStations(view, band, '3443', 7480);
    expect(st.main.key).toBe('pe');
    expect(r.low).toBeCloseTo(st.stations.stations[0].price, 6);
    expect(r.mid).toBeCloseTo(st.stations.stations[1].price, 6);
    expect(r.high).toBeCloseTo(st.stations.stations[2].price, 6);
    expect(r.low / 48.21).toBeGreaterThan(70);
    expect(r.label).toBe('PE 近一年區間（含月營收推估一季）');
  });
  it('PB 不推估，用最新一季淨值', () => {
    const r: any = selectedRulerBand(band, 'pb', view);
    expect(r.label).toBe('PB 近一年區間');
    expect(r.low / 200).toBeCloseTo(r.low / 200, 6);
  });
  it('分母缺漏時不畫並帶原因', () => {
    expect(selectedRulerBand(band, 'ps', view)).toEqual({ reason: '缺營收分母' });
  });
  it('推估季申報期限已過：PE 回 stale 原因', () => {
    const stale = { ...band, nextQuarter: { stale: true, quarter: '2026Q3', deadline: '2026-11-14', reason: '2026Q3 財報申報期限已過' } };
    expect((selectedRulerBand(stale, 'pe', view) as any).reason).toContain('申報期限已過');
  });
});
