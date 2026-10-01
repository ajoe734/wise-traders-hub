import { describe, expect, it } from 'vitest';
import * as F from '../../../supabase/functions/_shared/fundamentalsBasis';
import { buildCustomScenario, buildValuationScenario, EMPTY_CUSTOM } from '@/checkup/lib/valuationScenario';
import { sanitizeCustomInput } from '@/checkup/lib/drawerPrefs';
import f3443 from '../fixtures/finmind/v2/3443.json';
import f2454 from '../fixtures/finmind/v2/2454.json';
import f2327 from '../fixtures/finmind/v2/2327.json';
import f2317 from '../fixtures/finmind/v2/2317.json';
import f1101 from '../fixtures/finmind/v2/1101.json';
import f2882 from '../fixtures/finmind/v2/2882.json';
import f3228 from '../fixtures/finmind/v2/3228.json';
import f3661 from '../fixtures/finmind/v2/3661.json';
import f3035 from '../fixtures/finmind/v2/3035.json';
import f8054 from '../fixtures/finmind/v2/8054.json';
import f7749 from '../fixtures/finmind/v2/7749.json';
import f8227 from '../fixtures/finmind/v2/8227.json';
import official from '../fixtures/finmind/v2/official-1150930.json';
import universe from '../fixtures/finmind/v2/industry-universe.json';

/** 原始資料：FinMind v4（2026-10-01 以伺服器 token 取得，保留 origin_name），官方名錄出表日 1150930。 */
type Fx = { fs: F.FinRow[]; bs: F.FinRow[]; px: Array<{ date: string; close: number }> };
const FX: Record<string, Fx> = { '3443': f3443, '2454': f2454, '2327': f2327, '2317': f2317, '1101': f1101, '2882': f2882, '3228': f3228, '3661': f3661, '3035': f3035, '8054': f8054, '7749': f7749, '8227': f8227 } as any;
const OFF = official as Record<string, { src: 'TWSE' | 'TPEx'; row: Record<string, string> }>;
const off = (s: string) => (OFF[s] ? (OFF[s].src === 'TWSE' ? F.officialFromTwse(OFF[s].row) : F.officialFromTpex(OFF[s].row)) : null);
const ASOF = '2026-10-01';
const FETCHED = '2026-10-01T12:30:00Z';
const prices = (s: string) => FX[s].px.map((p) => ({ date: p.date, close: Number(p.close) }));
const live = (s: string, o = off(s)) => F.computeCompanyBasis(s, FX[s].fs, FX[s].bs, ASOF, { mode: 'live', official: o, fetchedAt: FETCHED });
const val = (s: string, date: string, type: string, sheet: 'fs' | 'bs' = 'fs') => FX[s][sheet].find((r) => r.date === date && r.type === type)!.value;
const Q4 = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'];

function peerSet(target: string) {
  const uni = universe as F.PeerUniverseRow[];
  const meta = uni.find((u) => u.symbol === target)!;
  const ranked = F.rankPeerCandidates(meta, uni, (s) => off(s)?.paidInCapital ?? null);
  const audit = F.auditPeers(ranked, (s) => off(s) != null, 6);
  const peers = audit.filter((a) => a.status === 'selected').map((a) => ({
    symbol: a.symbol, name: a.name, basis: live(a.symbol), close: F.closeOn(prices(a.symbol), ASOF),
  }));
  return { audit, peers };
}
const scenarioOf = (rows: F.ScenarioRowOut[]) => buildValuationScenario(ASOF, rows.map((r) => ({
  key: r.key, basis: r.basis as any, multiples: r.multiples as any, notApplicable: r.notApplicable, basisIssue: r.basisIssue, multipleIssue: r.multipleIssue, samples: r.samples as any,
})));

