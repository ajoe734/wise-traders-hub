/**
 * 通用性：站牌與 PE／PB／PS 分頁不依賴特定個股。隨機情境下不拋錯、不畫假區間，
 * 分頁區間必與同尺站牌一致；金融判定只看產業代碼大類。
 */
import { describe, expect, it } from 'vitest';
import { buildDrawerStations, selectedRulerBand } from '@/checkup/components/freecheckup/HoldingsDetailPanel';
import { isFinancialStock } from '@/checkup/lib/valuationStations';
import { INDUSTRY_CODES } from '@/checkup/lib/industryCodes';

let seed = 20261017;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const series = (n: number, lo: number, hi: number) => Array.from({ length: n }, () => lo + rnd() * (hi - lo));
const INDUSTRIES = [null, '', '不存在的產業', ...INDUSTRY_CODES.map((c) => c.name)];
const CODES = ['2330', '00878', '030001', '6488', '4966', '8299', '1101', '9999', '6999'];

function scenario() {
  const basis = () => (rnd() < 0.15 ? null : rnd() < 0.15 ? -Math.abs(rnd() * 5) : rnd() * 200 + 0.01);
  const row = (key: string) => {
    const v = basis();
    return { key, basisOk: v != null && v > 0, basis: v == null ? null : { kind: 'reported', value: v, period: '近四季' }, notApplicable: v == null ? '缺分母' : null };
  };
  const nq = rnd() < 0.3 ? null : rnd() < 0.3
    ? { stale: true, quarter: '2026Q3', deadline: '2026-11-14', reason: '申報期限已過' }
    : { quarter: '2026Q3', estEps: rnd() * 50, pe: rnd() < 0.2 ? null : rnd() * 50, ps: rnd() < 0.3 ? null : rnd() * 300 };
  const len = pick([0, 30, 239, 240, 400]);
  return {
    band: { rows: [row('pe'), row('pb'), row('ps')], nextQuarter: nq, psDaily: series(pick([0, 100, 240, 300]), 0.5, 40) },
    view: { industry: pick(INDUSTRIES), rulers: [{ key: 'pe', value: rnd() < 0.2 ? null : rnd() * 120 }], rawHistory: { pe: series(len, rnd() * 20 + 1, rnd() * 300 + 25), pb: series(len, 0.3, 30) } },
    symbol: pick(CODES), price: rnd() < 0.1 ? null : rnd() * 3000 + 1,
  };
}

describe('站牌通用性：2,000 組隨機情境', () => {
  it('不拋錯、區間合法、分頁＝同尺站牌', () => {
    for (let i = 0; i < 2000; i++) {
      const s = scenario();
      const st: any = buildDrawerStations(s.view, s.band, s.symbol, s.price);
      expect(['pe', 'pb', 'ps']).toContain(st.main.key);
      if (st.stations.status === 'ready') {
        const [a, b, c] = st.stations.stations.map((x: any) => x.price);
        expect(a > 0 && a <= b && b <= c).toBe(true);
      } else expect(typeof st.stations.reason).toBe('string');
      for (const k of ['pe', 'pb', 'ps']) {
        const t: any = selectedRulerBand(s.band, k, s.view);
        if (t?.low != null) {
          expect(t.low > 0 && t.low <= t.mid && t.mid <= t.high).toBe(true);
          expect(Number.isFinite(t.high)).toBe(true);
        } else expect(typeof t?.reason).toBe('string');
        if (k === st.main.key && st.stations.status === 'ready') {
          expect(t.low).toBeCloseTo(st.stations.stations[0].price, 6);
          expect(t.high).toBeCloseTo(st.stations.stations[2].price, 6);
        }
      }
    }
  });
});

describe('金融判定只看產業代碼大類', () => {
  it('每個產業代碼：金融大類才算金融股', () => {
    for (const c of INDUSTRY_CODES) expect(isFinancialStock(c.name)).toBe(c.sectorCode === 'FINA');
  });
  it('金融科技、金融資訊是軟體業；壽險產險、租賃及融資是金融', () => {
    expect(isFinancialStock('金融科技')).toBe(false);
    expect(isFinancialStock('金融資訊')).toBe(false);
    expect(isFinancialStock('壽險產險')).toBe(true);
    expect(isFinancialStock('租賃及融資')).toBe(true);
    expect(isFinancialStock('不存在的產業')).toBe(false);
  });
});
