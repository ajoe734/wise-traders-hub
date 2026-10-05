import { describe, expect, it } from 'vitest';
import { selectedRulerBand } from './HoldingsDetailPanel';

const band = {
  rows: [
    { key: 'pe', low: 500, high: 700, multiples: { method: 'history', sampleSize: 5, period: '2021–2025' } },
    { key: 'pb', low: 600, high: 900, multiples: { method: 'peer', sampleSize: 8, period: 'TTM' } },
    { key: 'ps', low: null, high: null, reason: '缺營收分母' },
  ],
};

describe('selectedRulerBand：單尺選擇', () => {
  it('目標價模式不畫估值區間', () => {
    expect(selectedRulerBand(band, 'target')).toBeNull();
  });
  it('歷史倍數只稱「歷史情境參考」，並列樣本數與期間', () => {
    expect(selectedRulerBand(band, 'pe')).toEqual({
      low: 500, high: 700, key: 'pe', label: 'PE 歷史情境參考', detail: '5 個獨立期 · 2021–2025',
    });
  });
  it('同業倍數標為同業情境', () => {
    expect(selectedRulerBand(band, 'pb')?.label).toBe('PB 同業情境');
  });
  it('資料不足、反向或零值區間一律不畫', () => {
    expect(selectedRulerBand(band, 'ps')).toBeNull();
    expect(selectedRulerBand({ rows: [{ key: 'pe', low: 700, high: 500 }] }, 'pe')).toBeNull();
    expect(selectedRulerBand({ rows: [{ key: 'pe', low: 0, high: 500 }] }, 'pe')).toBeNull();
    expect(selectedRulerBand(null, 'pe')).toBeNull();
  });
});
