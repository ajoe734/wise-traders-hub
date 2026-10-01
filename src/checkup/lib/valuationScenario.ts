/** 持倉抽屜的財報情境價：只接受獨立揭露的每股數字，不接受股價／當前比率反推值。 */
export type ScenarioKey = 'pe' | 'pb' | 'ps';
export type ScenarioBasis = {
  value: number;
  unit: 'TWD/share';
  period: string;
  publishedAt: string;
  source: string;
  kind: 'reported' | 'forecast';
  shareBasis: string;
};
export type ScenarioMultiples = {
  low: number;
  high: number;
  reason: string;
  source: string;
  period: string;
  sampleSize: number;
  peerComparability: string;
  cycle: string;
  growth: string;
  earningsStability: string;
  cash: string;
  debt: string;
  shareBasis: string;
};
export type ScenarioRowInput = { key: ScenarioKey; basis?: ScenarioBasis | null; multiples?: ScenarioMultiples | null };
export type ScenarioRow = ScenarioRowInput & { low: number | null; high: number | null; reason: string | null };
export type ValuationScenario = {
  status: 'consensus' | 'insufficient' | 'divergent';
  low: number | null;
  high: number | null;
  validCount: number;
  asOf: string | null;
  rows: ScenarioRow[];
};

export const SCENARIO_LABELS: Record<ScenarioKey, string> = { pe: 'PE 本益比', pb: 'PB 股價淨值比', ps: 'PS 股價營收比' };
export const SCENARIO_BASES: Record<ScenarioKey, string> = { pe: '每股獲利', pb: '每股淨值', ps: '每股營收' };

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function buildValuationScenario(asOf: string | null, inputs: ScenarioRowInput[]): ValuationScenario {
  const rows: ScenarioRow[] = (['pe', 'pb', 'ps'] as const).map((key) => {
    const { basis, multiples } = inputs.find((input) => input.key === key) || { key };
    const no = (reason: string): ScenarioRow => ({ key, basis, multiples, low: null, high: null, reason });
    if (!basis) return no(`缺已公開、可核對的${SCENARIO_BASES[key]}與公告日`);
    if (!Number.isFinite(basis.value) || basis.value <= 0) return no(`${SCENARIO_BASES[key]}≤0，不適用`);
    if (!basis.publishedAt || !asOf || !isDate(basis.publishedAt) || !isDate(asOf) || basis.publishedAt > asOf) return no('公告日晚於估值日或日期不明');
    if (!basis.period || !basis.source || basis.unit !== 'TWD/share' || !basis.shareBasis) return no('缺幣別、期間、來源或股數基準');
    if (!multiples) return no('缺有依據的估值倍數區間');
    if (!Number.isFinite(multiples.low) || !Number.isFinite(multiples.high) || multiples.low <= 0 || multiples.high < multiples.low) return no('倍數區間無效');
    if (!multiples.reason || !multiples.source || !multiples.period || !Number.isFinite(multiples.sampleSize) || multiples.sampleSize < 3 ||
        !multiples.peerComparability || !multiples.cycle || !multiples.growth ||
        !multiples.earningsStability || !multiples.cash || !multiples.debt) return no('倍數缺可比同業、期間、樣本或風險判斷');
    if (multiples.shareBasis !== basis.shareBasis) return no('倍數與財報股數基準不一致');
    return { key, basis, multiples, low: basis.value * multiples.low, high: basis.value * multiples.high, reason: null };
  });
  const valid = rows.filter((row) => row.low != null && row.high != null);
  if (valid.length !== 3) return { status: 'insufficient', low: null, high: null, validCount: valid.length, asOf, rows };
  const low = Math.max(...valid.map((r) => Number(r.low)));
  const high = Math.min(...valid.map((r) => Number(r.high)));
  if (low >= high) return { status: 'divergent', low: null, high: null, validCount: 3, asOf, rows };
  return { status: 'consensus', low, high, validCount: 3, asOf, rows };
}