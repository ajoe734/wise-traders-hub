/**
 * fundamentalsBasis v2（待核准；套用時覆蓋 supabase/functions/_shared/fundamentalsBasis.ts）
 *
 * 不依賴 Deno / 瀏覽器 API：Edge Function 與 Vitest 共用同一份。
 *
 * 規則（不得放寬）：
 *   - 分母只來自財報原始科目，禁止以股價÷比率反推。
 *   - 股數：資產負債表 OrdinaryShare 是「普通股股本金額」，必須 ÷ 該檔官方面額（證交所／櫃買中心
 *     公司基本資料）才是股數；面額未核實（含無面額）一律不適用，不得假設 10 元。
 *   - PE：近四季歸屬母公司淨利 ÷ 同口徑「加權平均股數」。每季加權股數 = 歸屬母公司淨利 ÷ 財報基本 EPS；
 *     與期末股數差 > 5% 視為股數基準無法核對。四季股數變動 > 0.5%（配股／減資）時改以最新一季加權股數
 *     作為追溯口徑，不直接相加不同股數基準的 EPS。
 *   - 日期：
 *       live（今日估值）：FinMind 已能讀到的最新季報即視為「已公開」，標示「資料期＋取得時間」，
 *         不把法定申報期限寫成公告日。
 *       asOf（歷史估值日）：只用「法定申報期限 ≤ 估值日」的季報（實際公告日未取得，保守不提前使用）。
 *   - 倍數：
 *       peer：可比同業同日收盤 ÷ 同口徑分母，有效 ≥ 3 家，取 25–75 百分位。可進入「同業倍數情境」。
 *       history：本公司相近景氣期歷史，排除與目前分母同一資料期的樣本（那是市場對同一份財報的定價，
 *         近似循環），有效 ≥ 4 季取 25–75 百分位；只能稱「歷史情境參考」，不是合理價。
 */

export type FinRow = { date: string; type: string; value: number };
export type PriceRow = { date: string; close: number };
export type RulerKey = 'pe' | 'pb' | 'ps';
export type ValuationMode = 'live' | 'asOf';

/** 官方公司基本資料（證交所 t187ap03_L／櫃買 mopsfin_t187ap03_O）。 */
export type OfficialShares = {
  par: number | null;
  /** 原始面額字串（例如「新台幣 10.0000元」「無面額」）。 */
  parText: string;
  issuedShares: number | null;
  /** 民國出表日期轉西元 YYYY-MM-DD。 */
  reportDate: string | null;
  source: 'TWSE' | 'TPEx';
};

export const SHARE_TOLERANCE = 0.05;
export const SHARE_CHANGE_THRESHOLD = 0.005;
export const MIN_PEERS = 3;
export const MIN_HISTORY = 4;

export function parsePar(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = String(text).replace(/\s+/g, '');
  if (!s.startsWith('新台幣')) return null; // 無面額、美金等外幣：不核實
  const m = /新台幣([\d.]+)元?/.exec(s);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function rocToIso(roc: string | null | undefined): string | null {
  const m = /^(\d{3})(\d{2})(\d{2})$/.exec(String(roc ?? '').trim());
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}

export function officialFromTwse(row: Record<string, string> | null | undefined): OfficialShares | null {
  if (!row) return null;
  const n = Number(row['已發行普通股數或TDR原股發行股數']);
  return { par: parsePar(row['普通股每股面額']), parText: (row['普通股每股面額'] || '').replace(/\s+/g, ' ').trim(), issuedShares: Number.isFinite(n) && n > 0 ? n : null, reportDate: rocToIso(row['出表日期']), source: 'TWSE' };
}
export function officialFromTpex(row: Record<string, string> | null | undefined): OfficialShares | null {
  if (!row) return null;
  const n = Number(row['IssueShares']);
  return { par: parsePar(row['ParValueOfCommonStock']), parText: (row['ParValueOfCommonStock'] || '').replace(/\s+/g, ' ').trim(), issuedShares: Number.isFinite(n) && n > 0 ? n : null, reportDate: rocToIso(row['Date']), source: 'TPEx' };
}

export function statutoryDeadline(periodEnd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd);
  if (!m) return null;
  const y = Number(m[1]);
  switch (m[2]) {
    case '03': return `${y}-05-15`;
    case '06': return `${y}-08-14`;
    case '09': return `${y}-11-14`;
    case '12': return `${y + 1}-03-31`;
    default: return null;
  }
}

