import { describe, it, expect } from 'vitest';
import { nextQuarterBasis } from '../../../supabase/functions/_shared/monthRevenue';
import { buildStations, stationBasis, pricedInLevel } from '@/checkup/lib/valuationStations';

const q = (period: string, revenue: number, reportedEps: number) => ({ period, revenue, reportedEps });
const mr = (y: number, m: number, revenue: number) => ({ revenue_year: y, revenue_month: m, revenue });
const basis = {
  quarters: [q('2025-09-30', 1000, 8), q('2025-12-31', 1000, 8), q('2026-03-31', 1000, 8), q('2026-06-30', 1000, 10)],
  eps: 34, reportedEpsSum: 34, psShares: 10,
};

describe('近三季已公布＋下一季月營收推估', () => {
  it('7–9 月營收 1,200 ÷ 最新一季 1,000 → 推估 EPS 12，PE 分母 8+8+10+12 = 38', () => {
    const r: any = nextQuarterBasis(basis, [mr(2026, 7, 400), mr(2026, 8, 400), mr(2026, 9, 400)]);
    expect(r?.quarter).toBe('2026Q3');
    expect(r?.estEps).toBeCloseTo(12);
    expect(r?.pe).toBeCloseTo(38);
    expect(r?.ps).toBeCloseTo((3000 + 1200) / 10);
  });
  it('下一季營收 3 個月未齊 → null（退回近四季實際）', () => {
    expect(nextQuarterBasis(basis, [mr(2026, 7, 400), mr(2026, 8, 400)])).toBeNull();
  });
  it('PB 不推估；沒有推估時用近四季實際', () => {
    const nq = nextQuarterBasis(basis, [mr(2026, 7, 400), mr(2026, 8, 400), mr(2026, 9, 400)]);
    expect(stationBasis('pb', 50, nq)).toEqual({ value: 50, estimated: false });
    expect(stationBasis('pe', 34, null)).toEqual({ value: 34, estimated: false });
    expect(stationBasis('pe', 34, nq).estimated).toBe(true);
  });
  it('台達電實算：34.67 × 60.3 ≈ 2,091', () => expect(Math.round(34.67 * 60.3)).toBe(2091));
});

describe('已反映程度', () => {
  const st = (b: number, m: number, p: number) => ({ status: 'ready' as const, key: 'pe' as const, basis: 1, days: 240, stations: [
    { key: 'board' as const, label: '上車站', multiple: b, price: b },
    { key: 'belt' as const, label: '下車安全帶', multiple: m, price: m },
    { key: 'pressure' as const, label: '高壓站', multiple: p, price: p }] });
  it('創意 7,670 高於高壓站 7,037 → 已大幅反映，157%', () => {
    const r = pricedInLevel(7670, st(3914, 4900, 7037));
    expect(r.level).toBe('heavy');
    expect(r.level !== 'unknown' && Math.round(r.ratioToBelt * 100)).toBe(157);
  });
  it('台達電 1,630 在 1,797 之下 → 尚未反映', () => expect(pricedInLevel(1630, st(1797, 2092, 2596)).level).toBe('under'));
  it('台燿 1,625 在 1,054–2,475 之間 → 部分反映', () => expect(pricedInLevel(1625, st(1054, 1476, 2475)).level).toBe('partial'));
  it('站牌資料不足 → 無法判斷', () => expect(pricedInLevel(100, buildStations('pe', [1, 2], 10)).level).toBe('unknown'));
});

import { pickMainRuler, peDispersionOf } from '@/checkup/lib/valuationStations';
describe('本益比失真改用其他尺', () => {
  it('台化：近一年 PE 30–418 倍（P80÷P20 ≈ 13.7 > 3）→ 不用 PE', () => {
    expect(pickMainRuler({ industry: '塑膠', ttmEps: 2.35, currentPe: 33, revenueYoY: 0.05, peDispersion: 417.7 / 30.4 }).key).toBe('pb');
  });
  it('台達電：P80÷P20 ≈ 1.45 → 仍用 PE', () => {
    expect(pickMainRuler({ industry: '電源供應', ttmEps: 31.4, currentPe: 52, revenueYoY: 0.1, peDispersion: 74.9 / 51.8 }).key).toBe('pe');
  });
  it('不滿一年不判斷高低差', () => expect(peDispersionOf([10, 20])).toBeNull());
});

describe('下一季財報一公布就停用推估（申報期限檢查）', () => {
  const rev = [mr(2026, 7, 400), mr(2026, 8, 400), mr(2026, 9, 400)];
  it('2026Q3 期限 11/14 當天仍可推估', () => {
    const r: any = nextQuarterBasis(basis, rev, '2026-11-14');
    expect(r.stale).toBeFalsy();
    expect(r.deadline).toBe('2026-11-14');
  });
  it('11/15 起季報應已公布 → stale，PE／PS 分母 null，站牌資料不足', () => {
    const r: any = nextQuarterBasis(basis, rev, '2026-11-15');
    expect(r.stale).toBe(true);
    expect(r.quarter).toBe('2026Q3');
    expect(stationBasis('pe', 34, r)).toMatchObject({ value: null, estimated: false });
    expect(stationBasis('ps', 300, r).value).toBeNull();
    const year = Array.from({ length: 240 }, (_, i) => 10 + i * 0.1);
    expect(buildStations('pe', year, stationBasis('pe', 34, r).value).status).toBe('insufficient');
    expect(pricedInLevel(500, buildStations('pe', year, null)).level).toBe('unknown');
  });
  it('stale 時 PB 不受影響', () => {
    const r: any = nextQuarterBasis(basis, rev, '2026-12-01');
    expect(stationBasis('pb', 50, r)).toEqual({ value: 50, estimated: false });
  });
  it('Q4 推估期限為隔年 3/31', () => {
    const b4 = { ...basis, quarters: [q('2025-12-31', 1000, 8), q('2026-03-31', 1000, 8), q('2026-06-30', 1000, 8), q('2026-09-30', 1000, 10)] };
    const r10 = [mr(2026, 10, 400), mr(2026, 11, 400), mr(2026, 12, 400)];
    expect((nextQuarterBasis(b4, r10, '2027-03-31') as any).stale).toBeFalsy();
    expect((nextQuarterBasis(b4, r10, '2027-04-01') as any).stale).toBe(true);
  });
  it('季報進系統後最新季前移，舊推估季不再出現', () => {
    const b4 = { ...basis, quarters: [...basis.quarters.slice(1), q('2026-09-30', 1100, 11)] };
    expect(nextQuarterBasis(b4, rev, '2026-11-20')).toBeNull(); // 10–12 月營收未齊 → 近四季實際
  });
});
