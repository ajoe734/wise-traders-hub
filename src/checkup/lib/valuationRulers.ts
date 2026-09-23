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
  // 對稱四捨五入：正負一律看絕對值，避免 -23.45 被進位成 -23.4 而與 +23.45 不對稱
  const rounded = Math.sign(pct) * (Math.round(Math.abs(pct) * 10) / 10);
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
  peerScope?: 'fine' | 'broad' | 'legacy' | null;
  peerIndustry?: string | null;
  peers?: PeerRow[];
  /** RPC 月取樣的估值趨勢（近 5 年，每月最後一個交易日）。 */
  trend?: TrendPoint[];
}

export interface ValuationView {
  symbol: string;
  asOf: string | null;
  source: string | null;
  industry: string | null;
  peerScope: 'fine' | 'broad' | 'legacy';
  peerIndustry: string | null;
  rulers: RulerResult[];
  summary: ValuationSummary;
  peerStats: PeerStat[];
  peerCount: number;
  peerInsufficient: boolean;
  nearestPeers: PeerRow[];
  restPeers: PeerRow[];
  /** 同業明細圖表用：三把尺各自的分布與趨勢（純函式算好，UI 只畫）。 */
  distributions: PeerDistribution[];
  trends: TrendSeries[];
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
    peerScope: input?.peerScope || 'fine',
    peerIndustry: input?.peerIndustry || input?.industry || null,
    rulers,
    summary: summarizeRulers(rulers),
    peerStats,
    peerCount: peers.length,
    peerInsufficient: peerStats.every((s) => s.median == null),
    nearestPeers: near,
    restPeers: peers.filter((p) => !nearSet.has(p.symbol)),
    distributions: RULER_KEYS.map((k) => buildPeerDistribution(k, input?.[k] ?? null, peers)),
    trends: RULER_KEYS.map((k) => buildTrendSeries(k, Array.isArray(input?.trend) ? input.trend : [])),
  };
}

const RULER_KEYS: RulerKey[] = ['pe', 'pb', 'dividendYield'];

export const VALUATION_RULERS_CONTRACT = 'VALUATION_RULERS_V1';

// ── 投組層級：市值加權同業溢折價指數 ────────────────────────────
//
// 設計硬合約：
//   - 權重 = 個股市值；每把尺只納入「該尺能算出溢折價」的檔，權重對納入檔重新正規化。
//   - 單檔溢折價一律重用 computePeerStat（winsorize + MIN_PEER_N 單一來源，禁止重刻）。
//   - 只輸出「高於 / 接近 / 低於同業」的中性描述，不得給買賣建議。

export interface PortfolioValuationInput {
  symbol: string;
  /** 市值（未正規化）；<= 0 或缺值整檔排除。 */
  weight: number;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  peers: PeerRow[];
}

export interface PortfolioRulerAggregate {
  key: RulerKey;
  /** 市值加權溢折價（self ÷ 同業中位數 − 1 的加權平均）；無有效檔時 null。 */
  weightedPremium: number | null;
  /** 納入檔市值占全部候選市值比（0–1）。 */
  coverage: number;
  /** 納入檔數。 */
  n: number;
  label: string;
  /** 中性文字（例：「高於同業」）；weightedPremium 為 null 時為「資料不足」。 */
  text: string;
}

export interface PortfolioValuationResult {
  rulers: PortfolioRulerAggregate[];
  /** 候選總市值（台股且 weight > 0）。 */
  totalWeight: number;
  /** 有任一尺可用的市值。 */
  coveredWeight: number;
  stockCount: number;
}

/** 加權溢折價的中性判讀門檻：|溢折價| < 10% 視為接近同業。 */
export const PORTFOLIO_PREMIUM_NEUTRAL = 0.1;

/**
 * 個股溢折價上限剪裁（winsorize）：高倍數股（如 PB 70x vs 同業 3x）單檔溢價可達 +2000%，
 * 不剪裁會讓投組指數被單一極端股主導。折價端天然有界（最低 −100%），只夾上限。
 */
export const PORTFOLIO_PREMIUM_CAP = 2.0;

function clipPremium(p: number): number {
  return Math.min(PORTFOLIO_PREMIUM_CAP, p);
}

