import { describe, it, expect } from 'vitest';
import { buildDumbbellRows } from './StackedValuationDumbbell';

const rulers = { ps: { low: 397, mid: 751, high: 1110 }, pe: { low: 330, mid: 520, high: 780 }, pb: { reason: '分母未核實' } };
const rows = buildDumbbellRows({
  mainKey: 'pe', rulerOf: (k) => rulers[k],
  forward: { status: 'ready', mode: 'historical', low: 380, price: 719, high: 1063 },
  peer: { status: 'insufficient', reason: '同業僅 2 家' },
});

describe('buildDumbbellRows', () => {
  it('主尺排第一列並標記', () => {
    expect(rows[0]).toMatchObject({ key: 'pe', main: true, lo: 330, hi: 780 });
  });
  it('無分母的尺不畫區間，只留原因', () => {
    expect(rows.find((r) => r.key === 'pb')).toEqual({ key: 'pb', name: 'PB 淨值比', main: false, missing: '分母未核實' });
  });
  it('同業不足時不畫點', () => {
    expect(rows.find((r) => r.key === 'peer')).toMatchObject({ missing: '同業僅 2 家' });
  });
  it('前瞻歷史倍數畫低中高三點，數值原樣沿用', () => {
    expect(rows.find((r) => r.key === 'forward')).toMatchObject({ lo: 380, mid: 719, hi: 1063 });
  });
  it('共五列：三把尺＋前瞻＋同業', () => {
    expect(rows.map((r) => r.key)).toEqual(['pe', 'ps', 'pb', 'forward', 'peer']);
  });
});
