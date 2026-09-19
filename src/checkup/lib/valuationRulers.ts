/**
 * 估值三把尺 —— 唯一 canonical 計算層（純函式，零 I/O）。
 *
 * 三把尺固定為：
 *   1. 本益比 P/E        = 最新收盤價 ÷ TTM EPS（採交易所公告口徑）
 *   2. 股價淨值比 P/B    = 最新收盤價 ÷ 最新每股淨值 BVPS（採交易所公告口徑）
 *   3. 現金殖利率 yield% = 近 12 個月已宣告現金股利 ÷ 最新收盤價（採交易所公告口徑）
 *
 * 契約（VALUATION_RULERS_V1）：
 *   - 分母無效（EPS <= 0、BVPS <= 0、缺值）一律回 band='na'，**不得**補 0 或硬算。
 *   - 分位以「個股自身近 5 年逐日序列」計算；樣本 < MIN_HISTORY_SAMPLES 標資料不足。
 *   - 殖利率方向相反：分位越高代表越便宜。
 *   - 同業中位數前先 winsorize（5%/95%），保留樣本數 n；n < MIN_PEER_N 不顯示中位數。
 *   - 任何輸出都不得含買賣建議字眼。
 */

export type RulerKey = 'pe' | 'pb' | 'dividendYield';
export type Band = 'low' | 'fair' | 'high' | 'na';
export type NaReason =
  | 'missing'
  | 'non_positive_denominator'
  | 'no_dividend'
  | 'insufficient_history';

/** 分位門檻：<=30% 偏低、30–70% 合理、>=70% 偏高。 */
export const PERCENTILE_LOW = 30;
export const PERCENTILE_HIGH = 70;
/** 近 5 年逐日序列至少要這麼多筆才算「有歷史」。 */
export const MIN_HISTORY_SAMPLES = 250;
/** 同業母體至少 3 家才給中位數。 */
export const MIN_PEER_N = 3;
export const WINSOR_LOWER = 0.05;
export const WINSOR_UPPER = 0.95;

export const BAND_LABEL: Record<Band, string> = {
  low: '偏低',
  fair: '合理',
  high: '偏高',
  na: '不適用',
};

export const NA_REASON_LABEL: Record<NaReason, string> = {
  missing: '資料不足',
  non_positive_denominator: '不適用（近四季無獲利）',
  no_dividend: '不適用（近 12 個月無現金股利）',
  insufficient_history: '資料不足（歷史樣本不足）',
};

export const RULER_LABEL: Record<RulerKey, string> = {
  pe: '本益比',
  pb: '股價淨值比',
  dividendYield: '現金殖利率',
};

export interface RulerResult {
  key: RulerKey;
  /** 目前值；無效時為 null。 */
  value: number | null;
  /** 個股自身近 5 年分位（0–100）；無法計算時 null。 */
  percentile: number | null;
  band: Band;
  naReason: NaReason | null;
  /** 歷史樣本數（winsorize 前）。 */
  sampleSize: number;
  label: string;
  bandLabel: string;
}

export interface ValuationSummary {
  low: number;
  fair: number;
  high: number;
  na: number;
  /** 有效尺 < 2 時為 null。 */
  overall: Band | null;
  text: string;
}

export interface PeerStat {
  key: RulerKey;
  /** winsorize 後的中位數；n < MIN_PEER_N 時 null。 */
  median: number | null;
  /** 有效樣本數（排除無效分母後、winsorize 前）。 */
  n: number;
  /** 溢價 / 折價：value ÷ median − 1；任一方無效時 null。 */
  premium: number | null;
  label: string;
}

export interface PeerRow {
  symbol: string;
  name?: string;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
}

// ── 基礎數值工具 ────────────────────────────────────────────────

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** P/E 與 P/B 的有效性：必須為正數（分母 <= 0 代表虧損或淨值為負）。 */
export function isValidMultiple(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0;
}

/** 殖利率有效性：>= 0 即有效；0 代表無配息，另以 no_dividend 表達。 */
export function isValidYield(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}

