import { describe, expect, it } from 'vitest';
import * as F from '../../../.scratch/valuation-fundamentals-v2/fundamentalsBasis';
import { buildValuationScenario } from '@/checkup/lib/valuationScenario';
import f3443 from '../fixtures/finmind/3443-2026-10-01.json';
import f2454 from '../fixtures/finmind/2454-2026-10-01.json';
import official from '../fixtures/finmind/official-shares-1150930.json';

const off = official as Record<string, Record<string, string>>;
const prices = (d: any) => d.px.map((p: any) => ({ date: p.date, close: Number(p.close) }));
const ASOF = '2026-10-01';
const live = (sym: string, d: any, o = F.officialFromTwse(off[sym])) =>
  F.computeCompanyBasis(sym, d.fs, d.bs, ASOF, { mode: 'live', official: o, fetchedAt: '2026-10-01T11:00:00Z' });

describe('官方面額與股數', () => {
  it('解析新台幣面額；無面額／外幣不核實', () => {
    expect(F.parsePar('新台幣                 10.0000元')).toBe(10);
    expect(F.parsePar('新台幣 2.5000元')).toBe(2.5);
    expect(F.parsePar('無面額')).toBeNull();
    expect(F.parsePar('美金0.05元')).toBeNull();
    expect(F.rocToIso('1150930')).toBe('2026-09-30');
  });
  it('3443：股本 1,340,119,000 ÷ 官方面額 10 = 134,011,900 股，與官方 134,011,911 差 11 股', () => {
    const o = F.officialFromTwse(off['3443'])!;
    expect(o.par).toBe(10);
    expect(o.issuedShares).toBe(134011911);
    const b = live('3443', f3443);
    expect(b.sharesEnd).toBe(134011900);
    expect(Math.abs(b.officialShareDiff!)).toBeLessThan(1e-6);
  });
  it('國巨 2327 官方面額 2.5 元，不得假設 10 元', () => {
    expect(F.officialFromTwse(off['2327'])!.par).toBe(2.5);
  });
  it('國泰金 2882 實收資本額含特別股：資本額÷10 ≠ 普通股數，以官方普通股數為準', () => {
    const r = off['2882'];
    expect(Number(r['實收資本額']) / 10).not.toBe(Number(r['已發行普通股數或TDR原股發行股數']));
  });
  it('查無官方面額 → 三尺不適用，不假設 10 元', () => {
    const b = live('3443', f3443, null);
    expect(b.ok).toBe(false);
    expect(b.reason).toMatch(/官方面額/);
  });
});

describe('3443 手算核對（加權股數口徑）', () => {
  const b = live('3443', f3443);
  it('EPS = 近四季淨利 5,228,030,000 ÷ 四季加權股數平均', () => {
    const w = [866875000 / 6.47, 1159658000 / 8.65, 1646240000 / 12.28, 1555257000 / 11.61];
    const avg = w.reduce((a, c) => a + c, 0) / 4;
    expect(b.weightedSharesUsed).toBeCloseTo(avg, 0);
    expect(b.eps).toBeCloseTo(5228030000 / avg, 6);
    expect(b.eps!).toBeCloseTo(39.01, 1);
    expect(b.reportedEpsSum).toBeCloseTo(39.01, 2);
  });
  it('BVPS = 13,465,348,000 ÷ 134,011,900 = 100.48', () => {
    expect(b.bvps).toBeCloseTo(13465348000 / 134011900, 6);
  });
  it('live 模式標資料期與取得時間；法定期限不當公告日', () => {
    expect(b.availability?.mode).toBe('live');
    expect(b.availability?.note).toMatch(/2026Q2/);
    expect(b.availability?.note).toMatch(/非實際公告日/);
  });
  it('歷史樣本：排除與目前同資料期的 2026Q2，剩 3 季 < 4 → 倍數依據不足，不出價', () => {
    const h = F.historyPoints('3443', f3443.fs as any, f3443.bs as any, prices(f3443), ASOF, F.officialFromTwse(off['3443']));
    const rows = F.buildScenarioRows(b, [], 'n/a', h);
    for (const r of rows) {
      expect(r.multiples).toBeNull();
      expect(r.notApplicable).toMatch(/歷史 3 季/);
      expect(r.samples.map((s) => s.quarter)).toEqual(['2023Q3', '2025Q4', '2026Q1', '2026Q2']);
      expect(r.samples.find((s) => s.quarter === '2026Q2')!.used).toBe(false);
    }
    const pe = rows[0].samples;
    expect(pe[0].close).toBe(1735);
    expect(pe[0].multiple).toBeCloseTo(1735 / pe[0].basis, 6);
  });
  it('歷史樣本只用法定期限後收盤，不提前使用', () => {
    const h = F.historyPoints('3443', f3443.fs as any, f3443.bs as any, prices(f3443), ASOF, F.officialFromTwse(off['3443']));
    for (const p of h) expect(p.date >= p.deadline).toBe(true);
  });
});