describe('淨利口徑：origin_name、本期淨利、非控制權益', () => {
  it('3443 原始科目為「淨利（淨損）歸屬於母公司業主」，且等於本期淨利（無非控制權益）', () => {
    for (const d of Q4) {
      const row = FX['3443'].fs.find((r) => r.date === d && r.type === 'EquityAttributableToOwnersOfParent')!;
      expect(row.origin_name).toBe('淨利（淨損）歸屬於母公司業主');
      expect(row.value).toBe(val('3443', d, 'IncomeAfterTaxes'));
    }
  });
  it('2317 母公司淨利＋非控制權益 = 本期淨利，口徑通過', () => {
    for (const d of Q4) {
      expect(val('2317', d, 'EquityAttributableToOwnersOfParent') + val('2317', d, 'NoncontrollingInterests')).toBeCloseTo(val('2317', d, 'IncomeAfterTaxes'), -3);
    }
    expect(live('2317').niTtm).toBe(Q4.reduce((a, d) => a + val('2317', d, 'EquityAttributableToOwnersOfParent'), 0));
  });
  const mutate = (fn: (rows: F.FinRow[]) => F.FinRow[]) => F.computeCompanyBasis('3443', fn(structuredClone(FX['3443'].fs)), FX['3443'].bs, ASOF, { mode: 'live', official: off('3443'), fetchedAt: FETCHED });
  it('科目名稱是「綜合損益歸屬母公司」→ PE 不適用，PB/PS 不受影響', () => {
    const b = mutate((rows) => rows.map((r) => (r.date === '2026-03-31' && r.type === 'EquityAttributableToOwnersOfParent' ? { ...r, origin_name: '綜合損益總額歸屬於母公司業主' } : r)));
    expect(b.notApplicable.pe).toMatch(/綜合損益/);
    expect(b.eps).toBeNull();
    expect(b.bvps).toBeCloseTo(13465348000 / 134011900, 6);
  });
  it('同期出現兩個不同的歸屬母公司數值 → 歧義，PE 不適用', () => {
    const b = mutate((rows) => [...rows, { date: '2026-06-30', type: 'EquityAttributableToOwnersOfParent', value: 1_700_000_000, origin_name: '綜合損益總額歸屬於母公司業主' }]);
    expect(b.notApplicable.pe).toMatch(/多個/);
  });
  it('母公司＋非控制權益對不上本期淨利 → PE 不適用', () => {
    const b = mutate((rows) => [...rows, { date: '2025-12-31', type: 'NoncontrollingInterests', value: 300_000_000, origin_name: '淨利（淨損）歸屬於非控制權益' }]);
    expect(b.notApplicable.pe).toMatch(/口徑不一致/);
  });
});