export function portfolioPremiumText(key: RulerKey, premium: number | null): string {
  if (premium == null) return '資料不足';
  const abs = Math.abs(premium);
  if (abs < PORTFOLIO_PREMIUM_NEUTRAL) return '與同業相當';
  if (key === 'dividendYield') {
    return premium > 0 ? '殖利率高於同業' : '殖利率低於同業';
  }
  return premium > 0 ? '高於同業' : '低於同業';
}

export function computePortfolioValuation(rows: PortfolioValuationInput[]): PortfolioValuationResult {
  const candidates = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && typeof r.symbol === 'string' && isFiniteNumber(r.weight) && r.weight > 0,
  );
  const totalWeight = candidates.reduce((acc, r) => acc + r.weight, 0);

  const rulers = (['pe', 'pb', 'dividendYield'] as RulerKey[]).map((key): PortfolioRulerAggregate => {
    let wSum = 0;
    let wpSum = 0;
    let n = 0;
    for (const r of candidates) {
      const stat = computePeerStat(key, r[key] ?? null, Array.isArray(r.peers) ? r.peers : []);
      if (stat.premium == null) continue;
      wSum += r.weight;
      wpSum += r.weight * clipPremium(stat.premium);
      n += 1;
    }
    const weightedPremium = n > 0 && wSum > 0 ? Math.round((wpSum / wSum) * 1000) / 1000 : null;
    return {
      key,
      weightedPremium,
      coverage: totalWeight > 0 ? Math.round((wSum / totalWeight) * 1000) / 1000 : 0,
      n,
      label: RULER_LABEL[key],
      text: portfolioPremiumText(key, weightedPremium),
    };
  });

  const coveredWeight = candidates
    .filter((r) =>
      (['pe', 'pb', 'dividendYield'] as RulerKey[]).some(
        (key) => computePeerStat(key, r[key] ?? null, Array.isArray(r.peers) ? r.peers : []).premium != null,
      ),
    )
    .reduce((acc, r) => acc + r.weight, 0);

  return {
    rulers,
    totalWeight,
    coveredWeight,
    stockCount: candidates.length,
  };
}

/** 投組加權指數的摘要一行（UI 直接顯示；無有效尺時回 null）。 */
export function summarizePortfolioValuation(result: PortfolioValuationResult): string | null {
  const usable = result.rulers.filter((r) => r.weightedPremium != null);
  if (usable.length === 0 || result.totalWeight <= 0) return null;
  const parts = usable.map((r) => {
    const pct = (r.weightedPremium as number) * 100;
    const rounded = Math.sign(pct) * (Math.round(Math.abs(pct) * 10) / 10);
    const sign = rounded > 0 ? '+' : '';
    return `${r.label} ${sign}${rounded.toFixed(1)}%（${r.text}）`;
  });
  const coveragePct = Math.round((result.coveredWeight / result.totalWeight) * 100);
  return `${parts.join('｜')}｜涵蓋 ${coveragePct}% 市值`;
}

export const PORTFOLIO_VALUATION_CONTRACT = 'PORTFOLIO_VALUATION_V1';

// ── 同業明細圖表：產業分布 + 估值趨勢 ────────────────────────────
//
// 設計硬合約：
//   - 全部為純函式，圖表元件只負責畫，不做任何運算。
//   - 分布圖的母體＝computePeerStat 用的同一組有效同業值（含個股本身），
//     禁止另刻有效性判定；不足 MIN_PEER_N 一律回 insufficient。
//   - 趨勢序列以 RPC 的月取樣 trend 為唯一來源，點數不足 TREND_MIN_POINTS 視為資料不足。
//   - 不輸出任何買賣建議字眼。

export const TREND_MIN_POINTS = 4;
export const DISTRIBUTION_BUCKETS = 5;

export interface TrendPoint {
  date: string;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
}

export interface TrendSeries {
  key: RulerKey;
  label: string;
  points: { date: string; value: number }[];
  min: number | null;
  max: number | null;
  first: number | null;
  latest: number | null;
  insufficient: boolean;
  rangeText: string;
}

function isValidFor(key: RulerKey, v: unknown): v is number {
  return key === 'dividendYield' ? isValidYield(v) : isValidMultiple(v);
}

