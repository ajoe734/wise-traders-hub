import { describe, it, expect } from 'vitest';
import { rocDateToIso, parseCloses, nextQuarterEnd, filingDeadline, needsBasisRefresh, psRows } from '../../../supabase/functions/_shared/peerPsCore';
import universe from '../../../supabase/functions/_shared/peerPsUniverse.json';
import peerGroups from '@/checkup/data/valuationPeerGroups.json';
import { buildPeerReference } from '@/checkup/lib/valuationStations';

describe('同業每日 PS', () => {
  it('民國日期轉西元', () => {
    expect(rocDateToIso('1151014')).toBe('2026-10-14');
    expect(rocDateToIso('abc')).toBeNull();
  });
  it('收盤只留 4 碼普通股、去掉無價', () => {
    const c = parseCloses(
      [{ Date: '1151014', Code: '2308', ClosingPrice: '1,630.00' }, { Date: '1151014', Code: '00400A', ClosingPrice: '15' }, { Date: '1151014', Code: '1101', ClosingPrice: '' }],
      [{ Date: '1151015', SecuritiesCompanyCode: '6274', Close: '1625.00' }],
    );
    expect(c).toEqual([{ symbol: '2308', date: '2026-10-14', close: 1630 }, { symbol: '6274', date: '2026-10-15', close: 1625 }]);
  });
  it('PS = 收盤 ÷ 每股營收，缺收盤不補', () => {
    const rows = psRows([{ symbol: '2308', sps: 251.96, latest_period: '2026-06-30', computed_at: '2026-10-15' }, { symbol: '9999', sps: 10, latest_period: '2026-06-30', computed_at: '2026-10-15' }],
      [{ symbol: '2308', date: '2026-10-14', close: 1630 }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ps).toBeCloseTo(6.4693, 3);
  });
  it('申報期限：Q1 5/15、Q2 8/14、Q3 11/14、Q4 隔年 3/31', () => {
    expect(filingDeadline('2026-03-31')).toBe('2026-05-15');
    expect(filingDeadline('2026-06-30')).toBe('2026-08-14');
    expect(filingDeadline('2026-09-30')).toBe('2026-11-14');
    expect(filingDeadline('2026-12-31')).toBe('2027-03-31');
    expect(nextQuarterEnd('2026-12-31')).toBe('2027-03-31');
  });
  it('每股營收在下一季申報期限過後才重算', () => {
    const b = { symbol: '2308', sps: 1, latest_period: '2026-06-30', computed_at: '2026-10-15T00:00:00Z' };
    expect(needsBasisRefresh(null, '2026-10-15')).toBe(true);
    expect(needsBasisRefresh(b, '2026-11-14')).toBe(false);
    expect(needsBasisRefresh(b, '2026-11-15')).toBe(true);
    expect(needsBasisRefresh({ ...b, computed_at: '2026-11-15T00:00:00Z' }, '2026-11-20')).toBe(false);
  });
  it('排程清單與同業名單成員完全一致', () => {
    const want = [...new Set((peerGroups as { groups: Array<{ symbols: string[] }> }).groups.flatMap((g) => g.symbols))].sort();
    expect(universe.symbols).toEqual(want);
  });
  it('PS 主尺的同業參考：3 家以上平均 PS × 本檔每股營收', () => {
    const group = { key: 'g', code: 'X', label: '測試組', custom: false, curation: 'manual', symbols: ['A', 'B', 'C', 'D'] } as any;
    const ref = buildPeerReference('A', 'ps', 100, [{ symbol: 'B', ps: 2 }, { symbol: 'C', ps: 4 }, { symbol: 'D', ps: 6 }], group);
    expect(ref).toMatchObject({ status: 'ready', n: 3, avgMultiple: 4, price: 400 });
    const few = buildPeerReference('A', 'ps', 100, [{ symbol: 'B', ps: 2 }, { symbol: 'C', ps: null }], group);
    expect(few.status).toBe('insufficient');
  });
});