describe('股數：官方面額、庫藏股、特別股、配股／分割', () => {
  it('3443：股本 1,340,119,000 ÷ 官方面額 10 = 134,011,900 股；官方已發行 134,011,911', () => {
    const o = off('3443')!;
    expect(o.par).toBe(10);
    expect(o.issuedShares).toBe(134011911);
    expect(o.preferredShares).toBe(0);
    expect(live('3443').sharesEnd).toBe(134011900);
  });
  it('國巨 2327 官方面額 2.5 元：股本 5,146,827,000 ÷ 2.5 − 庫藏股 3,833,324 = 2,054,897,476', () => {
    expect(off('2327')!.par).toBe(2.5);
    const b = live('2327');
    expect(b.sharesEnd).toBe(5146827000 / 2.5 - 3833324);
    expect(b.eps).toBeCloseTo(b.niTtm! / b.weightedSharesUsed!, 9);
  });
  it('國巨 2327 歷史期（2025 年前面額 10 元）以現行 2.5 元換算會對不上 → 該期歷史點被排除，不混用', () => {
    const hist = F.monthlyHistory('2327', FX['2327'].fs, FX['2327'].bs, prices('2327'), ASOF, off('2327'));
    expect(hist.every((h) => h.period >= '2025-06-30')).toBe(true);
  });
  it('若把面額硬設為 10 元，2327 加權股數不在季末股數區間 → 整檔不適用', () => {
    const wrong = { ...off('2327')!, par: 10 };
    const b = live('2327', wrong);
    expect(b.ok).toBe(false);
    expect(b.reason).toMatch(/股數基準無法核對/);
  });
  it('查無官方面額 → 三尺不適用，不假設 10 元', () => {
    const b = live('3443', null);
    expect(b.ok).toBe(false);
    expect(b.reason).toMatch(/官方面額/);
  });
  it('國泰金 2882 有特別股 1,533,300,000 股 → PE、PB 不適用，PS 用普通股期末股數', () => {
    const b = live('2882');
    expect(off('2882')!.preferredShares).toBe(1533300000);
    expect(b.notApplicable.pe).toMatch(/特別股/);
    expect(b.notApplicable.pb).toMatch(/特別股/);
    expect(b.sps).toBeCloseTo(b.revenueTtm! / b.sharesEnd!, 9);
  });
  it('台泥 1101 有特別股且近四季虧損 → PE、PB 不適用（特別股優先說明），PS 可算', () => {
    const b = live('1101');
    expect(b.notApplicable.pe).toMatch(/特別股/);
    expect(b.notApplicable.pb).toMatch(/特別股/);
    expect(b.sps).toBeGreaterThan(0);
  });
  it('鴻海 2317 四季 EPS 隱含股數變動 >0.5%（扣除進位誤差後）→ PE 不適用、不稱追溯口徑；PS 改最新季末股數並與官方核對', () => {
    const b = live('2317');
    expect(b.shareChange).toBe(true);
    expect(b.notApplicable.pe).toMatch(/未取得正式追溯調整資料/);
    expect(b.notApplicable.pe).not.toMatch(/追溯口徑/);
    expect(b.psShares).toBe(b.sharesEnd);
    expect(Math.abs(b.officialShareDiff!)).toBeLessThan(0.005);
    expect(b.bvps).toBeCloseTo(b.equityParent! / b.sharesEnd!, 9);
  });
  it('合成配股：最新一季股數 +10% 且 EPS 未追溯 → PE 不適用', () => {
    const fs = structuredClone(FX['3443'].fs).map((r) => (r.date === '2026-06-30' && r.type === 'EPS' ? { ...r, value: Number((r.value / 1.1).toFixed(2)) } : r));
    const bs = structuredClone(FX['3443'].bs).map((r) => (r.date === '2026-06-30' && r.type === 'OrdinaryShare' ? { ...r, value: r.value * 1.1 } : r));
    const o = { ...off('3443')!, issuedShares: 134011911 * 1.1 };
    const b = F.computeCompanyBasis('3443', fs, bs, ASOF, { mode: 'live', official: o, fetchedAt: FETCHED });
    expect(b.shareChange).toBe(true);
    expect(b.eps).toBeNull();
    expect(b.notApplicable.pe).toMatch(/配股/);
  });
  it('EPS 只到小數兩位：智原 3035 季 EPS 0.40–0.80，隱含股數差 0.84% 屬進位誤差，不誤判為股數變動', () => {
    const b = live('3035');
    expect(b.epsBasisRange!).toBeGreaterThan(0.005);
    expect(b.shareChange).toBe(false);
    expect(b.eps).toBeGreaterThan(0);
  });
  it('世芯 3661 2026Q2 季中增資：加權股數落在上季末～本季末之間，不再整檔排除', () => {
    expect(live('3661').ok).toBe(true);
  });
});

