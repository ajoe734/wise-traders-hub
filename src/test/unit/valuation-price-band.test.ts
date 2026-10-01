import { describe, expect, it } from 'vitest';
import { buildValuationScenario, type ScenarioRowInput } from '@/checkup/lib/valuationScenario';

const date = '2026-09-23';
const basis = (value: number) => ({ value, unit: 'TWD/share' as const, period: '2026 FY', publishedAt: '2026-09-20', source: '公開財報', kind: 'reported' as const, shareBasis: '2026 加權平均股數' });
const multiple = (low: number, high: number) => ({ low, high, reason: '產品與風險逐家核對', source: '公開同業財報', period: '2026 FY', sampleSize: 3, peerComparability: '同產品與風險', cycle: '相近景氣', growth: '成長已核對', earningsStability: '獲利已核對', cash: '現金已核對', debt: '負債已核對', shareBasis: '2026 加權平均股數' });
const rows: ScenarioRowInput[] = [
  { key: 'pe', basis: basis(5), multiples: multiple(15, 20) },
  { key: 'pb', basis: basis(40), multiples: multiple(1, 1.5) },
  { key: 'ps', basis: basis(25), multiples: multiple(2, 3) },
];

describe('三尺獨立財報情境', () => {
  it('故意分歧：75–100、40–60、50–75，不能給單一區間', () => {
    const result = buildValuationScenario(date, rows);
    expect(result.rows.map((r) => [r.low, r.high])).toEqual([[75, 100], [40, 60], [50, 75]]);
    expect(result.status).toBe('divergent');
    expect([result.low, result.high]).toEqual([null, null]);
  });
  it('三尺都可信且有共同支持才給情境，非兩尺交集', () => {
    const result = buildValuationScenario(date, [rows[0], { ...rows[1], multiples: multiple(2, 2.5) }, { ...rows[2], multiples: multiple(3, 4) }]);
    expect([result.status, result.low, result.high]).toEqual(['consensus', 80, 100]);
    expect(buildValuationScenario(date, rows.slice(0, 2)).status).toBe('insufficient');
  });
  it.each(['pe', 'pb', 'ps'] as const)('%s 缺獨立分母，不以現價／比率循環補值', (key) => {
    const result = buildValuationScenario(date, rows.map((r) => r.key === key ? { ...r, basis: null } : r));
    expect(result.status).toBe('insufficient');
    expect(result.rows.find((r) => r.key === key)?.reason).toContain('缺已公開');
  });
  it.each(['pe', 'pb', 'ps'] as const)('%s 分母≤0 不適用', (key) => {
    const result = buildValuationScenario(date, rows.map((r) => r.key === key ? { ...r, basis: basis(-1) } : r));
    expect(result.rows.find((r) => r.key === key)?.reason).toContain('≤0');
    expect(result.low).toBeNull();
  });
  it('公告日比估值日晚，不可偷看未公布數字', () => {
    const result = buildValuationScenario(date, rows.map((r) => r.key === 'pe' ? { ...r, basis: { ...basis(5), publishedAt: '2026-09-24' } } : r));
    expect(result.rows[0].reason).toContain('公告日晚於估值日');
  });
  it('股數基準不一致，停止該尺', () => {
    const result = buildValuationScenario(date, rows.map((r) => r.key === 'ps' ? { ...r, multiples: { ...multiple(2, 3), shareBasis: '期末流通股數' } } : r));
    expect(result.rows[2].reason).toContain('股數基準不一致');
  });
  it('缺同業可比性、日期、風險理由或樣本均不編價', () => {
    for (const override of [{ sampleSize: 2 }, { peerComparability: '' }, { debt: '' }, { period: '' }]) {
      const result = buildValuationScenario(date, rows.map((r) => r.key === 'pe' ? { ...r, multiples: { ...multiple(15, 20), ...override } } : r));
      expect(result.rows[0].low).toBeNull();
      expect(result.status).toBe('insufficient');
    }
  });
  it('3443 僅有歷史 PE/PB/殖利率與收盤價時，正式情境一律資料不足', () => {
    const result = buildValuationScenario(date, []);
    expect(result.validCount).toBe(0);
    expect(result.rows.map((r) => r.reason)).toEqual([
      '缺已公開、可核對的每股獲利與公告日',
      '缺已公開、可核對的每股淨值與公告日',
      '缺已公開、可核對的每股營收與公告日',
    ]);
  });
});