export function quarterLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split('-');
  return `${y}Q${Math.ceil(Number(m) / 3)}`;
}

function byQuarter(rows: FinRow[]): Map<string, Record<string, number>> {
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (!r || typeof r.date !== 'string' || typeof r.type !== 'string') continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    const q = map.get(r.date) || {};
    q[r.type] = v;
    map.set(r.date, q);
  }
  return map;
}

export type QuarterLine = {
  period: string;
  deadline: string;
  revenue: number | null;
  netIncomeParent: number | null;
  reportedEps: number | null;
  /** 期末普通股股數 = OrdinaryShare ÷ 面額。 */
  sharesEnd: number | null;
  /** 加權平均股數 = 歸屬母公司淨利 ÷ 基本 EPS（|EPS| < 0.05 時不可靠，為 null）。 */
  weightedShares: number | null;
  equityParent: number | null;
  proxied?: boolean;
};

export type Availability =
  | { mode: 'live'; dataPeriod: string; fetchedAt: string; deadline: string; note: string }
  | { mode: 'asOf'; dataPeriod: string; deadline: string; note: string };

export type CompanyBasis = {
  symbol: string;
  ok: boolean;
  reason: string | null;
  asOf: string;
  mode: ValuationMode;
  quarters: QuarterLine[];
  period: string | null;
  latestPeriod: string | null;
  availability: Availability | null;
  par: number | null;
  niTtm: number | null;
  revenueTtm: number | null;
  reportedEpsSum: number | null;
  /** PE 用加權股數（四季平均，或股數變動時取最新一季的追溯口徑）。 */
  weightedSharesUsed: number | null;
  weightedRule: string | null;
  sharesEnd: number | null;
  shareChange: boolean;
  /** 官方目前已發行股數與最近季末股數的差異（比例）；無官方資料為 null。 */
  officialShareDiff: number | null;
  equityParent: number | null;
  eps: number | null;
  bvps: number | null;
  sps: number | null;
  notApplicable: Partial<Record<RulerKey, string>>;
  growthYoY: number | null;
  netMargin: number | null;
  positiveQuarters: number | null;
  quartersObserved: number;
  cashRatio: number | null;
  debtRatio: number | null;
};

export type BasisOptions = {
  mode: ValuationMode;
  official: OfficialShares | null;
  /** live 模式的資料取得時間（ISO）。 */
  fetchedAt?: string;
};