describe('3443 手算核對（真實資料，資料期 2025Q3–2026Q2）', () => {
  const b = live('3443');
  const w = Q4.map((d) => val('3443', d, 'EquityAttributableToOwnersOfParent') / val('3443', d, 'EPS'));
  const avgW = w.reduce((a, c) => a + c, 0) / 4;
  it('EPS = 5,228,030,000 ÷ 四季加權股數平均 134,016,327 = 39.0104；財報四季 EPS 合計 39.01 只作核對', () => {
    expect(b.niTtm).toBe(866875000 + 1159658000 + 1646240000 + 1555257000);
    expect(b.weightedSharesUsed).toBeCloseTo(avgW, 4);
    expect(Math.round(avgW)).toBe(134016327);
    expect(b.eps).toBeCloseTo(5228030000 / avgW, 9);
    expect(b.eps!.toFixed(4)).toBe('39.0104');
    expect(b.reportedEpsSum).toBeCloseTo(39.01, 6);
  });
  it('BVPS = 13,465,348,000 ÷ 134,011,900 = 100.4787', () => {
    expect(b.bvps).toBeCloseTo(13465348000 / 134011900, 9);
  });
  it('每股營收 = 財報營收 46,357,126,000 ÷ 同一加權股數 = 345.91（不用月營收；用期末股數則為 345.92）', () => {
    expect(b.revenueTtm).toBe(46357126000);
    expect(b.sps).toBeCloseTo(46357126000 / avgW, 9);
    expect(b.sps!.toFixed(2)).toBe('345.91');
    expect((46357126000 / 134011900).toFixed(2)).toBe('345.92');
  });
  it('live 模式：資料期＋取得時間，法定期限註明非實際公告日', () => {
    expect(b.availability?.mode).toBe('live');
    expect(b.availability?.note).toMatch(/2026Q2/);
    expect(b.availability?.note).toMatch(/非實際公告日/);
  });
});

describe('3443 同業：核心業務、先排序再限流、逐家原因', () => {
  const { audit, peers } = peerSet('3443');
  it('候選以主業「ASIC設計服務」入圍，題材不列條件；世芯、智原排前兩名', () => {
    expect(audit[0].symbol).toBe('3661');
    expect(audit[1].symbol).toBe('3035');
    expect(audit.find((a) => a.symbol === '8227')?.reasons.join()).toMatch(/主業同為/);
  });
  it('興櫃（擷發科、益芯科、乾瞻）先排除、不佔名額；超過 6 家者標「超過請求上限」', () => {
    for (const s of ['7796', '7707', '7898']) expect(audit.find((a) => a.symbol === s)?.status).toBe('excluded');
    expect(audit.filter((a) => a.status === 'selected')).toHaveLength(6);
    expect(audit.filter((a) => a.status === 'over_limit').map((a) => a.symbol).sort()).toEqual(['2388', '6462']);
  });
  it('入選 6 家皆因虧損或營收年增與本檔差距過大而排除，倍數不採同業', () => {
    const b = live('3443');
    const issues = peers.map((p) => F.peerRiskIssue(b, p.basis));
    expect(issues.every((i) => i != null)).toBe(true);
    expect(issues.join()).toMatch(/虧損/);
    expect(issues.join()).toMatch(/景氣不可比/);
  });
});

describe('3443 歷史：月末代表點、資料期為證據單位、倍數信心', () => {
  const b = live('3443');
  const hist = F.monthlyHistory('3443', FX['3443'].fs, FX['3443'].bs, prices('3443'), ASOF, off('3443'));
  const { peers } = peerSet('3443');
  const rows = F.buildScenarioRows(b, peers, 'r', hist);
  it('每個月點只用當時已過法定期限的財報', () => {
    for (const p of hist) expect(p.date >= p.deadline).toBe(true);
  });
  it('相鄰月點不當獨立證據：PE 證據 4 期（2022Q4、2023Q1、2023Q2、2026Q1），月點數 > 期數', () => {
    const pe = rows[0];
    const used = pe.samples.filter((s) => s.used);
    expect(used.map((s) => s.quarter)).toEqual(['2022Q4', '2023Q1', '2023Q2', '2026Q1']);
    expect(used.reduce((a, s) => a + s.months, 0)).toBeGreaterThan(used.length);
    expect(pe.samples.find((s) => s.quarter === '2026Q2')?.used).toBe(false);
    expect(pe.multiples?.sampleSize).toBe(4);
    expect(pe.multiples!.low).toBeCloseTo(F.quantile(used.map((s) => s.multiple), 0.25), 9);
    expect(pe.multiples!.high).toBeCloseTo(F.quantile(used.map((s) => s.multiple), 0.75), 9);
  });
  it('歷史倍數離散大且僅 4 期 → 倍數信心低；分母仍 3/3，主圖不合成單一區間', () => {
    for (const r of rows) {
      expect(r.basis).not.toBeNull();
      expect(r.multiples?.method).toBe('history');
      expect(r.multiples?.confidence).toBe('low');
      expect(r.multiples?.caveats.join()).toMatch(/非合理價/);
    }
    const sc = scenarioOf(rows);
    expect(sc.basisCount).toBe(3);
    expect(sc.status).toBe('lowConfidence');
    expect(sc.low).toBeNull();
  });
});