describe('2454 不同產業手算核對', () => {
  const b = live('2454', f2454);
  const h = F.historyPoints('2454', f2454.fs as any, f2454.bs as any, prices(f2454), ASOF, F.officialFromTwse(off['2454']));
  const rows = F.buildScenarioRows(b, [], 'n/a', h);
  it('PE 為本公司歷史情境參考：6 季 25–75 百分位，非同業', () => {
    const pe = rows[0];
    expect(pe.multiples?.method).toBe('history');
    expect(pe.multiples?.label).toBe('本公司歷史情境參考');
    const used = pe.samples.filter((s) => s.used).map((s) => s.multiple);
    expect(used).toHaveLength(6);
    expect(pe.multiples!.low).toBeCloseTo(F.quantile(used, 0.25), 9);
    expect(pe.multiples!.high).toBeCloseTo(F.quantile(used, 0.75), 9);
    expect(pe.multiples!.caveats.join()).toMatch(/非合理價/);
    expect(pe.multiples!.dispersion).toBeGreaterThan(2);
  });
  it('三尺歷史區間無交集 → divergent，不給單一區間', () => {
    const s = buildValuationScenario(ASOF, rows.map((r) => ({ key: r.key, basis: r.basis as any, multiples: r.multiples as any, notApplicable: r.notApplicable })));
    expect(s.status).toBe('divergent');
    expect(s.low).toBeNull();
  });
});

describe('合成狀態命名', () => {
  const basis = (v: number) => ({ value: v, unit: 'TWD/share' as const, period: 'p', publishedAt: '2026-09-01', source: 's', kind: 'reported' as const, shareBasis: 'b' });
  const m = (lo: number, hi: number, method?: 'peer' | 'history') => ({ low: lo, high: hi, reason: 'r', source: 's', period: 'p', sampleSize: 4, peerComparability: 'c', cycle: 'c', growth: 'g', earningsStability: 'e', cash: 'c', debt: 'd', shareBasis: 'b', method });
  it('三尺皆同業且有交集 → consensus', () => {
    const s = buildValuationScenario(ASOF, [
      { key: 'pe', basis: basis(5), multiples: m(15, 20, 'peer') },
      { key: 'pb', basis: basis(40), multiples: m(2, 2.4, 'peer') },
      { key: 'ps', basis: basis(25), multiples: m(3, 3.6, 'peer') },
    ]);
    expect(s.status).toBe('consensus');
  });
  it('任一尺為歷史或舊版缺 method → historical（歷史情境參考），不是 consensus', () => {
    const s = buildValuationScenario(ASOF, [
      { key: 'pe', basis: basis(5), multiples: m(15, 20, 'peer') },
      { key: 'pb', basis: basis(40), multiples: m(2, 2.4) },
      { key: 'ps', basis: basis(25), multiples: m(3, 3.6, 'history') },
    ]);
    expect(s.status).toBe('historical');
  });
  it('課程分歧算式 75–100／40–60／50–75 → divergent', () => {
    const s = buildValuationScenario(ASOF, [
      { key: 'pe', basis: basis(5), multiples: m(15, 20, 'peer') },
      { key: 'pb', basis: basis(40), multiples: m(1, 1.5, 'peer') },
      { key: 'ps', basis: basis(25), multiples: m(2, 3, 'peer') },
    ]);
    expect(s.status).toBe('divergent');
  });
});

describe('mapLimit 併發上限', () => {
  it('同時執行不超過 limit，失敗不影響其他', async () => {
    let running = 0; let peak = 0;
    const res = await F.mapLimit([1, 2, 3, 4, 5, 6], 3, async (n) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (n === 4) throw new Error('x');
      return n;
    });
    expect(peak).toBe(3);
    expect(res.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});
