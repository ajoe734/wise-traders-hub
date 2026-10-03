import { PERIOD_RE, periodMismatch, isForwardPeriod } from './forwardValuation';
import { taipeiDateIso } from '@/lib/taipeiWeek';
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
  /** 真正的實際公告日（若來源有提供）；有則一律以它對行情日驗證。 */
  announcedAt?: string | null;
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
   * 此狀態只描述逐尺證據品質，不代表三尺可合成單一價格。
   * consensus：至少一尺有可比同業證據；historical：至少一尺只有公司歷史證據；
   * lowConfidence：至少一尺只有低信心歷史證據；insufficient：沒有可用倍數證據。
   * divergent 保留給舊資料相容，前端不得再把三尺交集或分歧當估值結論。
   */
  status: 'consensus' | 'historical' | 'lowConfidence' | 'insufficient' | 'divergent';
  /** 財報分母通過核實的尺數（與倍數信心分開顯示）。 */
  basisCount: number;
  low: number | null;
  high: number | null;
  validCount: number;
  asOf: string | null;
  rows: ScenarioRow[];
  /** 股數核對來源只供前端精確陳述，不參與任何財報或估值計算。 */
  shareVerification?: {
    source: 'official' | 'fallback' | 'unknown';
    preferredUnknown: boolean;
  };
};

export const SCENARIO_LABELS: Record<ScenarioKey, string> = { pe: 'PE 本益比', pb: 'PB 股價淨值比', ps: 'PS 股價營收比' };
export function multiplesLabel(m?: ScenarioMultiples | null): string {
  return m?.method === 'peer' ? (m.label || '同業倍數情境') : (m?.label || '本公司歷史情境參考');
}
export const SCENARIO_BASES: Record<ScenarioKey, string> = { pe: '每股獲利', pb: '每股淨值', ps: '每股營收' };

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * 日期判定：法定申報期限不是實際公告日，不能拿來證明資料早於行情日。
 * 1. 有實際公告日 → 必須 ≤ 行情日。
 * 2. live（今日估值）→ 驗真實取得時間 fetchedAt 合法且不晚於本次分析時間；屬「最新可讀資料」，實際公告日未核，非歷史時點還原。
 * 3. 其他（asOf／歷史）→ publishedAt 必須 ≤ 行情日，不使用未來已知資料。
 */
export function basisDateProblem(basis: ScenarioBasis, asOf: string | null, now: number = Date.now()): string | null {
  if (!asOf || !isDate(asOf)) return '行情日不明';
  if (basis.announcedAt != null && basis.announcedAt !== '') {
    return isDate(basis.announcedAt) && basis.announcedAt <= asOf ? null : '實際公告日晚於行情日或日期不明';
  }
  const av = basis.availability;
  if (av?.mode === 'live') {
    const t = av.fetchedAt ? Date.parse(av.fetchedAt) : NaN;
    if (!Number.isFinite(t)) return '財報取得時間不明';
    if (t > now) return '財報取得時間晚於本次分析時間';
    return null;
  }
  if (!basis.publishedAt || !isDate(basis.publishedAt) || basis.publishedAt > asOf) return '公告日晚於估值日或日期不明';
  return null;
}

/** live 模式的日期標示：取得日與行情日分開，明示實際公告日未核。 */
export function basisDateLabel(basis: ScenarioBasis, asOf: string | null): string | null {
  const av = basis.availability;
  if (basis.announcedAt) return `實際公告日 ${basis.announcedAt.split('-').join('/')} · 行情日 ${asOf ? asOf.split('-').join('/') : '不明'}`;
  if (av?.mode !== 'live' || !av.fetchedAt) return null;
  const t = Date.parse(av.fetchedAt);
  const fetchedDay = Number.isFinite(t) ? taipeiDateIso(t) : av.fetchedAt.slice(0, 10);
  return `財報取得日 ${fetchedDay.split('-').join('/')}（台灣時間） · 行情日 ${asOf ? asOf.split('-').join('/') : '不明'} · 實際公告日未核，非歷史時點還原`;
}

function basisProblem(key: ScenarioKey, basis: ScenarioBasis | null | undefined, asOf: string | null, notApplicable?: string | null, basisIssue?: string | null, now: number = Date.now()): string | null {
  if (!basis) return basisIssue || notApplicable || `缺已公開、可核對的${SCENARIO_BASES[key]}與公告日`;
  if (!Number.isFinite(basis.value) || basis.value <= 0) return `${SCENARIO_BASES[key]}≤0，不適用`;
  const dp = basisDateProblem(basis, asOf, now);
  if (dp) return dp;
  if (!basis.period || !basis.source || basis.unit !== 'TWD/share' || !basis.shareBasis) return '缺幣別、期間、來源或股數基準';
  return null;
}