export function computeCompanyBasis(symbol: string, fs: FinRow[], bs: FinRow[], asOf: string, opts: BasisOptions): CompanyBasis {
  const fsQ = byQuarter(fs);
  const bsQ = byQuarter(bs);
  const par = opts.official?.par ?? null;
  const periods = [...fsQ.keys()]
    .filter((p) => {
      const d = statutoryDeadline(p);
      if (!d) return false;
      return opts.mode === 'live' ? p < asOf : d <= asOf;
    })
    .sort();
  const lines: QuarterLine[] = periods.map((p) => {
    const f = fsQ.get(p) || {};
    const b = bsQ.get(p) || {};
    const ni = f.EquityAttributableToOwnersOfParent ?? (b.NonControllingInterests == null ? f.IncomeAfterTaxes ?? null : null);
    const eps = f.EPS ?? null;
    return {
      period: p,
      deadline: statutoryDeadline(p)!,
      revenue: f.Revenue ?? null,
      netIncomeParent: ni,
      reportedEps: eps,
      sharesEnd: par != null && b.OrdinaryShare != null && b.OrdinaryShare > 0 ? b.OrdinaryShare / par : null,
      weightedShares: ni != null && eps != null && Math.abs(eps) >= 0.05 ? ni / eps : null,
      equityParent: b.EquityAttributableToOwnersOfParent ?? (b.NonControllingInterests == null ? b.Equity ?? null : null),
      proxied: f.EquityAttributableToOwnersOfParent == null || b.EquityAttributableToOwnersOfParent == null,
    };
  });
  const base: CompanyBasis = {
    symbol, ok: false, reason: null, asOf, mode: opts.mode, quarters: lines.slice(-8), period: null, latestPeriod: null,
    availability: null, par, niTtm: null, revenueTtm: null, reportedEpsSum: null, weightedSharesUsed: null, weightedRule: null,
    sharesEnd: null, shareChange: false, officialShareDiff: null, equityParent: null, eps: null, bvps: null, sps: null,
    notApplicable: {}, growthYoY: null, netMargin: null, positiveQuarters: null, quartersObserved: 0, cashRatio: null, debtRatio: null,
  };
  if (par == null) {
    const why = opts.official ? `官方面額「${opts.official.parText || '未揭露'}」無法換算新台幣股數` : '查無證交所／櫃買中心官方面額';
    return { ...base, reason: `${why}，股本金額不能直接當股數，三尺不適用` };
  }
  const last4 = lines.slice(-4);
  const gate = opts.mode === 'live' ? '已可讀取' : '估值日前已過法定申報期限';
  if (last4.length < 4) return { ...base, reason: `${gate}的季報不足四季（${last4.length}）` };
  const contiguous = last4.every((l, i) => i === 0 || monthsBetween(last4[i - 1].period, l.period) === 3);
  if (!contiguous) return { ...base, reason: '近四季季報不連續' };
  const latest = last4[3];
  const latestBs = bsQ.get(latest.period) || {};
  if (last4.some((l) => l.sharesEnd == null)) return { ...base, reason: '缺期末普通股股本，無法取得股數' };
  for (const l of last4) {
    if (l.weightedShares != null && l.weightedShares > 0) {
      const diff = Math.abs(l.weightedShares - l.sharesEnd!) / l.sharesEnd!;
      if (diff > SHARE_TOLERANCE) {
        return { ...base, reason: `${quarterLabel(l.period)} 淨利÷EPS 的加權股數與期末股數（股本÷面額 ${par}）差 ${(diff * 100).toFixed(1)}%，股數基準無法核對` };
      }
    }
  }
  const ends = last4.map((l) => l.sharesEnd!);
  const shareChange = Math.max(...ends) / Math.min(...ends) - 1 > SHARE_CHANGE_THRESHOLD;
  const weights = last4.map((l) => l.weightedShares);
  let weightedSharesUsed: number;
  let weightedRule: string;
  if (shareChange) {
    weightedSharesUsed = latest.weightedShares ?? latest.sharesEnd!;
    weightedRule = latest.weightedShares != null
      ? `四季股數變動 >0.5%，以最新一季（${quarterLabel(latest.period)}）加權股數為追溯口徑`
      : `四季股數變動 >0.5% 且最新季 EPS 過小，以最新季末股數為口徑`;
  } else if (weights.every((w) => w != null && w > 0)) {
    weightedSharesUsed = (weights as number[]).reduce((a, b) => a + b, 0) / 4;
    weightedRule = '四季加權平均股數（淨利÷基本 EPS）之平均';
  } else {
    weightedSharesUsed = ends.reduce((a, b) => a + b, 0) / 4;
    weightedRule = '部分季別 EPS 過小無法反算加權股數，以四季期末股數平均代用（股數無變動）';
  }
  const sumOf = (k: 'revenue' | 'netIncomeParent' | 'reportedEps') =>
    last4.every((l) => l[k] != null) ? last4.reduce((a, l) => a + Number(l[k]), 0) : null;
  const niTtm = sumOf('netIncomeParent');
  const revenueTtm = sumOf('revenue');
  const reportedEpsSum = sumOf('reportedEps');
  const equityParent = latest.equityParent;
  const notApplicable: Partial<Record<RulerKey, string>> = {};
  const eps = niTtm == null ? null : niTtm / weightedSharesUsed;
  const bvps = equityParent == null ? null : equityParent / latest.sharesEnd!;
  const sps = revenueTtm == null ? null : revenueTtm / weightedSharesUsed;
  if (eps == null) notApplicable.pe = '缺歸屬母公司淨利';
  else if (eps <= 0) notApplicable.pe = '近四季歸屬母公司淨利 ≤ 0，PE 不適用';
  if (bvps == null) notApplicable.pb = '缺歸屬母公司權益';
  else if (bvps <= 0) notApplicable.pb = '歸屬母公司權益 ≤ 0，PB 不適用';
  if (sps == null) notApplicable.ps = '缺營業收入（金融業等無此科目）';
  else if (sps <= 0) notApplicable.ps = '近四季營收 ≤ 0，PS 不適用';

  const prev4 = lines.slice(-8, -4);
  const prevRev = prev4.length === 4 && prev4.every((l) => l.revenue != null) ? prev4.reduce((a, l) => a + Number(l.revenue), 0) : null;
  const last8 = lines.slice(-8);
  const totalAssets = latestBs.TotalAssets;
  const officialIssued = opts.official?.issuedShares ?? null;
  const availability: Availability = opts.mode === 'live'
    ? { mode: 'live', dataPeriod: quarterLabel(latest.period), fetchedAt: opts.fetchedAt ?? asOf, deadline: latest.deadline, note: `資料期 ${quarterLabel(latest.period)}，於取得時已可公開讀取；${latest.deadline} 為法定申報期限，非實際公告日` }
    : { mode: 'asOf', dataPeriod: quarterLabel(latest.period), deadline: latest.deadline, note: `僅用法定申報期限 ${latest.deadline} 前應已公告的季報（實際公告日未取得，保守不提前使用）` };
  return {
    ...base,
    ok: true,
    period: `${quarterLabel(last4[0].period)}～${quarterLabel(latest.period)}（近四季）`,
    latestPeriod: latest.period,
    availability,
    niTtm, revenueTtm, reportedEpsSum, weightedSharesUsed, weightedRule,
    sharesEnd: latest.sharesEnd, shareChange,
    officialShareDiff: officialIssued ? officialIssued / latest.sharesEnd! - 1 : null,
    equityParent, eps, bvps, sps, notApplicable,
    growthYoY: prevRev && revenueTtm != null && prevRev > 0 ? revenueTtm / prevRev - 1 : null,
    netMargin: niTtm != null && revenueTtm != null && revenueTtm > 0 ? niTtm / revenueTtm : null,
    positiveQuarters: last8.filter((l) => (l.netIncomeParent ?? 0) > 0).length,
    quartersObserved: last8.length,
    cashRatio: totalAssets > 0 && latestBs.CashAndCashEquivalents != null ? latestBs.CashAndCashEquivalents / totalAssets : null,
    debtRatio: totalAssets > 0 && latestBs.Liabilities != null ? latestBs.Liabilities / totalAssets : null,
  };
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
function daysBetween(a: string, b: string) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

export function closeOn(prices: PriceRow[], date: string): number | null {
  const hit = prices.find((p) => p.date === date);
  return hit && Number.isFinite(hit.close) && hit.close > 0 ? hit.close : null;
}

/** 線性內插百分位（p ∈ [0,1]）。 */
export function quantile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export type PeerInput = { symbol: string; name: string; basis: CompanyBasis; close: number | null };
export type PeerMultiple = { symbol: string; name: string; multiple: number | null; excluded: string | null };

const BASIS_FIELD: Record<RulerKey, 'eps' | 'bvps' | 'sps'> = { pe: 'eps', pb: 'bvps', ps: 'sps' };

export function peerMultiples(key: RulerKey, peers: PeerInput[]): PeerMultiple[] {
  return peers.map((p) => {
    if (!p.basis.ok) return { symbol: p.symbol, name: p.name, multiple: null, excluded: p.basis.reason };
    if (p.basis.notApplicable[key]) return { symbol: p.symbol, name: p.name, multiple: null, excluded: p.basis.notApplicable[key]! };
    if (p.close == null) return { symbol: p.symbol, name: p.name, multiple: null, excluded: '估值日無收盤價' };
    const d = p.basis[BASIS_FIELD[key]];
    if (d == null || d <= 0) return { symbol: p.symbol, name: p.name, multiple: null, excluded: '分母 ≤ 0' };
    return { symbol: p.symbol, name: p.name, multiple: p.close / d, excluded: null };
  });
}

const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

export function describeRisk(b: CompanyBasis) {
  return {
    growth: `近四季營收年增 ${pct(b.growthYoY)}，淨利率 ${pct(b.netMargin)}`,
    earningsStability: b.positiveQuarters == null ? '—' : `近 ${b.quartersObserved} 季獲利季數 ${b.positiveQuarters}`,
    cash: `現金/總資產 ${pct(b.cashRatio)}`,
    debt: `負債/總資產 ${pct(b.debtRatio)}`,
  };
}

export type ScenarioBasisOut = {
  value: number; unit: 'TWD/share'; period: string;
  /** 前端比對用的「可得日」：live 為取得日，asOf 為法定申報期限。不是實際公告日。 */
  publishedAt: string;
  availability: Availability;
  source: string; kind: 'reported'; shareBasis: string; derivation: string;
};
export type HistorySample = {
  period: string; quarter: string; deadline: string; date: string; close: number;
  basis: number; multiple: number; growthYoY: number | null; netMargin: number | null;
  cashRatio: number | null; debtRatio: number | null; regime: Regime | null;
};
export type ScenarioMultiplesOut = {
  method: 'peer' | 'history';
  /** 白話名稱：「同業倍數情境」或「本公司歷史情境參考」。 */
  label: string;
  low: number; high: number; reason: string; source: string; period: string; sampleSize: number;
  peerComparability: string; cycle: string; growth: string; earningsStability: string; cash: string; debt: string;
  shareBasis: string;
  /** 樣本最高/最低比；> 2 代表極值影響大。 */
  dispersion: number;
  caveats: string[];
};
export type ScenarioRowOut = {
  key: RulerKey;
  basis: ScenarioBasisOut | null;
  multiples: ScenarioMultiplesOut | null;
  notApplicable: string | null;
  peers: PeerMultiple[];
  /** 全部相近景氣期樣本（含被排除者與原因），供展開核對。 */
  samples: Array<HistorySample & { used: boolean; excluded: string | null }>;
};

export const SHARE_BASIS = {
  pe: '加權平均普通股（淨利÷基本 EPS；股本÷官方面額交叉核對）',
  pb: '期末普通股（股本÷官方面額）',
  ps: '加權平均普通股（同 PE 口徑）',
} as const;

const BASIS_SOURCE: Record<RulerKey, string> = {
  pe: 'FinMind 綜合損益表：歸屬母公司淨利（近四季加總）',
  pb: 'FinMind 資產負債表：歸屬母公司權益（最近季末）',
  ps: 'FinMind 綜合損益表：營業收入（近四季加總）',
};

const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');
export function derivationOf(key: RulerKey, b: CompanyBasis): string {
  const shares = key === 'pb' ? b.sharesEnd! : b.weightedSharesUsed!;
  const num = key === 'pe' ? b.niTtm! : key === 'pb' ? b.equityParent! : b.revenueTtm!;
  const label = key === 'pe' ? '近四季歸屬母公司淨利' : key === 'pb' ? '歸屬母公司權益' : '近四季營業收入';
  const v = b[BASIS_FIELD[key]]!;
  const shareLabel = key === 'pb' ? `期末股數（股本÷面額 ${b.par} 元）` : `股（${b.weightedRule}）`;
  const check = key === 'pe' && b.reportedEpsSum != null ? `；財報基本 EPS 四季合計 ${b.reportedEpsSum.toFixed(2)} 元供核對` : '';
  const off = key === 'pb' && b.officialShareDiff != null ? `；官方目前已發行股數與季末差 ${(b.officialShareDiff * 100).toFixed(3)}%` : '';
  const proxy = b.quarters.slice(-4).some((q) => q.proxied) ? '；未揭露母公司歸屬科目且無非控制權益，以稅後淨利／權益總額代用' : '';
  return `${label} NT$${fmtInt(num)} ÷ ${fmtInt(shares)} ${shareLabel} = NT$${v.toFixed(2)}${check}${off}${proxy}`;
}

export type Regime = 'high' | 'mild' | 'decline';
export const REGIME_LABEL: Record<Regime, string> = { high: '高成長（營收年增 ≥20%）', mild: '溫和（年增 0–20%）', decline: '衰退（年增 <0）' };
export function regimeOf(g: number | null): Regime | null {
  if (g == null) return null;
  return g >= 0.2 ? 'high' : g >= 0 ? 'mild' : 'decline';
}

export type HistoryPoint = {
  date: string; deadline: string; period: string; close: number; regime: Regime | null;
  eps: number | null; bvps: number | null; sps: number | null;
  growthYoY: number | null; netMargin: number | null; cashRatio: number | null; debtRatio: number | null;
};

/** 公司自身歷史：每季「法定申報期限」後 10 日內首個收盤 ÷ 當時必然已公告的同口徑分母（asOf 模式）。 */
export function historyPoints(symbol: string, fs: FinRow[], bs: FinRow[], prices: PriceRow[], asOf: string, official: OfficialShares | null): HistoryPoint[] {
  const sorted = [...prices].filter((p) => p.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const periods = [...new Set(fs.map((r) => r.date))].sort();
  const out: HistoryPoint[] = [];
  for (const p of periods) {
    const d = statutoryDeadline(p);
    if (!d || d >= asOf) continue;
    const px = sorted.find((x) => x.date >= d && x.date < asOf);
    if (!px || daysBetween(d, px.date) > 10) continue;
    const b = computeCompanyBasis(symbol, fs, bs, d, { mode: 'asOf', official });
    if (!b.ok || b.latestPeriod !== p) continue;
    out.push({
      date: px.date, deadline: d, period: p, close: px.close, regime: regimeOf(b.growthYoY),
      eps: b.eps, bvps: b.bvps, sps: b.sps, growthYoY: b.growthYoY, netMargin: b.netMargin, cashRatio: b.cashRatio, debtRatio: b.debtRatio,
    });
  }
  return out;
}

export function buildScenarioRows(target: CompanyBasis, peers: PeerInput[], peerRule: string, history: HistoryPoint[] = []): ScenarioRowOut[] {
  const regime = regimeOf(target.growthYoY);
  return (['pe', 'pb', 'ps'] as const).map((key) => {
    const list = peerMultiples(key, peers);
    if (!target.ok) return { key, basis: null, multiples: null, notApplicable: target.reason, peers: list, samples: [] };
    const na = target.notApplicable[key] ?? null;
    const value = target[BASIS_FIELD[key]];
    const basis: ScenarioBasisOut | null = na || value == null || !target.availability ? null : {
      value, unit: 'TWD/share', period: target.period!,
      publishedAt: target.availability.mode === 'live' ? target.availability.fetchedAt.slice(0, 10) : target.availability.deadline,
      availability: target.availability,
      source: BASIS_SOURCE[key], kind: 'reported', shareBasis: SHARE_BASIS[key], derivation: derivationOf(key, target),
    };
    const risk = describeRisk(target);
    const valid = list.filter((p) => p.multiple != null);
    const samples = history
      .filter((h) => regime != null && h.regime === regime)
      .map((h) => {
        const d = h[BASIS_FIELD[key]];
        if (d == null || d <= 0) return null;
        const same = h.period === target.latestPeriod;
        return {
          period: h.period, quarter: quarterLabel(h.period), deadline: h.deadline, date: h.date, close: h.close, basis: d,
          multiple: h.close / d, growthYoY: h.growthYoY, netMargin: h.netMargin, cashRatio: h.cashRatio, debtRatio: h.debtRatio, regime: h.regime,
          used: !same, excluded: same ? '與目前分母同一資料期，屬市場對同一份財報的定價，排除以免循環' : null,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s != null);
    const used = samples.filter((s) => s.used);
    let multiples: ScenarioMultiplesOut | null = null;
    if (valid.length >= MIN_PEERS) {
      const ms = valid.map((p) => p.multiple!);
      const disp = Math.max(...ms) / Math.min(...ms);
      multiples = {
        method: 'peer', label: '同業倍數情境',
        low: quantile(ms, 0.25), high: quantile(ms, 0.75),
        reason: `可比同業 ${valid.length} 家倍數的 25–75 百分位：${valid.map((p) => `${p.name}${p.symbol} ${p.multiple!.toFixed(1)}`).join('、')}`,
        source: '同業估值日收盤 ÷ 同業同口徑財報分母（FinMind；股數經官方面額換算）',
        period: `估值日 ${target.asOf}`, sampleSize: valid.length, peerComparability: peerRule,
        cycle: `同一估值日 ${target.asOf}，同一景氣時點`, ...risk, shareBasis: SHARE_BASIS[key],
        dispersion: disp,
        caveats: disp > 2 ? [`同業倍數最高/最低達 ${disp.toFixed(1)} 倍，區間僅取中段 50%`] : [],
      };
    } else if (used.length >= MIN_HISTORY) {
      const ms = used.map((s) => s.multiple);
      const disp = Math.max(...ms) / Math.min(...ms);
      const excluded = list.filter((p) => p.multiple == null).map((p) => `${p.name}${p.symbol}：${p.excluded}`).join('；');
      multiples = {
        method: 'history', label: '本公司歷史情境參考',
        low: quantile(ms, 0.25), high: quantile(ms, 0.75),
        reason: `本公司「${REGIME_LABEL[regime!]}」季別 ${used.length} 筆倍數的 25–75 百分位：${used.map((s) => `${s.quarter} ${s.multiple.toFixed(1)}`).join('、')}`,
        source: '本公司各季法定申報期限後首個收盤 ÷ 當時必然已公告的同口徑分母（FinMind）',
        period: `${used[0].deadline}～${used[used.length - 1].deadline}`,
        sampleSize: used.length,
        peerComparability: `可比同業通過口徑檢查 ${valid.length} 家（需 ≥${MIN_PEERS}），改用本公司歷史${excluded ? `；同業排除：${excluded}` : ''}`,
        cycle: `僅取與目前同屬「${REGIME_LABEL[regime!]}」的季別；描述過去市場定價，不代表合理倍數`,
        ...risk, shareBasis: SHARE_BASIS[key],
        dispersion: disp,
        caveats: [
          '歷史情境參考，非合理價',
          ...(disp > 2 ? [`樣本最高/最低達 ${disp.toFixed(1)} 倍，極值影響大，區間僅取中段 50%`] : []),
          ...(used.length < 6 ? [`樣本僅 ${used.length} 季，代表性有限`] : []),
        ],
      };
    }
    const lack = !multiples
      ? `可比同業有效 ${valid.length} 家（需 ≥${MIN_PEERS}）、相近景氣期歷史 ${used.length} 季（需 ≥${MIN_HISTORY}，已排除同資料期樣本），倍數依據不足`
      : null;
    return { key, basis, multiples, notApplicable: na ?? lack, peers: list, samples };
  });
}

/** 同業挑選：與目標共用全部細分產業標籤。 */
export function selectPeerCandidates(
  target: { symbol: string; industries: string[] },
  universe: Array<{ symbol: string; name: string; industries: string[] }>,
): Array<{ symbol: string; name: string }> {
  const tags = (target.industries || []).filter(Boolean);
  if (!tags.length) return [];
  return universe
    .filter((u) => u.symbol !== target.symbol && tags.every((t) => (u.industries || []).includes(t)))
    .map((u) => ({ symbol: u.symbol, name: u.name }));
}

export function rankByScale<T extends { basis: CompanyBasis }>(target: CompanyBasis, peers: T[], max: number): T[] {
  const t = target.revenueTtm;
  if (!t || t <= 0 || peers.length <= max) return peers.slice(0, max);
  return [...peers].sort((a, b) => scaleDistance(t, a.basis.revenueTtm) - scaleDistance(t, b.basis.revenueTtm)).slice(0, max);
}
function scaleDistance(t: number, v: number | null) {
  return v && v > 0 ? Math.abs(Math.log(v / t)) : Number.POSITIVE_INFINITY;
}

/** 有限併發執行；每個工作各自失敗不影響其他。 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<Array<PromiseSettledResult<R>>> {
  const out: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { status: 'fulfilled', value: await fn(items[i]) }; } catch (e) { out[i] = { status: 'rejected', reason: e }; }
    }
  });
  await Promise.all(workers);
  return out;
}