describe('2454 不同產業手算', () => {
  const b = live('2454');
  const hist = F.monthlyHistory('2454', FX['2454'].fs, FX['2454'].bs, prices('2454'), ASOF, off('2454'));
  const rows = F.buildScenarioRows(b, [], 'n/a', hist);
  it('分母：EPS = 淨利 ÷ 加權股數平均；BVPS = 權益 ÷ 期末流通股', () => {
    const w = Q4.map((d) => val('2454', d, 'EquityAttributableToOwnersOfParent') / val('2454', d, 'EPS'));
    const avg = w.reduce((a, c) => a + c, 0) / 4;
    expect(b.eps).toBeCloseTo(b.niTtm! / avg, 9);
    expect(b.eps!).toBeCloseTo(60.69, 2);
    expect(b.bvps).toBeCloseTo(b.equityParent! / b.sharesEnd!, 9);
  });
  it('PE 歷史倍數 = 相近景氣資料期中位數的 P25–P75；信心低時主圖不合成', () => {
    const used = rows[0].samples.filter((s) => s.used);
    expect(used.length).toBeGreaterThanOrEqual(4);
    expect(rows[0].multiples!.low).toBeCloseTo(F.quantile(used.map((s) => s.multiple), 0.25), 9);
    const sc = scenarioOf(rows);
    expect(sc.basisCount).toBe(3);
    expect(sc.status).toBe('lowConfidence');
  });
});

describe('虧損與缺值', () => {
  it('金麗科 3228 虧損 → PE 不適用，PB/PS 分母仍可用', () => {
    const b = live('3228');
    expect(b.notApplicable.pe).toMatch(/≤ 0/);
    expect(b.bvps).toBeGreaterThan(0);
    expect(b.sps).toBeGreaterThan(0);
  });
  it('無財報 → 不適用並寫原因', () => {
    const b = F.computeCompanyBasis('9996', [], [], ASOF, { mode: 'live', official: off('3443'), fetchedAt: FETCHED });
    expect(b.ok).toBe(false);
    const sc = scenarioOf(F.buildScenarioRows(b, [], 'r'));
    expect(sc.basisCount).toBe(0);
    expect(sc.rows[0].reason).toMatch(/不足四季/);
  });
});

describe('分母可用數與倍數信心分開', () => {
  const basis = (v: number) => ({ value: v, unit: 'TWD/share' as const, period: 'p', publishedAt: '2026-09-01', source: 's', kind: 'reported' as const, shareBasis: 'b' });
  it('三尺有分母、無倍數 → basisCount 3、validCount 0', () => {
    const sc = buildValuationScenario(ASOF, [
      { key: 'pe', basis: basis(39), multipleIssue: '依據不足' },
      { key: 'pb', basis: basis(100), multipleIssue: '依據不足' },
      { key: 'ps', basis: basis(345), multipleIssue: '依據不足' },
    ]);
    expect(sc.basisCount).toBe(3);
    expect(sc.validCount).toBe(0);
    expect(sc.rows.every((r) => r.confidence === 'insufficient')).toBe(true);
  });
  it('三尺各自算 75–100／40–60／50–75，但不求交集', () => {
    const m = (lo: number, hi: number) => ({ low: lo, high: hi, reason: 'r', source: 's', period: 'p', sampleSize: 4, peerComparability: 'c', cycle: 'c', growth: 'g', earningsStability: 'e', cash: 'c', debt: 'd', shareBasis: 'b', method: 'peer' as const });
    const sc = buildValuationScenario(ASOF, [
      { key: 'pe', basis: basis(5), multiples: m(15, 20) },
      { key: 'pb', basis: basis(40), multiples: m(1, 1.5) },
      { key: 'ps', basis: basis(25), multiples: m(2, 3) },
    ]);
    expect(sc.status).toBe('consensus');
    expect([sc.low, sc.high]).toEqual([null, null]);
  });
});

