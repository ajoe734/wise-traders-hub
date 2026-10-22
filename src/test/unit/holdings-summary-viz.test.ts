import { describe, expect, it } from 'vitest';
import { buildSummary } from '@/lib/holdingsSummaryViz';

const h = (code: string, industry: string, cost: number, value: number) => ({ code, name: code, industry, strategy: '趨勢', period: '中', position: '核心', cost, value });

describe('buildSummary', () => {
  it('百格方陣加總恰為 100 格', () => {
    const s = buildSummary([h('a', 'X', 1, 1), h('b', 'Y', 1, 1), h('c', 'Z', 1, 1)]);
    expect(s.industries.reduce((a, r) => a + r.cells, 0)).toBe(100);
  });
  it('損益 = 市值 − 成本', () => {
    const s = buildSummary([h('a', 'X', 100, 130), h('b', 'Y', 100, 80)]);
    expect(s.pnl).toBe(10);
    expect(s.pnlPct).toBe(5);
  });
  it('單一產業佔比超過 25% 即提醒', () => {
    const s = buildSummary([h('a', 'X', 1, 70), h('b', 'Y', 1, 30)]);
    expect(s.warnings).toEqual(['X(1檔)', 'Y(1檔)']);
  });
});
