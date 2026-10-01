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
  /** 原始科目 ÷ 股數 的可核對算式。 */
  derivation?: string;
  /** 可得性說明：live=資料期＋取得時間；asOf=法定申報期限（非實際公告日）。 */
  availability?: { mode: 'live' | 'asOf'; dataPeriod: string; deadline: string; fetchedAt?: string; note: string } | null;
};
export type ScenarioSample = {
  quarter: string; deadline: string; date: string; close: number; basis: number; multiple: number;
  growthYoY: number | null; netMargin: number | null; cashRatio: number | null; debtRatio: number | null;
  used: boolean; excluded: string | null;
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
  /** peer=可比同業同日倍數；history=本公司歷史（只能稱「歷史情境參考」）。缺值視為 history（保守）。 */
  method?: 'peer' | 'history';
  label?: string;
  dispersion?: number;
  caveats?: string[];
};
export type ScenarioRowInput = { key: ScenarioKey; basis?: ScenarioBasis | null; multiples?: ScenarioMultiples | null; /** 上游判定的不適用原因（虧損、股數無法核對、樣本不足）。 */ notApplicable?: string | null; samples?: ScenarioSample[] };
export type ScenarioRow = ScenarioRowInput & { low: number | null; high: number | null; reason: string | null };
export type ValuationScenario = {
  /**
   * consensus：三尺皆為可比同業倍數且有交集（同業倍數情境，仍非保證）。
   * historical：三尺有效且有交集，但至少一尺倍數來自本公司歷史 → 只能稱「歷史情境參考」。
   */
  status: 'consensus' | 'historical' | 'insufficient' | 'divergent';
  low: number | null;
  high: number | null;
  validCount: number;
  asOf: string | null;
  rows: ScenarioRow[];
};

export const SCENARIO_LABELS: Record<ScenarioKey, string> = { pe: 'PE 本益比', pb: 'PB 股價淨值比', ps: 'PS 股價營收比' };
export function multiplesLabel(m?: ScenarioMultiples | null): string {
  return m?.method === 'peer' ? (m.label || '同業倍數情境') : (m?.label || '本公司歷史情境參考');
}
export const SCENARIO_BASES: Record<ScenarioKey, string> = { pe: '每股獲利', pb: '每股淨值', ps: '每股營收' };

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function buildValuationScenario(asOf: string | null, inputs: ScenarioRowInput[]): ValuationScenario {
  const rows: ScenarioRow[] = (['pe', 'pb', 'ps'] as const).map((key) => {
    const { basis, multiples, notApplicable, samples } = (inputs.find((input) => input.key === key) || { key }) as ScenarioRowInput;
    const no = (reason: string): ScenarioRow => ({ key, basis, multiples, samples, low: null, high: null, reason });
    if (!basis) return no(notApplicable || `缺已公開、可核對的${SCENARIO_BASES[key]}與公告日`);
    if (!Number.isFinite(basis.value) || basis.value <= 0) return no(`${SCENARIO_BASES[key]}≤0，不適用`);
    if (!basis.publishedAt || !asOf || !isDate(basis.publishedAt) || !isDate(asOf) || basis.publishedAt > asOf) return no('公告日晚於估值日或日期不明');
    if (!basis.period || !basis.source || basis.unit !== 'TWD/share' || !basis.shareBasis) return no('缺幣別、期間、來源或股數基準');
    if (!multiples) return no(notApplicable || '缺有依據的估值倍數區間');
    if (!Number.isFinite(multiples.low) || !Number.isFinite(multiples.high) || multiples.low <= 0 || multiples.high < multiples.low) return no('倍數區間無效');
    if (!multiples.reason || !multiples.source || !multiples.period || !Number.isFinite(multiples.sampleSize) || multiples.sampleSize < 3 ||
        !multiples.peerComparability || !multiples.cycle || !multiples.growth ||
        !multiples.earningsStability || !multiples.cash || !multiples.debt) return no('倍數缺可比同業、期間、樣本或風險判斷');
    if (multiples.shareBasis !== basis.shareBasis) return no('倍數與財報股數基準不一致');
    return { key, basis, multiples, samples, low: basis.value * multiples.low, high: basis.value * multiples.high, reason: null };
  });
  const valid = rows.filter((row) => row.low != null && row.high != null);
  if (valid.length !== 3) return { status: 'insufficient', low: null, high: null, validCount: valid.length, asOf, rows };
  const low = Math.max(...valid.map((r) => Number(r.low)));
  const high = Math.min(...valid.map((r) => Number(r.high)));
  if (low >= high) return { status: 'divergent', low: null, high: null, validCount: 3, asOf, rows };
  const allPeer = valid.every((r) => r.multiples?.method === 'peer');
  return { status: allPeer ? 'consensus' : 'historical', low, high, validCount: 3, asOf, rows };
}