describe('我的情境試算（僅此裝置）', () => {
  const basis = (v: number) => ({ value: v, unit: 'TWD/share' as const, period: 'p', publishedAt: '2026-09-01', source: 's', kind: 'reported' as const, shareBasis: 'b' });
  const sc = buildValuationScenario(ASOF, [
    { key: 'pe', basis: basis(39.01), multipleIssue: 'x' },
    { key: 'pb', basis: basis(100.48), multipleIssue: 'x' },
    { key: 'ps', notApplicable: '特別股' },
  ]);
  const input = { ...EMPTY_CUSTOM, primaryKey: 'pe' as const, expectedBasis: 42, multiple: { low: 50, high: 70 }, stressBasis: 35, stressMultiple: 40, source: '測試依據 A', date: '2026-09-30', assumption: 'ASIC 高成長期', invalidation: '毛利率跌破門檻' };
  it('只用一把主要尺的明示預期分母，並算壓力結果', () => {
    const c = buildCustomScenario(sc, input, '2026-10-01');
    expect(c.status).toBe('ready');
    expect(c.low).toBe(42 * 50);
    expect(c.high).toBe(42 * 70);
    expect(c.stress).toBe(35 * 40);
  });
  it('缺來源／假設、日期晚於今天 → 不套用', () => {
    const c = buildCustomScenario(sc, { ...input, source: '', assumption: ' ', date: '2026-10-05' }, '2026-10-01');
    expect(c.status).toBe('invalid');
    expect(c.problems.join()).toMatch(/依據/);
    expect(c.problems.join()).toMatch(/假設/);
    expect(c.problems.join()).toMatch(/晚於今天/);
  });
  it('對不可用分母的尺輸入倍數 → 拒絕', () => {
    const c = buildCustomScenario(sc, { ...input, primaryKey: 'ps' }, '2026-10-01');
    expect(c.status).toBe('invalid');
    expect(c.problems.join()).toMatch(/分母不可用/);
  });
  it('舊版多尺資料保留但要求重新確認，不靜默套用', () => {
    const c = buildCustomScenario(sc, { ...EMPTY_CUSTOM, legacy: { pe: { low: 10, high: 20 }, pb: { low: 2, high: 3 }, ps: { low: null, high: null }, source: '舊資料', date: '2026-09-01', assumption: '舊假設' } }, '2026-10-01');
    expect(c.status).toBe('needsReview');
    expect(c.low).toBeNull();
  });
  it('v1 本機資料完整搬入 legacy，不靜默改成任何主要尺', () => {
    const migrated = sanitizeCustomInput({
      pe: { low: 10, high: 20 }, pb: { low: 2, high: 3 }, ps: { low: 1, high: 2 },
      source: '舊來源', date: '2026-09-01', assumption: '舊假設',
    });
    expect(migrated.primaryKey).toBeNull();
    expect(migrated.legacy).toEqual({
      pe: { low: 10, high: 20 }, pb: { low: 2, high: 3 }, ps: { low: 1, high: 2 },
      source: '舊來源', date: '2026-09-01', assumption: '舊假設',
    });
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

describe('官方名錄逾時後備：已發行股數推定面額', () => {
  it('3443：股本 1,340,119,000 ÷ 134,011,911 → 10 元', () => {
    const o = F.officialFromIssuedShares(134011911, 1340119000, '2026-10-01');
    expect(o?.par).toBe(10); expect(o?.preferredUnknown).toBe(true);
  });
  it('2327：5,146,827,000 ÷ 2,058,730,688 → 2.5 元', () => {
    expect(F.officialFromIssuedShares(2058730688, 5146827000, '2026-09-30')?.par).toBe(2.5);
  });
  it('對不上標準面額 → null（三尺不適用，不猜）', () => {
    expect(F.officialFromIssuedShares(100_000_000, 730_000_000, null)).toBeNull();
    expect(F.officialFromIssuedShares(null, 1, null)).toBeNull();
  });
});
