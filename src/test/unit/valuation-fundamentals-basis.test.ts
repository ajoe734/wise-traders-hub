import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/finmind/3443-2026-10-01.json';
import {
  buildScenarioRows, computeCompanyBasis, historyPoints, statutoryDeadline, type FinRow,
} from '../../../supabase/functions/_shared/fundamentalsBasis';
import { buildValuationScenario } from '@/checkup/lib/valuationScenario';
import { scenarioFromFundamentals } from '@/checkup/hooks/useValuationSnapshot';

const fs = fixture.fs as FinRow[];
const bs = fixture.bs as FinRow[];
const px = fixture.px as Array<{ date: string; close: number }>;
const AS_OF = '2026-10-01';

describe('3443 real FinMind fixture (2026-10-01)', () => {
  const b = computeCompanyBasis('3443', fs, bs, AS_OF);
  it('denominators match hand calculation from raw statements', () => {
    expect(b.ok).toBe(true);
    expect(b.period).toBe('2025-09-30～2026-06-30（近四季）');
    expect(b.publishedAt).toBe('2026-08-14');
    // 866,875+1,159,658+1,646,240+1,555,257 千元 = 5,228,030,000
    expect(b.niTtm).toBe(5228030000);
    expect(b.sharesEnd).toBe(134011900); // 股本 1,340,119,000 ÷ 10
    expect(b.shareChange).toBe(false);
    expect(b.eps).toBeCloseTo(5228030000 / 134011900, 6); // 39.01
    expect(b.reportedEpsSum).toBeCloseTo(39.01, 2); // 6.47+8.65+12.28+11.61
    expect(b.bvps).toBeCloseTo(13465348000 / 134011900, 6); // 100.48
    expect(b.revenueTtm).toBe(8613108000 + 12399649000 + 11447812000 + 13896557000);
    expect(b.sps).toBeCloseTo(46357126000 / 134011900, 6); // 345.92
  });
  it('history multiples use same-regime quarters and the scenario matches hand math', () => {
    const hist = historyPoints('3443', fs, bs, px, AS_OF);
    const rows = buildScenarioRows(b, [], 'rule', hist);
    const pe = rows[0].multiples!;
    expect(pe.sampleSize).toBe(4);
    const p2311 = hist.find((h) => h.publishedAt === '2023-11-14')!;
    expect(p2311.close).toBe(1735);
    expect(pe.low).toBeCloseTo(1735 / p2311.eps!, 6); // 2023-11-14 收盤 ÷ 當時已公告 EPS
    const sc = buildValuationScenario(AS_OF, rows.map((r) => ({ key: r.key, basis: r.basis, multiples: r.multiples, notApplicable: r.notApplicable })));
    expect(sc.validCount).toBe(3);
    const lows = sc.rows.map((r) => r.low!);
    const highs = sc.rows.map((r) => r.high!);
    expect(sc.status).toBe('historical') // 舊版服務倍數來自本公司歷史，只能是歷史情境參考;
    expect(sc.low).toBeCloseTo(Math.max(...lows), 6);
    expect(sc.high).toBeCloseTo(Math.min(...highs), 6);
    expect(Math.round(sc.low!)).toBe(2872);
    expect(Math.round(sc.high!)).toBe(5465);
  });
  it('quarters not yet past statutory deadline are excluded', () => {
    expect(statutoryDeadline('2026-09-30')).toBe('2026-11-14');
    const early = computeCompanyBasis('3443', fs, bs, '2026-08-13');
    expect(early.publishedAt).toBe('2026-05-15');
  });
});

describe('edge cases', () => {
  const q = (date: string, ni: number, eps: number, rev: number, shares: number, eq = 1000): FinRow[] => [
    { date, type: 'EquityAttributableToOwnersOfParent', value: ni },
    { date, type: 'EPS', value: eps },
    { date, type: 'Revenue', value: rev },
  ];
  const bsq = (date: string, shares: number, eq = 50_000) => [
    { date, type: 'OrdinaryShare', value: shares * 10 },
    { date, type: 'EquityAttributableToOwnersOfParent', value: eq },
    { date, type: 'TotalAssets', value: 100_000 },
  ];
  const D = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'];
  it('loss → PE not applicable, PB/PS still computed', () => {
    const b = computeCompanyBasis('9999', D.flatMap((d) => q(d, -100, -0.1, 500, 1000)), D.flatMap((d) => bsq(d, 1000)), AS_OF);
    expect(b.notApplicable.pe).toMatch('≤ 0');
    expect(b.bvps).toBe(50);
  });
  it('share base change → uses average shares, never sums mismatched EPS', () => {
    const shares = [1000, 1000, 1200, 1200];
    const b = computeCompanyBasis('9998', D.flatMap((d, i) => q(d, 120, 120 / shares[i], 500, shares[i])), D.flatMap((d, i) => bsq(d, shares[i])), AS_OF);
    expect(b.shareChange).toBe(true);
    expect(b.eps).toBeCloseTo(480 / 1100, 8);
  });
  it('implied shares mismatch (e.g. non-10 par) → whole basis rejected', () => {
    const b = computeCompanyBasis('9997', D.flatMap((d) => q(d, 100, 0.2, 500, 1000)), D.flatMap((d) => bsq(d, 1000)), AS_OF);
    expect(b.ok).toBe(false);
    expect(b.reason).toMatch('股數基準無法核對');
  });
  it('missing statements → insufficient with explicit reason', () => {
    const b = computeCompanyBasis('9996', [], [], AS_OF);
    expect(b.ok).toBe(false);
    const sc = scenarioFromFundamentals({ ok: true, asOf: AS_OF, rows: buildScenarioRows(b, [], 'r') as any }, null);
    expect(sc.status).toBe('insufficient');
    expect(sc.rows[0].reason).toMatch('不足四季');
  });
  it('service failure surfaces a reason instead of a price', () => {
    const sc = scenarioFromFundamentals(null, AS_OF, '財報情境服務暫時無法取得（404）');
    expect(sc.status).toBe('insufficient');
    expect(sc.rows.every((r) => r.reason?.includes('404'))).toBe(true);
  });
});
