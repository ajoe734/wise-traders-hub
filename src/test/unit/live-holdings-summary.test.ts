import { describe, expect, it } from 'vitest';
import { buildLiveHoldingsSummary, summaryGaugeRange } from '@/checkup/lib/liveHoldingsSummary';

describe('live summary presentation projection', () => {
  it('keeps ledger cost including fees rather than recalculating it from rows', () => {
    const s = buildLiveHoldingsSummary([{ code: '2330', value: 12000 }], 10234, 12000, {});
    expect(s.cost).toBe(10234); expect(s.value).toBe(12000); expect(s.pnl).toBe(1766);
    expect(s.pnlPct).toBeCloseTo(1766 / 10234 * 100);
  });
  it('preserves revenue-weighted industries rather than assigning the whole stock to one industry', () => {
    const s = buildLiveHoldingsSummary([{ code: '2330', value: 10000 }], 8000, 10000, {}, { '2330': { industries: ['晶圓代工', 'IC 設計'], revenue_mix: [{ industry: '晶圓代工', pct: 70 }, { industry: 'IC 設計', pct: 30 }] } });
    expect(s.industries.map((r) => [r.name, r.value, r.cells, r.count])).toEqual([['晶圓代工', 7000, 70, 1], ['IC 設計', 3000, 30, 1]]);
  });
  it('uses equal splits without revenue proportions and allocates exactly 100 units', () => {
    const s = buildLiveHoldingsSummary([{ code: '2330', value: 100 }], 100, 100, {}, { '2330': { industries: ['晶圓代工', 'IC 設計', '散熱'] } });
    expect(s.industries.map((r) => r.cells)).toEqual([34, 33, 33]);
    expect(s.industries.reduce((a, r) => a + r.value, 0)).toBeCloseTo(100);
  });
  it('never manufactures cells or percentage on empty/zero-value portfolios', () => {
    for (const holdings of [[], [{ code: '2330', value: 0 }]]) {
      const s = buildLiveHoldingsSummary(holdings, 0, 0, {});
      expect(s.industries.reduce((a, r) => a + r.cells, 0)).toBe(0);
      expect(s.pnlPct).toBe(0);
    }
  });
  it('counts one dot per holding for all three classifications and exposes unknown metadata', () => {
    const s = buildLiveHoldingsSummary([{ code: '2330', value: 100 }, { code: 'unknown', value: 100 }], 200, 200, { '2330': { strategy: '趨勢', period: '中長', position: '核心' } });
    expect(s.period).toEqual([['中長期', 1], ['未分類', 1]]);
    expect(s.position).toEqual([['核心', 1], ['未分類', 1]]);
    for (const rows of [s.strategy, s.period, s.position]) expect(rows.reduce((sum, [, n]) => sum + n, 0)).toBe(2);
  });
  it('uses the real count of stocks in concentration warnings', () => {
    const s = buildLiveHoldingsSummary([{ code: '2330', value: 1 }, { code: '2454', value: 1 }, { code: '3443', value: 1 }, { code: '2881', value: 97 }], 100, 100, {}, {
      '2330': { industries: ['晶圓代工'], revenue_mix: [{ industry: '晶圓代工', pct: 100 }] }, '2454': { industries: ['晶圓代工'], revenue_mix: [{ industry: '晶圓代工', pct: 100 }] }, '3443': { industries: ['晶圓代工'], revenue_mix: [{ industry: '晶圓代工', pct: 100 }] }, '2881': { industries: ['金融'], revenue_mix: [{ industry: '金融', pct: 100 }] },
    });
    expect(s.warnings).toContain('晶圓代工(3檔)'); expect(s.warnings).toContain('金融(1檔)');
  });
  it('keeps route-provided missing-price exclusions in totals without hiding the holding count', () => {
    const s = buildLiveHoldingsSummary([{ code: '2330', value: 120 }, { code: '2454', value: 0, integrityIssue: 'missing-price' }], 100, 120, {});
    expect(s.cost).toBe(100); expect(s.pnl).toBe(20); expect(s.count).toBe(2);
  });
  it.each([[7.67, 30], [-30, 30], [31, 60], [-85, 90], [350, 360]])('does not clip %s percent into a false ±30 scale', (pct, range) => {
    expect(summaryGaugeRange(pct)).toBe(range);
  });
});