export function buildTrendSeries(key: RulerKey, points: TrendPoint[]): TrendSeries {
  const label = RULER_LABEL[key];
  const pts = (Array.isArray(points) ? points : [])
    .filter((p) => p && typeof p.date === 'string' && isValidFor(key, p[key]))
    .map((p) => ({ date: p.date, value: p[key] as number }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (pts.length < TREND_MIN_POINTS) {
    return { key, label, points: pts, min: null, max: null, first: null, latest: null, insufficient: true, rangeText: '資料不足' };
  }
  const values = pts.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = values[0];
  const latest = values[values.length - 1];
  const digits = key === 'dividendYield' ? 2 : 2;
  const unit = key === 'dividendYield' ? '%' : '';
  return {
    key,
    label,
    points: pts,
    min,
    max,
    first,
    latest,
    insufficient: false,
    rangeText: `近 ${pts.length} 個月 最低 ${min.toFixed(digits)}${unit}・最高 ${max.toFixed(digits)}${unit}・最新 ${latest.toFixed(digits)}${unit}`,
  };
}

export interface DistributionBucket {
  from: number;
  to: number;
  count: number;
  hasSelf: boolean;
  hasMedian: boolean;
}

export interface PeerDistribution {
  key: RulerKey;
  label: string;
  buckets: DistributionBucket[];
  total: number;
  n: number;
  median: number | null;
  selfValue: number | null;
  selfBucket: number | null;
  insufficient: boolean;
  maxCount: number;
}

/**
 * 同業估值分布：把同業（含個股本身，若其值有效）落入等寬區間。
 * 為避免單一極端值把所有人擠到第一格，區間邊界採 winsorize 後的 min/max。
 */
export function buildPeerDistribution(
  key: RulerKey,
  selfValue: number | null,
  rows: PeerRow[],
  bucketCount = DISTRIBUTION_BUCKETS,
): PeerDistribution {
  const label = RULER_LABEL[key];
  const peerVals = peerValues(rows, key);
  const stat = computePeerStat(key, selfValue, rows);
  const selfUsable = isValidFor(key, selfValue) && (key !== 'dividendYield' || (selfValue as number) > 0);
  const empty: PeerDistribution = {
    key,
    label,
    buckets: [],
    total: 0,
    n: peerVals.length,
    median: stat.median,
    selfValue: selfUsable ? (selfValue as number) : null,
    selfBucket: null,
    insufficient: true,
    maxCount: 0,
  };
  if (peerVals.length < MIN_PEER_N) return empty;

  const all = selfUsable ? [...peerVals, selfValue as number] : peerVals.slice();
  const clipped = winsorize(all);
  const lo = Math.min(...clipped);
  const hi = Math.max(...clipped);
  const span = hi - lo;
  const width = span > 0 ? span / bucketCount : Math.max(Math.abs(hi) * 0.1, 1) / bucketCount;
  const base = span > 0 ? lo : hi - width * bucketCount / 2;

  const buckets: DistributionBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    from: base + width * i,
    to: base + width * (i + 1),
    count: 0,
    hasSelf: false,
    hasMedian: false,
  }));
  const indexOf = (v: number): number => {
    const raw = Math.floor((Math.min(Math.max(v, lo), hi) - base) / width);
    return Math.min(bucketCount - 1, Math.max(0, raw));
  };
  for (const v of clipped) buckets[indexOf(v)].count += 1;

  let selfBucket: number | null = null;
  if (selfUsable) {
    selfBucket = indexOf(Math.min(Math.max(selfValue as number, lo), hi));
    buckets[selfBucket].hasSelf = true;
  }
  if (stat.median != null) buckets[indexOf(stat.median)].hasMedian = true;

  return {
    key,
    label,
    buckets,
    total: clipped.length,
    n: peerVals.length,
    median: stat.median,
    selfValue: selfUsable ? (selfValue as number) : null,
    selfBucket,
    insufficient: false,
    maxCount: Math.max(...buckets.map((b) => b.count)),
  };
}

export const VALUATION_PEER_CHARTS_CONTRACT = 'VALUATION_PEER_CHARTS_V1';