export function median(values: number[]): number | null {
  const arr = values.filter(isFiniteNumber).slice().sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const mid = arr.length >> 1;
  return arr.length % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

/** 依 quantile 取值（linear interpolation），q 介於 0–1。 */
export function quantile(values: number[], q: number): number | null {
  const arr = values.filter(isFiniteNumber).slice().sort((a, b) => a - b);
  if (arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  const pos = (arr.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
}

/** 極端值處理：把超出 5%/95% 的值夾回邊界（不是丟棄，樣本數不變）。 */
export function winsorize(
  values: number[],
  lower = WINSOR_LOWER,
  upper = WINSOR_UPPER,
): number[] {
  const arr = values.filter(isFiniteNumber);
  if (arr.length === 0) return [];
  const lo = quantile(arr, lower);
  const hi = quantile(arr, upper);
  if (lo == null || hi == null) return arr.slice();
  return arr.map((v) => Math.min(hi, Math.max(lo, v)));
}

/**
 * 分位：序列中 <= value 的比例（0–100），四捨五入到小數 1 位。
 * 空序列回 null。
 */
export function percentileRank(series: number[], value: number): number | null {
  const arr = series.filter(isFiniteNumber);
  if (arr.length === 0 || !isFiniteNumber(value)) return null;
  const le = arr.reduce((acc, v) => acc + (v <= value ? 1 : 0), 0);
  return Math.round((le / arr.length) * 1000) / 10;
}

// ── 單把尺 ──────────────────────────────────────────────────────

/**
 * 由分位換算 band。
 * `inverted=true`（殖利率）時分位越高代表越便宜。
 */
export function bandFromPercentile(pct: number, inverted = false): Band {
  const cheapSide = inverted ? pct >= PERCENTILE_HIGH : pct <= PERCENTILE_LOW;
  const richSide = inverted ? pct <= PERCENTILE_LOW : pct >= PERCENTILE_HIGH;
  if (cheapSide) return 'low';
  if (richSide) return 'high';
  return 'fair';
}

export interface RulerInput {
  value: number | null | undefined;
  history: number[];
}

export function computeRuler(key: RulerKey, input: RulerInput): RulerResult {
  const label = RULER_LABEL[key];
  const raw = input?.value;
  const history = Array.isArray(input?.history) ? input.history.filter(isFiniteNumber) : [];

  const base = (band: Band, naReason: NaReason | null, value: number | null, percentile: number | null): RulerResult => ({
    key,
    value,
    percentile,
    band,
    naReason,
    sampleSize: history.length,
    label,
    bandLabel: band === 'na' ? NA_REASON_LABEL[naReason || 'missing'] : BAND_LABEL[band],
  });

  if (key === 'dividendYield') {
    if (!isValidYield(raw)) return base('na', 'missing', null, null);
    if (raw === 0) return base('na', 'no_dividend', 0, null);
  } else if (!isFiniteNumber(raw)) {
    return base('na', 'missing', null, null);
  } else if (raw <= 0) {
    return base('na', 'non_positive_denominator', null, null);
  }

  const value = raw as number;
  const validHistory = key === 'dividendYield' ? history.filter((v) => v >= 0) : history.filter((v) => v > 0);
  if (validHistory.length < MIN_HISTORY_SAMPLES) {
    return {
      ...base('na', 'insufficient_history', value, null),
      sampleSize: validHistory.length,
    };
  }

  const pct = percentileRank(validHistory, value);
  if (pct == null) {
    return { ...base('na', 'insufficient_history', value, null), sampleSize: validHistory.length };
  }
  const band = bandFromPercentile(pct, key === 'dividendYield');
  return {
    ...base(band, null, value, pct),
    sampleSize: validHistory.length,
  };
}

// ── 三尺總結 ────────────────────────────────────────────────────

export function summarizeRulers(rulers: RulerResult[]): ValuationSummary {
  const counts = { low: 0, fair: 0, high: 0, na: 0 };
  for (const r of rulers) counts[r.band] += 1;

  const effective = counts.low + counts.fair + counts.high;
  if (effective < 2) {
    return { ...counts, overall: null, text: '資料不足，暫不判定整體估值' };
  }

  let overall: Band;
  if (counts.low > counts.high && counts.low >= counts.fair) overall = 'low';
  else if (counts.high > counts.low && counts.high >= counts.fair) overall = 'high';
  else overall = 'fair';

  const parts: string[] = [];
  if (counts.low) parts.push(`${counts.low} 把偏低`);
  if (counts.fair) parts.push(`${counts.fair} 把合理`);
  if (counts.high) parts.push(`${counts.high} 把偏高`);
  if (counts.na) parts.push(`${counts.na} 把不適用`);

  return {
    ...counts,
    overall,
    text: `${parts.join('、')}｜整體估值${BAND_LABEL[overall]}`,
  };
}

// ── 同業比較 ────────────────────────────────────────────────────

function peerValues(rows: PeerRow[], key: RulerKey): number[] {
  const out: number[] = [];
  for (const r of rows || []) {
    const v = r?.[key];
    if (key === 'dividendYield') {
      if (isValidYield(v) && (v as number) > 0) out.push(v as number);
    } else if (isValidMultiple(v)) {
      out.push(v as number);
    }
  }
  return out;
}

export function computePeerStat(key: RulerKey, selfValue: number | null, rows: PeerRow[]): PeerStat {
  const values = peerValues(rows, key);
  const n = values.length;
  if (n < MIN_PEER_N) {
    return { key, median: null, n, premium: null, label: RULER_LABEL[key] };
  }
  const med = median(winsorize(values));
  const usableSelf = key === 'dividendYield' ? (isValidYield(selfValue) && (selfValue as number) > 0) : isValidMultiple(selfValue);
  const premium = med != null && med > 0 && usableSelf ? (selfValue as number) / med - 1 : null;
  return {
    key,
    median: med == null ? null : Math.round(med * 100) / 100,
    n,
    premium: premium == null ? null : Math.round(premium * 1000) / 1000,
    label: RULER_LABEL[key],
  };
}

/** 依與個股的倍數距離排序，取最接近的 N 家（預設 3）。其餘由呼叫端放展開區。 */
export function nearestPeers(selfPe: number | null, rows: PeerRow[], limit = 3): PeerRow[] {
  const list = (rows || []).filter((r) => isValidMultiple(r?.pe));
  if (!isValidMultiple(selfPe)) return list.slice(0, limit);
  return list
    .slice()
    .sort((a, b) => Math.abs((a.pe as number) - (selfPe as number)) - Math.abs((b.pe as number) - (selfPe as number)))
    .slice(0, limit);
}

export function formatPremium(premium: number | null): string {
  if (premium == null) return '—';
  const pct = premium * 100;
  const rounded = Math.round(pct * 10) / 10;
  if (Math.abs(rounded) < 0.05) return '與同業中位數相當';
  return rounded > 0 ? `較同業中位數溢價 ${rounded.toFixed(1)}%` : `較同業中位數折價 ${Math.abs(rounded).toFixed(1)}%`;
}

// ── 整段組裝（UI 只吃這個） ─────────────────────────────────────

export interface ValuationSnapshotInput {
  symbol: string;
  asOf: string | null;
  source: string | null;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  history: { pe: number[]; pb: number[]; dividendYield: number[] };
  industry?: string | null;
  peers?: PeerRow[];
}

export interface ValuationView {
  symbol: string;
  asOf: string | null;
  source: string | null;
  industry: string | null;
  rulers: RulerResult[];
  summary: ValuationSummary;
  peerStats: PeerStat[];
  peerCount: number;
  peerInsufficient: boolean;
  nearestPeers: PeerRow[];
  restPeers: PeerRow[];
}

/** 金融股提示：P/E 易受一次性損益影響，改以 P/B 與殖利率為主。 */
export const FINANCIAL_INDUSTRIES = ['金融保險', '金融保險業', '金融業'];

export function isFinancialIndustry(industry?: string | null): boolean {
  if (!industry) return false;
  return FINANCIAL_INDUSTRIES.some((k) => industry.includes(k)) || industry.includes('金控');
}

export function buildValuationView(input: ValuationSnapshotInput): ValuationView {
  const hist = input?.history || { pe: [], pb: [], dividendYield: [] };
  const rulers: RulerResult[] = [
    computeRuler('pe', { value: input?.pe, history: hist.pe || [] }),
    computeRuler('pb', { value: input?.pb, history: hist.pb || [] }),
    computeRuler('dividendYield', { value: input?.dividendYield, history: hist.dividendYield || [] }),
  ];
  const peers = Array.isArray(input?.peers) ? input.peers : [];
  const peerStats: PeerStat[] = [
    computePeerStat('pe', input?.pe ?? null, peers),
    computePeerStat('pb', input?.pb ?? null, peers),
    computePeerStat('dividendYield', input?.dividendYield ?? null, peers),
  ];
  const near = nearestPeers(input?.pe ?? null, peers, 3);
  const nearSet = new Set(near.map((p) => p.symbol));
  return {
    symbol: input?.symbol || '',
    asOf: input?.asOf || null,
    source: input?.source || null,
    industry: input?.industry || null,
    rulers,
    summary: summarizeRulers(rulers),
    peerStats,
    peerCount: peers.length,
    peerInsufficient: peerStats.every((s) => s.median == null),
    nearestPeers: near,
    restPeers: peers.filter((p) => !nearSet.has(p.symbol)),
  };
}

export const VALUATION_RULERS_CONTRACT = 'VALUATION_RULERS_V1';