export function buildValuationScenario(asOf: string | null, inputs: ScenarioRowInput[], now: number = Date.now()): ValuationScenario {
  const rows: ScenarioRow[] = (['pe', 'pb', 'ps'] as const).map((key) => {
    const input = (inputs.find((i) => i.key === key) || { key }) as ScenarioRowInput;
    const { basis, multiples, notApplicable, samples, basisIssue, multipleIssue, reference } = input;
    const bp = basisProblem(key, basis, asOf, notApplicable, basisIssue, now);
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
  const status: ValuationScenario['status'] = valid.length !== 3
    ? 'insufficient'
    : valid.some((r) => r.confidence === 'low')
      ? 'lowConfidence'
      : valid.some((r) => r.multiples?.method !== 'peer')
        ? 'historical'
        : 'consensus';
  // 三把尺回答不同問題，禁止在此把各尺價格區間求交集。
  return { status, low: null, high: null, validCount: valid.length, basisCount, asOf, rows };
}

// ─────────────── 我的情境試算（任一使用者自行輸入；只存本機，不寫資料庫，不代表老師或平台觀點） ───────────────

/** 個人試算的唯一顯示名稱；UI、價格軸圖例、無障礙描述一律引用，避免冒稱老師背書。 */
export const MY_SCENARIO_LABEL = '我的情境試算（僅此裝置，非老師觀點、非合理價）';

export type CustomMultipleInput = { low: number | null; high: number | null };
export type CustomScenarioInput = {
  version: 2;
  primaryKey: ScenarioKey | null;
  expectedBasis: number | null;
  multiple: CustomMultipleInput;
  stressBasis: number | null;
  stressMultiple: number | null;
  source: string;
  date: string;
  assumption: string;
  invalidation: string;
  /** 前瞻補強（v2 欄位，舊資料缺值時要求補填，不靜默改寫）。 */
  basisPeriod?: string;
  basisSource?: string;
  basisDate?: string;
  multipleKind?: 'forward' | 'ttm' | null;
  ownSamples?: string;
  peerMultiple?: number | null;
  peerSource?: string;
  peerAdjustment?: string;
  /** v1 多尺資料只保留供使用者確認，永不自動套用。 */
  legacy?: {
    pe: CustomMultipleInput; pb: CustomMultipleInput; ps: CustomMultipleInput;
    source: string; date: string; assumption: string;
  } | null;
};
export type CustomScenario = {
  status: 'ready' | 'invalid' | 'empty' | 'needsReview';
  low: number | null; high: number | null;
  stress: number | null;
  key: ScenarioKey | null;
  problems: string[];
  rows: Array<{ key: ScenarioKey; basis: number | null; low: number | null; high: number | null; note: string | null }>;
};

export const EMPTY_CUSTOM: CustomScenarioInput = {
  version: 2, primaryKey: null, expectedBasis: null, multiple: { low: null, high: null },
  stressBasis: null, stressMultiple: null, source: '', date: '', assumption: '', invalidation: '', legacy: null,
  basisPeriod: '', basisSource: '', basisDate: '', multipleKind: null, ownSamples: '', peerMultiple: null, peerSource: '', peerAdjustment: '',
};

/**
 * 單一主要尺的預期分母 × 倍數。必須寫明來源、日期、假設、推翻條件與壓力輸入。
 * 財報分母只用來確認該尺目前可用，不代替使用者明示的未來分母。
 */
export function buildCustomScenario(scenario: ValuationScenario | null, input: CustomScenarioInput | null, today: string): CustomScenario {
  const rows = (['pe', 'pb', 'ps'] as const).map((key) => {
    const r = scenario?.rows.find((x) => x.key === key);
    return { key, basis: r?.basisOk && r.basis ? r.basis.value : null, low: null, high: null, note: null };
  });
  const empty = { low: null, high: null, stress: null, key: null, problems: [], rows };
  if (!input) return { status: 'empty', ...empty };
  if (input.legacy && !input.primaryKey) return { status: 'needsReview', ...empty };
  if (!input.primaryKey && input.expectedBasis == null && input.multiple.low == null && input.multiple.high == null) return { status: 'empty', ...empty };
  const problems: string[] = [];
  const key = input.primaryKey;
  const selected = key ? scenario?.rows.find((r) => r.key === key) : null;
  if (!key) problems.push('請選一把主要尺');
  // 明示前瞻分母（FY／未來四季）× 同期間前瞻倍數：按使用者填的具名前瞻資料驗證，不因歷史 TTM 分母缺口否決；其他口徑仍需歷史分母可用。
  else if (!(isForwardPeriod(input.basisPeriod) && input.multipleKind === 'forward') && !selected?.basisOk) problems.push(`${SCENARIO_LABELS[key]}分母不可用：${selected?.reason || '缺可核實分母'}`);
  if (!(input.expectedBasis != null && Number.isFinite(input.expectedBasis) && input.expectedBasis > 0)) problems.push('請填大於 0 的預期每股分母');
  if (!(input.multiple.low != null && input.multiple.high != null && input.multiple.low > 0 && input.multiple.high >= input.multiple.low)) problems.push('倍數需大於 0 且上限 ≥ 下限');
  if (!(input.stressBasis != null && Number.isFinite(input.stressBasis) && input.stressBasis > 0)) problems.push('請填大於 0 的壓力分母');
  if (!(input.stressMultiple != null && Number.isFinite(input.stressMultiple) && input.stressMultiple > 0)) problems.push('請填大於 0 的壓力倍數');
  if (input.expectedBasis != null && input.stressBasis != null && input.stressBasis > input.expectedBasis) problems.push('壓力分母不得高於預期分母');
  if (input.multiple.low != null && input.stressMultiple != null && input.stressMultiple > input.multiple.low) problems.push('壓力倍數不得高於情境倍數下限');
  if (!PERIOD_RE.test(input.basisPeriod ?? '')) problems.push('請選預期分母期間（年度或未來四季）');
  if (!(input.basisSource ?? '').trim()) problems.push('缺預期分母來源');
  if (!isDate(input.basisDate ?? '')) problems.push('分母資料日需為 YYYY-MM-DD');
  else if ((input.basisDate as string) > today) problems.push('分母資料日不可晚於今天');
  if (input.multipleKind !== 'forward' && input.multipleKind !== 'ttm') problems.push('請選倍數口徑（同期間前瞻或 TTM）');
  const mm = periodMismatch(key, input.basisPeriod, input.multipleKind ?? null);
  if (mm) problems.push(mm);
  if (!input.source.trim()) problems.push('缺倍數依據');
  if (!isDate(input.date)) problems.push('日期需為 YYYY-MM-DD');
  else if (input.date > today) problems.push('日期不可晚於今天');
  if (!input.assumption.trim()) problems.push('缺假設說明');
  if (!input.invalidation.trim()) problems.push('缺推翻條件');
  if (problems.length || !key || input.expectedBasis == null || input.multiple.low == null || input.multiple.high == null || input.stressBasis == null || input.stressMultiple == null) {
    return { status: 'invalid', low: null, high: null, stress: null, key, problems, rows };
  }
  return {
    status: 'ready', key, problems: [], rows,
    low: input.expectedBasis * input.multiple.low,
    high: input.expectedBasis * input.multiple.high,
    stress: input.stressBasis * input.stressMultiple,
  };
}

/** 歷史估值參考帶（每尺一條，低信心、非合理價）：信心低的本公司歷史區間，或全期歷史參考。同業/一般信心區間不在此列。 */
export type ReferenceBand = { key: ScenarioKey; low: number; high: number; label: string; sampleSize: number; period: string };
export function historyReferenceBands(band: ValuationScenario | null | undefined): ReferenceBand[] {
  if (!band || band.status === 'consensus' || band.status === 'historical') return [];
  const out: ReferenceBand[] = [];
  for (const r of band.rows ?? []) {
    if (!r.basisOk || !r.basis) continue;
    if (r.low != null && r.high != null && r.multiples && r.multiples.method !== 'peer') {
      out.push({ key: r.key, low: r.low, high: r.high, label: '景氣相近期歷史參考', sampleSize: r.multiples.sampleSize, period: r.multiples.period });
    } else if (r.reference && r.reference.low > 0 && r.reference.high >= r.reference.low) {
      out.push({ key: r.key, low: r.basis.value * r.reference.low, high: r.basis.value * r.reference.high, label: '全期歷史參考（景氣不同）', sampleSize: r.reference.sampleSize, period: r.reference.period });
    }
  }
  return out;
}