// ── 產業／市場族群分桶估值 ─────────────────────────────────────
//
// 設計硬合約（PORTFOLIO_BUCKET_VALUATION_V1）：
//   - 每個桶的三把尺一律重用 computePortfolioValuation（winsorize / clip / MIN_PEER_N 單一來源）。
//   - 產業桶依營收拆分權重分攤市值（與 aggregateBySector 同口徑，桶內合計 = 100%）。
//   - 市場族群是純標籤：一檔可落入多個族群桶，族群桶佔比不互斥、不得與產業桶相加。
//   - 涵蓋率 = 桶內「算得出溢折價」的市值 ÷ 桶市值（由 computePortfolioValuation 的 coverage 給）。
//   - 只輸出中性描述，不得給買賣建議。

/** 同業母體層級（與 valuation_snapshot RPC 的 peerScope 對齊）。 */
export type PeerScope = 'group' | 'fine' | 'fineWide' | 'broad' | 'legacy';

export const PEER_SCOPE_LABEL: Record<PeerScope, string> = {
  group: '市場族群',
  fine: '細分產業',
  fineWide: '細分產業（含次要）',
  broad: '產業大類',
  legacy: '產業分類',
};

export function peerScopeLabel(scope?: string | null): string {
  return PEER_SCOPE_LABEL[(scope || 'fine') as PeerScope] || PEER_SCOPE_LABEL.fine;
}

/** 一檔個股落入的桶（share 為該桶分到的市值比例，族群固定 1）。 */
export interface BucketAssignment {
  kind: 'industry' | 'marketGroup';
  key: string;
  share?: number;
}

export interface BucketValuation {
  kind: 'industry' | 'marketGroup';
  key: string;
  /** 桶市值（產業桶已按營收拆分攤）。 */
  weight: number;
  /** 桶市值佔全部台股持股市值比（0–1）。族群桶彼此不互斥。 */
  weightShare: number;
  stockCount: number;
  rulers: PortfolioRulerAggregate[];
  /** 桶內任一尺可算的市值比（0–1）。 */
  coverage: number;
  /** 三把尺都算不出來 → 資料不足。 */
  insufficient: boolean;
}

/**
 * 依產業／市場族群分桶，各自算一次市值加權估值指數。
 * `bucketsOf` 由呼叫端提供（前台走 getMultiMeta，與索引區同口徑）。
 */
export function buildBucketValuations(
  rows: PortfolioValuationInput[],
  bucketsOf: (symbol: string) => BucketAssignment[],
): BucketValuation[] {
  const candidates = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && typeof r.symbol === 'string' && isFiniteNumber(r.weight) && r.weight > 0,
  );
  const totalWeight = candidates.reduce((acc, r) => acc + r.weight, 0);
  if (totalWeight <= 0) return [];

  const buckets = new Map<string, { kind: 'industry' | 'marketGroup'; key: string; rows: PortfolioValuationInput[] }>();
  for (const r of candidates) {
    const assigns = bucketsOf(r.symbol) || [];
    const seen = new Set<string>();
    for (const a of assigns) {
      if (!a || !a.key || (a.kind !== 'industry' && a.kind !== 'marketGroup')) continue;
      const id = `${a.kind}:${a.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const share = a.kind === 'marketGroup' ? 1 : isFiniteNumber(a.share) ? a.share : 1;
      if (!(share > 0)) continue;
      if (!buckets.has(id)) buckets.set(id, { kind: a.kind, key: a.key, rows: [] });
      buckets.get(id)!.rows.push({ ...r, weight: r.weight * share });
    }
  }

  const out: BucketValuation[] = [];
  for (const b of buckets.values()) {
    const res = computePortfolioValuation(b.rows);
    out.push({
      kind: b.kind,
      key: b.key,
      weight: res.totalWeight,
      weightShare: Math.round((res.totalWeight / totalWeight) * 1000) / 1000,
      stockCount: res.stockCount,
      rulers: res.rulers,
      coverage: res.totalWeight > 0 ? Math.round((res.coveredWeight / res.totalWeight) * 1000) / 1000 : 0,
      insufficient: res.rulers.every((r) => r.weightedPremium == null),
    });
  }

  return out.sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
}

export const PORTFOLIO_BUCKET_VALUATION_CONTRACT = 'PORTFOLIO_BUCKET_VALUATION_V1';
