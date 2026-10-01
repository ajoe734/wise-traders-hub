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
  /** v2：一個資料期一份證據；months 為該期月末代表點數。 */
  firstDate?: string; months?: number; closeMin?: number; closeMax?: number; multipleMin?: number; multipleMax?: number;
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
  /** low：只列明細，不在主圖合成區間。 */
  confidence?: 'normal' | 'low';
  caveats?: string[];
};
export type ScenarioRowInput = {
  key: ScenarioKey; basis?: ScenarioBasis | null; multiples?: ScenarioMultiples | null;
  /** 上游判定的不適用原因（虧損、股數無法核對、樣本不足）。 */ notApplicable?: string | null; samples?: ScenarioSample[];
  /** v2：分母本身的問題（與倍數信心分開）。 */ basisIssue?: string | null;
  /** v2：倍數依據不足的原因（分母仍可用）。 */ multipleIssue?: string | null;
  /** v2.4：景氣相近期不足時的全期歷史低信心參考（倍數），非合理價、不參與合成。 */
  reference?: { scope: 'all'; label: string; low: number; high: number; sampleSize: number; period: string; note: string } | null;
};
export type ScenarioRow = ScenarioRowInput & {
  low: number | null; high: number | null; reason: string | null;
  /** 分母是否通過核實（與倍數無關）。 */
  basisOk: boolean;
  /** 倍數信心：peer／history／low（有區間但信心低）／insufficient（依據不足）／null（分母不適用）。 */
  confidence: 'peer' | 'history' | 'low' | 'insufficient' | null;
};
export type ValuationScenario = {
  /**
   * consensus：三尺皆為可比同業倍數且有交集（同業倍數情境，仍非保證）。
   * historical：三尺有效且有交集，但至少一尺倍數來自本公司歷史 → 只能稱「歷史情境參考」。
   * lowConfidence：三尺分母與倍數區間都算得出，但至少一尺倍數信心低 → 只列明細，不合成。
   */
  status: 'consensus' | 'historical' | 'lowConfidence' | 'insufficient' | 'divergent';
  /** 財報分母通過核實的尺數（與倍數信心分開顯示）。 */
  basisCount: number;
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

function basisProblem(key: ScenarioKey, basis: ScenarioBasis | null | undefined, asOf: string | null, notApplicable?: string | null, basisIssue?: string | null): string | null {
  if (!basis) return basisIssue || notApplicable || `缺已公開、可核對的${SCENARIO_BASES[key]}與公告日`;
  if (!Number.isFinite(basis.value) || basis.value <= 0) return `${SCENARIO_BASES[key]}≤0，不適用`;
  if (!basis.publishedAt || !asOf || !isDate(basis.publishedAt) || !isDate(asOf) || basis.publishedAt > asOf) return '公告日晚於估值日或日期不明';
  if (!basis.period || !basis.source || basis.unit !== 'TWD/share' || !basis.shareBasis) return '缺幣別、期間、來源或股數基準';
  return null;
}

export function buildValuationScenario(asOf: string | null, inputs: ScenarioRowInput[]): ValuationScenario {
  const rows: ScenarioRow[] = (['pe', 'pb', 'ps'] as const).map((key) => {
    const input = (inputs.find((i) => i.key === key) || { key }) as ScenarioRowInput;
    const { basis, multiples, notApplicable, samples, basisIssue, multipleIssue, reference } = input;
    const bp = basisProblem(key, basis, asOf, notApplicable, basisIssue);
    const common = { key, basis, multiples, samples, basisIssue: basisIssue ?? null, multipleIssue: multipleIssue ?? null, notApplicable, reference: reference ?? null };
    if (bp) return { ...common, low: null, high: null, reason: bp, basisOk: false, confidence: null };
    const no = (reason: string): ScenarioRow => ({ ...common, low: null, high: null, reason, basisOk: true, confidence: 'insufficient' });
    if (!multiples) return no(multipleIssue || notApplicable || '缺有依據的估值倍數區間');
    if (!Number.isFinite(multiples.low) || !Number.isFinite(multiples.high) || multiples.low <= 0 || multiples.high < multiples.low) return no('倍數區間無效');
    if (!multiples.reason || !multiples.source || !multiples.period || !Number.isFinite(multiples.sampleSize) || multiples.sampleSize < 3 ||
        !multiples.peerComparability || !multiples.cycle || !multiples.growth ||
        !multiples.earningsStability || !multiples.cash || !multiples.debt) return no('倍數缺可比同業、期間、樣本或風險判斷');
    if (multiples.shareBasis !== basis!.shareBasis) return no('倍數與財報股數基準不一致');
    const confidence = multiples.confidence === 'low' ? 'low' : multiples.method === 'peer' ? 'peer' : 'history';
    return { ...common, low: basis!.value * multiples.low, high: basis!.value * multiples.high, reason: null, basisOk: true, confidence };
  });
  const basisCount = rows.filter((r) => r.basisOk).length;
  const valid = rows.filter((row) => row.low != null && row.high != null);
  if (valid.length !== 3) return { status: 'insufficient', low: null, high: null, validCount: valid.length, basisCount, asOf, rows };
  const low = Math.max(...valid.map((r) => Number(r.low)));
  const high = Math.min(...valid.map((r) => Number(r.high)));
  if (low >= high) return { status: 'divergent', low: null, high: null, validCount: 3, basisCount, asOf, rows };
  if (valid.some((r) => r.confidence === 'low')) return { status: 'lowConfidence', low: null, high: null, validCount: 3, basisCount, asOf, rows };
  const allPeer = valid.every((r) => r.multiples?.method === 'peer');
  return { status: allPeer ? 'consensus' : 'historical', low, high, validCount: 3, basisCount, asOf, rows };
}

// ─────────────── 我的情境試算（任一使用者自行輸入；只存本機，不寫資料庫，不代表老師或平台觀點） ───────────────

/** 個人試算的唯一顯示名稱；UI、價格軸圖例、無障礙描述一律引用，避免冒稱老師背書。 */
export const MY_SCENARIO_LABEL = '我的情境試算（僅此裝置，非老師觀點、非合理價）';

export type CustomMultipleInput = { low: number | null; high: number | null };
export type CustomScenarioInput = {
  pe: CustomMultipleInput; pb: CustomMultipleInput; ps: CustomMultipleInput;
  source: string; date: string; assumption: string;
};
export type CustomScenario = {
  status: 'ready' | 'divergent' | 'invalid' | 'empty';
  low: number | null; high: number | null;
  problems: string[];
  rows: Array<{ key: ScenarioKey; basis: number | null; low: number | null; high: number | null; note: string | null }>;
};

export const EMPTY_CUSTOM: CustomScenarioInput = {
  pe: { low: null, high: null }, pb: { low: null, high: null }, ps: { low: null, high: null }, source: '', date: '', assumption: '',
};

/**
 * 自訂倍數 × 已核實分母。必須寫明來源、日期、假設；只用分母已核實的尺，至少一尺。
 * 多尺取交集；無交集回 divergent，不給單一區間。結果一律標 MY_SCENARIO_LABEL。
 */
export function buildCustomScenario(scenario: ValuationScenario | null, input: CustomScenarioInput | null, today: string): CustomScenario {
  const rows = (['pe', 'pb', 'ps'] as const).map((key) => {
    const r = scenario?.rows.find((x) => x.key === key);
    const m = input?.[key];
    const basis = r?.basisOk && r.basis ? r.basis.value : null;
    const has = m && m.low != null && m.high != null;
    if (!has) return { key, basis, low: null, high: null, note: null };
    if (basis == null) return { key, basis, low: null, high: null, note: `${SCENARIO_LABELS[key]}分母未核實，不套用` };
    if (!(m!.low! > 0) || !(m!.high! >= m!.low!)) return { key, basis, low: null, high: null, note: '倍數需大於 0 且上限 ≥ 下限' };
    return { key, basis, low: basis * m!.low!, high: basis * m!.high!, note: null };
  });
  const anyInput = rows.some((r) => r.low != null || r.note != null);
  if (!input || !anyInput) return { status: 'empty', low: null, high: null, problems: [], rows };
  const problems: string[] = [];
  if (!input.source.trim()) problems.push('缺倍數依據');
  if (!isDate(input.date)) problems.push('日期需為 YYYY-MM-DD');
  else if (input.date > today) problems.push('日期不可晚於今天');
  if (!input.assumption.trim()) problems.push('缺假設說明');
  rows.forEach((r) => { if (r.note) problems.push(r.note); });
  const usable = rows.filter((r) => r.low != null && r.high != null);
  if (!usable.length) problems.push('至少需一把尺有已核實分母與倍數');
  if (problems.length) return { status: 'invalid', low: null, high: null, problems, rows };
  const low = Math.max(...usable.map((r) => r.low!));
  const high = Math.min(...usable.map((r) => r.high!));
  if (low >= high) return { status: 'divergent', low: null, high: null, problems: [], rows };
  return { status: 'ready', low, high, problems: [], rows };
}

/** 歷史估值參考帶（每尺一條，低信心、非合理價）：信心低的本公司歷史區間，或全期歷史參考。同業/一般信心區間不在此列。 */
export type ReferenceBand = { key: ScenarioKey; low: number; high: number; label: string; sampleSize: number; period: string };
export function historyReferenceBands(band: ValuationScenario | null | undefined): ReferenceBand[] {
  if (!band || band.status === 'consensus' || band.status === 'historical') return [];
  const out: ReferenceBand[] = [];
  for (const r of band.rows) {
    if (!r.basisOk || !r.basis) continue;
    if (r.low != null && r.high != null && r.multiples && r.multiples.method !== 'peer') {
      out.push({ key: r.key, low: r.low, high: r.high, label: '景氣相近期歷史參考', sampleSize: r.multiples.sampleSize, period: r.multiples.period });
    } else if (r.reference && r.reference.low > 0 && r.reference.high >= r.reference.low) {
      out.push({ key: r.key, low: r.basis.value * r.reference.low, high: r.basis.value * r.reference.high, label: '全期歷史參考（景氣不同）', sampleSize: r.reference.sampleSize, period: r.reference.period });
    }
  }
  return out;
}

/** 三尺歷史參考帶的交集（需三帶齊全且重疊）；只稱「三尺重疊參考」，不是合理價。 */
export function referenceOverlap(refs: ReferenceBand[]): { low: number; high: number } | null {
  if (refs.length !== 3) return null;
  const low = Math.max(...refs.map((r) => r.low)); const high = Math.min(...refs.map((r) => r.high));
  return low < high ? { low, high } : null;
}
