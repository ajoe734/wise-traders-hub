import { describe, expect, it } from 'vitest';
import * as F from '../../../supabase/functions/_shared/fundamentalsBasis';
import { buildValuationScenario, historyReferenceBands, referenceOverlap } from '@/checkup/lib/valuationScenario';
import fx from '../fixtures/finmind/v2/3443-7y.json';

/** 3443：FinMind 公開 API 2026-10-01 取得；財報／資產負債表 7 年、股價 5 年。 */
const d = fx as unknown as { fs: F.FinRow[]; bs: F.FinRow[]; px: Array<{ date: string; close: number }>; sh: Array<{ date: string; NumberOfSharesIssued: number }> };
const prices = d.px.map((p) => ({ date: p.date, close: Number(p.close) }));
const last = d.sh.at(-1)!;
const official = F.officialFromIssuedShares(Number(last.NumberOfSharesIssued), F.latestOrdinaryShare(d.bs), last.date);
const asOf = prices.at(-1)!.date;
const target = F.computeCompanyBasis('3443', d.fs, d.bs, asOf, { mode: 'live', official, fetchedAt: '2026-10-01T00:00:00Z' });
const sevenYear = F.buildScenarioRows(target, [], 'test', F.monthlyHistory('3443', d.fs, d.bs, prices, asOf, official));
const cut = (rows: F.FinRow[]) => rows.filter((r) => r.date >= '2021-10-01');
const fiveYear = F.buildScenarioRows(target, [], 'test', F.monthlyHistory('3443', cut(d.fs), cut(d.bs), prices, asOf, official));

describe('3443 七年財報：TTM 年增基期補足後的景氣相近獨立期', () => {
  it('分母 3/3，EPS/BVPS/SPS 不變', () => {
    expect(target.eps!).toBeCloseTo(39.01, 2);
    expect(target.bvps!).toBeCloseTo(100.48, 2);
    expect(target.sps!).toBeCloseTo(345.91, 1);
  });
  it('五年財報：前兩年年增不明 → 只剩 1 期', () => {
    for (const r of fiveYear) expect(r.samples.filter((s) => s.used).length).toBe(1);
  });
  it('七年財報：每尺 5 個獨立期（2022Q3–2023Q2、2026Q1），目前資料期 2026Q2 排除', () => {
    for (const r of sevenYear) {
      const used = r.samples.filter((s) => s.used).map((s) => s.quarter);
      expect(used).toEqual(['2022Q3', '2022Q4', '2023Q1', '2023Q2', '2026Q1']);
      expect(r.samples.find((s) => s.quarter === '2026Q2')?.used).toBe(false);
      expect(r.multiples?.method).toBe('history');
      expect(r.multiples?.confidence).toBe('low');
      expect(r.multiples?.sampleSize).toBe(5);
    }
  });
  it('景氣門檻未放寬：年增 31%、34%、36% 的期間仍排除', () => {
    expect(F.similarGrowth(0.31, target.growthYoY)).toBe(false);
    expect(F.similarGrowth(0.36, target.growthYoY)).toBe(false);
    expect(F.similarGrowth(0.46, target.growthYoY)).toBe(true);
  });
  it('低信心時仍輸出三條參考帶，三帶交集為「三尺重疊參考」', () => {
    const scen = buildValuationScenario(asOf, sevenYear as any);
    expect(scen.status).toBe('lowConfidence');
    expect(scen.basisCount).toBe(3);
    expect(scen.low).toBeNull();
    const refs = historyReferenceBands(scen);
    expect(refs.map((r) => r.key)).toEqual(['pe', 'pb', 'ps']);
    const pe = sevenYear[0];
    expect(refs[0].low).toBeCloseTo(target.eps! * pe.multiples!.low, 6);
    const o = referenceOverlap(refs)!;
    expect(o.low).toBeCloseTo(Math.max(...refs.map((r) => r.low)), 6);
    expect(o.high).toBeCloseTo(Math.min(...refs.map((r) => r.high)), 6);
  });
  it('不重疊時不給交集；不足三帶時不給交集', () => {
    const mk = (k: any, low: number, high: number) => ({ key: k, low, high, label: '', sampleSize: 5, period: '' });
    expect(referenceOverlap([mk('pe', 1, 2), mk('pb', 3, 4), mk('ps', 1, 4)])).toBeNull();
    expect(referenceOverlap([mk('pe', 1, 2), mk('pb', 1, 2)])).toBeNull();
  });
});
