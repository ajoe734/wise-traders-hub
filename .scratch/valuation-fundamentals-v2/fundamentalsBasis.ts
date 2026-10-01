/**
 * fundamentalsBasis v2（待核准；套用時覆蓋 supabase/functions/_shared/fundamentalsBasis.ts）
 *
 * 不依賴 Deno / 瀏覽器 API：Edge Function 與 Vitest 共用同一份。
 *
 * 規則（不得放寬）：
 *   - 分母只來自財報原始科目，禁止以股價÷比率反推。
 *   - 淨利口徑：EquityAttributableToOwnersOfParent 必須核對 origin_name 為「淨利（淨損）歸屬於母公司業主」，
 *     不得是綜合損益；並以 本期淨利 = 母公司 + 非控制權益 對帳（誤差 ≤1%）。同期多口徑、科目不明、
 *     對不平 → 該季淨利不可用，PE 不適用。
 *   - 股數：OrdinaryShare 是普通股股本「金額」，÷ 該檔官方面額（證交所／櫃買中心）再扣庫藏股，才是流通股數；
 *     面額未核實一律不適用，不得假設 10 元。
 *   - 特別股：官方名錄有特別股 → 歸屬母公司權益與淨利含特別股權益，PE、PB 不適用；PS 用普通股期末股數。
 *   - EPS 股數基準：每季加權股數 = 母公司淨利 ÷ 基本 EPS。四季加權股數變動 > 0.5%（代表 EPS 基準不同，
 *     可能配股／分割／增資）且無正式追溯資料 → PE 不適用，不相加不同基準 EPS、也不把最新季冒稱「追溯口徑」。
 *   - 日期：live＝「資料期＋取得時間」；asOf（歷史）只用法定申報期限 ≤ 估值日的季報。期限不是公告日。
 *   - 倍數：
 *       peer：核心業務同業（主分類相同為優先，題材不列條件），同日收盤 ÷ 同口徑分母，有效 ≥3 家取 P25–P75。
 *       history：本公司「月末代表點」，每點只用當時已過法定期限的財報；同一資料期的多個月點只算一份證據
 *         （先取該期中位數），排除與目前分母同一資料期；相近景氣期 ≥4 個資料期才取 P25–P75，
 *         且只能叫「本公司歷史情境參考」，不是合理倍數。
 */

export type FinRow = { date: string; type: string; value: number; origin_name?: string | null };
export type PriceRow = { date: string; close: number };
export type RulerKey = 'pe' | 'pb' | 'ps';
export type ValuationMode = 'live' | 'asOf';

/** 官方公司基本資料（證交所 t187ap03_L／櫃買 mopsfin_t187ap03_O）。 */
export type OfficialShares = {
  par: number | null;
  parText: string;
  issuedShares: number | null;
  /** 官方特別股股數；0 = 無。 */
  preferredShares: number | null;
  /** 實收資本額（元），同業規模排序用。 */
  paidInCapital: number | null;
  reportDate: string | null;
  source: 'TWSE' | 'TPEx';
};

export const SHARE_TOLERANCE = 0.05;
export const SHARE_BRACKET_SLACK = 0.02;
export const SHARE_CHANGE_THRESHOLD = 0.005;
export const NI_RECON_TOLERANCE = 0.01;
export const MIN_PEERS = 3;
export const MIN_HISTORY = 4;

export function parsePar(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = String(text).replace(/\s+/g, '');
  if (!s.startsWith('新台幣')) return null;
  const m = /新台幣([\d.]+)元?/.exec(s);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function rocToIso(roc: string | null | undefined): string | null {
  const m = /^(\d{3})(\d{2})(\d{2})$/.exec(String(roc ?? '').trim());
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}

const posNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

export function officialFromTwse(row: Record<string, string> | null | undefined): OfficialShares | null {
  if (!row) return null;
  const n = posNum(row['已發行普通股數或TDR原股發行股數']);
  return {
    par: parsePar(row['普通股每股面額']), parText: (row['普通股每股面額'] || '').replace(/\s+/g, ' ').trim(),
    issuedShares: n && n > 0 ? n : null, preferredShares: posNum(row['特別股']), paidInCapital: posNum(row['實收資本額']),
    reportDate: rocToIso(row['出表日期']), source: 'TWSE',
  };
}
export function officialFromTpex(row: Record<string, string> | null | undefined): OfficialShares | null {
  if (!row) return null;
  const n = posNum(row['IssueShares']);
  return {
    par: parsePar(row['ParValueOfCommonStock']), parText: (row['ParValueOfCommonStock'] || '').replace(/\s+/g, ' ').trim(),
    issuedShares: n && n > 0 ? n : null, preferredShares: posNum(row['PreferredStock.shares']), paidInCapital: posNum(row['Paidin.Capital.NTDollars']),
    reportDate: rocToIso(row['Date']), source: 'TPEx',
  };
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

type QRec = { v: Record<string, number>; o: Record<string, string>; conflict: Set<string> };
function byQuarter(rows: FinRow[]): Map<string, QRec> {
  const map = new Map<string, QRec>();
  for (const r of rows) {
    if (!r || typeof r.date !== 'string' || typeof r.type !== 'string') continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    const q = map.get(r.date) || { v: {}, o: {}, conflict: new Set<string>() };
    const origin = r.origin_name ? String(r.origin_name) : '';
    if (r.type in q.v && (q.v[r.type] !== v || (origin && q.o[r.type] && q.o[r.type] !== origin))) q.conflict.add(r.type);
    q.v[r.type] = v;
    if (origin) q.o[r.type] = origin;
    map.set(r.date, q);
  }
  return map;
}
const EMPTY: QRec = { v: {}, o: {}, conflict: new Set() };
const nciOf = (q: QRec) => q.v.NoncontrollingInterests ?? q.v.NonControllingInterests ?? null;

export type NetIncomeResolution = { value: number | null; proxied: boolean; issue: string | null; origin: string | null };

/** 母公司淨利口徑核對：origin_name、本期淨利、非控制權益三方對帳。 */
export function resolveParentNetIncome(f: QRec, b: QRec): NetIncomeResolution {
  const p = f.v.EquityAttributableToOwnersOfParent;
  const po = f.o.EquityAttributableToOwnersOfParent ?? null;
  const iat = f.v.IncomeAfterTaxes;
  const nci = nciOf(f);
  if (f.conflict.has('EquityAttributableToOwnersOfParent')) return { value: null, proxied: false, issue: '同期出現多個「歸屬母公司」科目口徑', origin: po };
  if (p != null) {
    if (po && (/綜合/.test(po) || !/淨利|淨損/.test(po))) return { value: null, proxied: false, issue: `科目「${po}」不是淨利歸屬母公司（可能為綜合損益）`, origin: po };
    if (iat != null && iat !== 0) {
      const expected = p + (nci ?? 0);
      const gap = Math.abs(expected - iat) / Math.abs(iat);
      if (gap > NI_RECON_TOLERANCE) {
        return { value: null, proxied: false, origin: po, issue: nci != null
          ? `母公司淨利＋非控制權益與本期淨利差 ${(gap * 100).toFixed(1)}%，口徑不一致`
          : `母公司淨利與本期淨利差 ${(gap * 100).toFixed(1)}% 且未揭露非控制權益，口徑不明` };
      }
    } else if (!po) {
      return { value: null, proxied: false, issue: '缺科目名稱且無本期淨利可對帳', origin: null };
    }
    return { value: p, proxied: false, issue: null, origin: po };
  }
  const bsNci = nciOf(b);
  const io = f.o.IncomeAfterTaxes ?? null;
  if (iat != null && nci == null && (bsNci == null || bsNci === 0) && (!io || /本期淨利/.test(io))) {
    return { value: iat, proxied: true, issue: null, origin: io };
  }
  return { value: null, proxied: false, issue: '缺歸屬母公司淨利，且有非控制權益無法以本期淨利代用', origin: null };
}

export type QuarterLine = {
  period: string;
  deadline: string;
  revenue: number | null;
  netIncomeParent: number | null;
  niIssue: string | null;
  niOrigin: string | null;
  reportedEps: number | null;
  /** 期末已發行普通股 = OrdinaryShare ÷ 面額。 */
  sharesIssuedEnd: number | null;
  treasuryShares: number;
  /** 期末流通股數 = 已發行 − 庫藏股。 */
  sharesEnd: number | null;
  /** 加權平均股數 = 母公司淨利 ÷ 基本 EPS（|EPS| < 0.05 時不可靠，為 null）。 */
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
  /** PE 用加權股數（四季平均）；EPS 基準不一致時為 null。 */
  weightedSharesUsed: number | null;
  weightedRule: string | null;
  /** PS 用股數與規則（無變動=同 PE；有變動=最新季末流通股數且與官方核對）。 */
  psShares: number | null;
  psShareRule: string | null;
  sharesEnd: number | null;
  shareChange: boolean;
  epsBasisRange: number | null;
  officialShareDiff: number | null;
  preferred: boolean;
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

export type BasisOptions = { mode: ValuationMode; official: OfficialShares | null; fetchedAt?: string };

const TREASURY = 'NumberOfSharesInEntityHeldByEntityAndByItsSubsidiaries';

export function computeCompanyBasis(symbol: string, fs: FinRow[], bs: FinRow[], asOf: string, opts: BasisOptions): CompanyBasis {
  const fsQ = byQuarter(fs);
  const bsQ = byQuarter(bs);
  return basisFromQuarters(symbol, fsQ, bsQ, asOf, opts);
}

function basisFromQuarters(symbol: string, fsQ: Map<string, QRec>, bsQ: Map<string, QRec>, asOf: string, opts: BasisOptions): CompanyBasis {
  const par = opts.official?.par ?? null;
  const periods = [...fsQ.keys()]
    .filter((p) => {
      const d = statutoryDeadline(p);
      if (!d) return false;
      return opts.mode === 'live' ? p < asOf : d <= asOf;
    })
    .sort();
  const lines: QuarterLine[] = periods.map((p) => {
    const f = fsQ.get(p) || EMPTY;
    const b = bsQ.get(p) || EMPTY;
    const ni = resolveParentNetIncome(f, b);
    const eps = f.v.EPS ?? null;
    const issued = par != null && b.v.OrdinaryShare != null && b.v.OrdinaryShare > 0 ? b.v.OrdinaryShare / par : null;
    const treasury = Math.max(0, b.v[TREASURY] ?? 0);
    const bsNci = nciOf(b);
    return {
      period: p,
      deadline: statutoryDeadline(p)!,
      revenue: f.v.Revenue ?? null,
      netIncomeParent: ni.value,
      niIssue: ni.issue,
      niOrigin: ni.origin,
      reportedEps: eps,
      sharesIssuedEnd: issued,
      treasuryShares: treasury,
      sharesEnd: issued != null && issued > treasury ? issued - treasury : null,
      weightedShares: ni.value != null && eps != null && Math.abs(eps) >= 0.05 ? ni.value / eps : null,
      equityParent: b.v.EquityAttributableToOwnersOfParent ?? ((bsNci == null || bsNci === 0) ? b.v.Equity ?? null : null),
      proxied: ni.proxied || b.v.EquityAttributableToOwnersOfParent == null,
    };
  });
  const base: CompanyBasis = {
    symbol, ok: false, reason: null, asOf, mode: opts.mode, quarters: lines.slice(-8), period: null, latestPeriod: null,
    availability: null, par, niTtm: null, revenueTtm: null, reportedEpsSum: null, weightedSharesUsed: null, weightedRule: null,
    psShares: null, psShareRule: null, sharesEnd: null, shareChange: false, epsBasisRange: null, officialShareDiff: null,
    preferred: false, equityParent: null, eps: null, bvps: null, sps: null,
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
  const latestBs = bsQ.get(latest.period)?.v || {};
  if (last4.some((l) => l.sharesEnd == null)) return { ...base, reason: '缺期末普通股股本，無法取得股數' };
  // 加權平均股數必然落在「上季末～本季末」流通股數之間（放寬 2% 容納庫藏股時點與 EPS 進位）；
  // 落在外面代表面額、股本或 EPS 口徑對不上。季中增資（如世芯 2026Q2）不會被誤判。
  for (const l of last4) {
    if (l.weightedShares != null && l.weightedShares > 0) {
      const idx = lines.indexOf(l);
      const prevEnd = idx > 0 && lines[idx - 1].sharesEnd != null ? lines[idx - 1].sharesEnd! : l.sharesEnd!;
      const lo = Math.min(prevEnd, l.sharesEnd!) * (1 - SHARE_BRACKET_SLACK);
      const hi = Math.max(prevEnd, l.sharesEnd!) * (1 + SHARE_BRACKET_SLACK);
      if (l.weightedShares < lo || l.weightedShares > hi) {
        const diff = Math.abs(l.weightedShares - l.sharesEnd!) / l.sharesEnd!;
        return { ...base, reason: `${quarterLabel(l.period)} 淨利÷EPS 的加權股數 ${Math.round(l.weightedShares).toLocaleString('en-US')} 不在上季末～本季末流通股數（股本÷面額 ${par}－庫藏股）之間（與季末差 ${(diff * 100).toFixed(1)}%），股數基準無法核對` };
      }
    }
  }
  const preferred = (opts.official?.preferredShares ?? 0) > 0;
  const notApplicable: Partial<Record<RulerKey, string>> = {};
  const niIssue = last4.find((l) => l.niIssue);
  const ends = last4.map((l) => l.sharesEnd!);
  const endRange = Math.max(...ends) / Math.min(...ends) - 1;
  const weights = last4.map((l) => l.weightedShares);
  const allW = weights.every((w) => w != null && w > 0);
  const epsBasisRange = allW ? Math.max(...(weights as number[])) / Math.min(...(weights as number[])) - 1 : null;
  // 財報 EPS 只到小數兩位：每季隱含股數是一個區間 ni/(eps±0.005)。四季區間在放寬 0.5% 後仍無交集，才判定基準不同。
  const bounds = allW ? last4.map((l) => {
    const e = Math.abs(l.reportedEps!); const ni = Math.abs(l.netIncomeParent!);
    return [ni / (e + 0.005), e > 0.005 ? ni / (e - 0.005) : Number.POSITIVE_INFINITY] as const;
  }) : null;
  const epsBasisConflict = bounds ? Math.max(...bounds.map((b) => b[0])) > Math.min(...bounds.map((b) => b[1])) * (1 + SHARE_CHANGE_THRESHOLD) : null;
  const shareChange = epsBasisConflict != null ? epsBasisConflict : endRange > SHARE_CHANGE_THRESHOLD;
  const officialIssued = opts.official?.issuedShares ?? null;
  const officialShareDiff = officialIssued && latest.sharesIssuedEnd ? officialIssued / latest.sharesIssuedEnd - 1 : null;

  let weightedSharesUsed: number | null = null;
  let weightedRule: string | null = null;
  let psShares: number | null = null;
  let psShareRule: string | null = null;
  if (!shareChange) {
    if (allW) {
      weightedSharesUsed = (weights as number[]).reduce((a, b) => a + b, 0) / 4;
      weightedRule = `四季加權平均股數（淨利÷基本 EPS）之平均；四季差異 ${((epsBasisRange ?? 0) * 100).toFixed(2)}%，在 EPS 進位誤差＋0.5% 內`;
    } else {
      weightedSharesUsed = ends.reduce((a, b) => a + b, 0) / 4;
      weightedRule = `部分季別無法反算加權股數，以四季期末流通股數平均代用（期末股數變動 ${(endRange * 100).toFixed(2)}%）`;
    }
    psShares = weightedSharesUsed; psShareRule = weightedRule;
  } else {
    const pctText = epsBasisRange != null ? `四季 EPS 隱含加權股數變動 ${(epsBasisRange * 100).toFixed(2)}%（已扣除 EPS 小數兩位的進位誤差仍超過 0.5%）` : `期末股數變動 ${(endRange * 100).toFixed(2)}%`;
    notApplicable.pe = `${pctText}，可能配股／分割／增減資，未取得正式追溯調整資料，不相加不同股數基準的 EPS，PE 不適用`;
    if (officialShareDiff != null && Math.abs(officialShareDiff) <= SHARE_CHANGE_THRESHOLD) {
      psShares = latest.sharesEnd!;
      psShareRule = `股數有變動，以最新季末流通股數為口徑（與官方現行已發行股數差 ${(officialShareDiff * 100).toFixed(2)}%）`;
    } else {
      notApplicable.ps = `${pctText}，且最新季末股數無法與官方現行股數核對（${officialShareDiff == null ? '無官方股數' : `差 ${(officialShareDiff * 100).toFixed(2)}%`}），PS 不適用`;
    }
  }
  if (preferred) {
    notApplicable.pe = `官方名錄有特別股 ${Math.round(opts.official!.preferredShares!).toLocaleString('en-US')} 股：歸屬母公司淨利含特別股權益，PE 不適用`;
    notApplicable.pb = '官方名錄有特別股：歸屬母公司權益未拆出普通股權益，PB 不適用';
    if (!notApplicable.ps) { psShares = latest.sharesEnd!; psShareRule = '有特別股，以最新季末普通股流通股數為口徑'; }
  }
  if (niIssue && !notApplicable.pe) notApplicable.pe = `${quarterLabel(niIssue.period)} ${niIssue.niIssue}，PE 不適用`;

  const sumOf = (k: 'revenue' | 'netIncomeParent' | 'reportedEps') =>
    last4.every((l) => l[k] != null) ? last4.reduce((a, l) => a + Number(l[k]), 0) : null;
  const niTtm = sumOf('netIncomeParent');
  const revenueTtm = sumOf('revenue');
  const reportedEpsSum = sumOf('reportedEps');
  const equityParent = latest.equityParent;
  const eps = notApplicable.pe || niTtm == null || weightedSharesUsed == null ? null : niTtm / weightedSharesUsed;
  const bvps = notApplicable.pb || equityParent == null ? null : equityParent / latest.sharesEnd!;
  const sps = notApplicable.ps || revenueTtm == null || psShares == null ? null : revenueTtm / psShares;
  if (!notApplicable.pe) {
    if (niTtm == null) notApplicable.pe = '缺歸屬母公司淨利';
    else if (eps != null && eps <= 0) notApplicable.pe = '近四季歸屬母公司淨利 ≤ 0，PE 不適用';
  }
  if (!notApplicable.pb) {
    if (equityParent == null) notApplicable.pb = '缺歸屬母公司權益（且有非控制權益，不能以權益總額代用）';
    else if (bvps != null && bvps <= 0) notApplicable.pb = '歸屬母公司權益 ≤ 0，PB 不適用';
  }
  if (!notApplicable.ps) {
    if (revenueTtm == null) notApplicable.ps = '缺營業收入（金融業等無此科目）';
    else if (sps != null && sps <= 0) notApplicable.ps = '近四季營收 ≤ 0，PS 不適用';
  }

  const prev4 = lines.slice(-8, -4);
  const prevRev = prev4.length === 4 && prev4.every((l) => l.revenue != null) ? prev4.reduce((a, l) => a + Number(l.revenue), 0) : null;
  const last8 = lines.slice(-8);
  const totalAssets = latestBs.TotalAssets;
  const availability: Availability = opts.mode === 'live'
    ? { mode: 'live', dataPeriod: quarterLabel(latest.period), fetchedAt: opts.fetchedAt ?? asOf, deadline: latest.deadline, note: `資料期 ${quarterLabel(latest.period)}，於取得時已可公開讀取；${latest.deadline} 為法定申報期限，非實際公告日` }
    : { mode: 'asOf', dataPeriod: quarterLabel(latest.period), deadline: latest.deadline, note: `僅用法定申報期限 ${latest.deadline} 前應已公告的季報（實際公告日未取得，保守不提前使用）` };
  return {
    ...base,
    ok: true,
    period: `${quarterLabel(last4[0].period)}～${quarterLabel(latest.period)}（近四季）`,
    latestPeriod: latest.period,
    availability,
    niTtm, revenueTtm, reportedEpsSum, weightedSharesUsed, weightedRule, psShares, psShareRule,
    sharesEnd: latest.sharesEnd, shareChange, epsBasisRange, officialShareDiff, preferred,
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
const median = (v: number[]) => quantile(v, 0.5);

export type PeerInput = { symbol: string; name: string; basis: CompanyBasis; close: number | null };
export type PeerMultiple = { symbol: string; name: string; multiple: number | null; excluded: string | null };

const BASIS_FIELD: Record<RulerKey, 'eps' | 'bvps' | 'sps'> = { pe: 'eps', pb: 'bvps', ps: 'sps' };

/** 景氣相近：營收年增差距 ≤ max(20pp, 目標年增絕對值的一半)。 */
export function growthTolerance(targetGrowth: number): number { return Math.max(0.2, Math.abs(targetGrowth) * 0.5); }
export function similarGrowth(g: number | null, targetGrowth: number | null): boolean {
  if (g == null || targetGrowth == null) return false;
  return Math.abs(g - targetGrowth) <= growthTolerance(targetGrowth);
}
const pp = (v: number) => `${(v * 100).toFixed(0)}%`;

/** 風險／景氣可比性：同業需獲利，且營收年增與本檔相近。 */
export function peerRiskIssue(target: CompanyBasis, peer: CompanyBasis): string | null {
  if (!peer.ok) return peer.reason;
  if (peer.niTtm == null || peer.niTtm <= 0) return '近四季虧損或淨利不明，獲利風險與本檔不可比';
  if (target.growthYoY != null && !similarGrowth(peer.growthYoY, target.growthYoY)) {
    return `營收年增 ${peer.growthYoY == null ? '不明' : pp(peer.growthYoY)}，與本檔 ${pp(target.growthYoY)} 差距超過 ${pp(growthTolerance(target.growthYoY))}，景氣不可比`;
  }
  return null;
}

export function peerMultiples(key: RulerKey, peers: PeerInput[], target?: CompanyBasis): PeerMultiple[] {
  return peers.map((p) => {
    const risk = target ? peerRiskIssue(target, p.basis) : (p.basis.ok ? null : p.basis.reason);
    if (risk) return { symbol: p.symbol, name: p.name, multiple: null, excluded: risk };
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
  /** 前端比對用「可得日」：live 為取得日，asOf 為法定申報期限。不是實際公告日。 */
  publishedAt: string;
  availability: Availability;
  source: string; kind: 'reported'; shareBasis: string; derivation: string;
};
/** 一個資料期 = 一份獨立證據；months 為該期的月末代表點數。 */
export type HistorySample = {
  period: string; quarter: string; deadline: string; date: string; firstDate: string; months: number;
  close: number; closeMin: number; closeMax: number;
  basis: number; multiple: number; multipleMin: number; multipleMax: number;
  growthYoY: number | null; netMargin: number | null; cashRatio: number | null; debtRatio: number | null; regime: Regime | null;
};
export type ScenarioMultiplesOut = {
  method: 'peer' | 'history';
  label: string;
  low: number; high: number; reason: string; source: string; period: string; sampleSize: number;
  peerComparability: string; cycle: string; growth: string; earningsStability: string; cash: string; debt: string;
  shareBasis: string;
  dispersion: number;
  /** low：歷史樣本 <6 期或離散 >2 倍 → 只列明細，不在主圖合成區間。 */
  confidence: 'normal' | 'low';
  caveats: string[];
};
export type ScenarioRowOut = {
  key: RulerKey;
  basis: ScenarioBasisOut | null;
  multiples: ScenarioMultiplesOut | null;
  /** 分母本身不適用的原因（與倍數信心分開）。 */
  basisIssue: string | null;
  /** 倍數信心：sufficient=有依據；insufficient=依據不足（分母仍可用）。 */
  multipleConfidence: 'peer' | 'history' | 'insufficient' | null;
  multipleIssue: string | null;
  notApplicable: string | null;
  peers: PeerMultiple[];
  samples: Array<HistorySample & { used: boolean; excluded: string | null }>;
};

export const SHARE_BASIS = {
  pe: '加權平均普通股（淨利÷基本 EPS；股本÷官方面額－庫藏股交叉核對）',
  pb: '期末普通股流通股數（股本÷官方面額－庫藏股）',
  ps: '同 PE 口徑；股數有變動時改最新季末流通股數並與官方核對',
} as const;

const BASIS_SOURCE: Record<RulerKey, string> = {
  pe: 'FinMind 綜合損益表：淨利（淨損）歸屬於母公司業主（近四季加總，已核對 origin_name 與本期淨利）',
  pb: 'FinMind 資產負債表：歸屬於母公司業主之權益（最近季末）',
  ps: 'FinMind 綜合損益表：營業收入（近四季加總；非月營收）',
};

const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');
export function derivationOf(key: RulerKey, b: CompanyBasis): string {
  const shares = key === 'pb' ? b.sharesEnd! : key === 'pe' ? b.weightedSharesUsed! : b.psShares!;
  const num = key === 'pe' ? b.niTtm! : key === 'pb' ? b.equityParent! : b.revenueTtm!;
  const label = key === 'pe' ? '近四季歸屬母公司淨利' : key === 'pb' ? '歸屬母公司權益' : '近四季營業收入';
  const v = b[BASIS_FIELD[key]]!;
  const latest = b.quarters.at(-1);
  const shareLabel = key === 'pb'
    ? `期末流通股（股本÷面額 ${b.par} 元${latest && latest.treasuryShares > 0 ? `－庫藏股 ${fmtInt(latest.treasuryShares)}` : ''}）`
    : `股（${key === 'pe' ? b.weightedRule : b.psShareRule}）`;
  const check = key === 'pe' && b.reportedEpsSum != null ? `；財報基本 EPS 四季合計 ${b.reportedEpsSum.toFixed(2)} 元僅供核對、未直接相加使用` : '';
  const off = key === 'pb' && b.officialShareDiff != null ? `；官方現行已發行股數與季末差 ${(b.officialShareDiff * 100).toFixed(3)}%` : '';
  const proxy = b.quarters.slice(-4).some((q) => q.proxied) ? '；未揭露母公司歸屬科目且無非控制權益，以本期淨利／權益總額代用' : '';
  return `${label} NT$${fmtInt(num)} ÷ ${fmtInt(shares)} ${shareLabel} = NT$${v.toFixed(2)}${check}${off}${proxy}`;
}

export type Regime = 'high' | 'mild' | 'decline';
export const REGIME_LABEL: Record<Regime, string> = { high: '高成長（營收年增 ≥20%）', mild: '溫和（年增 0–20%）', decline: '衰退（年增 <0）' };
export function regimeOf(g: number | null): Regime | null {
  if (g == null) return null;
  return g >= 0.2 ? 'high' : g >= 0 ? 'mild' : 'decline';
}

export type MonthPoint = {
  date: string; period: string; deadline: string; close: number; regime: Regime | null;
  eps: number | null; bvps: number | null; sps: number | null;
  growthYoY: number | null; netMargin: number | null; cashRatio: number | null; debtRatio: number | null;
};

/**
 * 本公司歷史月末代表點：每月最後一個交易日收盤 ÷ 當日「已過法定申報期限」的同口徑分母（asOf 模式）。
 * 相鄰交易日高度相關，所以只取月末一點；後續再以資料期為單位彙總，避免把相鄰月份當成獨立證據。
 */
export function monthlyHistory(symbol: string, fs: FinRow[], bs: FinRow[], prices: PriceRow[], asOf: string, official: OfficialShares | null): MonthPoint[] {
  const fsQ = byQuarter(fs);
  const bsQ = byQuarter(bs);
  const sorted = [...prices].filter((p) => p.close > 0 && p.date < asOf).sort((a, b) => a.date.localeCompare(b.date));
  const monthEnd = new Map<string, PriceRow>();
  for (const p of sorted) monthEnd.set(p.date.slice(0, 7), p);
  const memo = new Map<string, CompanyBasis>();
  const allPeriods = [...fsQ.keys()].filter((p) => statutoryDeadline(p)).sort();
  const out: MonthPoint[] = [];
  for (const px of monthEnd.values()) {
    const avail = allPeriods.filter((p) => statutoryDeadline(p)! <= px.date).at(-1);
    if (!avail) continue;
    let b = memo.get(avail);
    if (!b) { b = basisFromQuarters(symbol, fsQ, bsQ, statutoryDeadline(avail)!, { mode: 'asOf', official }); memo.set(avail, b); }
    if (!b.ok || b.latestPeriod !== avail) continue;
    out.push({
      date: px.date, period: avail, deadline: statutoryDeadline(avail)!, close: px.close, regime: regimeOf(b.growthYoY),
      eps: b.eps, bvps: b.bvps, sps: b.sps, growthYoY: b.growthYoY, netMargin: b.netMargin, cashRatio: b.cashRatio, debtRatio: b.debtRatio,
    });
  }
  return out;
}

/** 舊介面相容：每資料期一點（法定期限後 10 日內首個收盤）。 */
export function historyPoints(symbol: string, fs: FinRow[], bs: FinRow[], prices: PriceRow[], asOf: string, official: OfficialShares | null): MonthPoint[] {
  const sorted = [...prices].filter((p) => p.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const fsQ = byQuarter(fs); const bsQ = byQuarter(bs);
  const out: MonthPoint[] = [];
  for (const p of [...fsQ.keys()].sort()) {
    const d = statutoryDeadline(p);
    if (!d || d >= asOf) continue;
    const px = sorted.find((x) => x.date >= d && x.date < asOf);
    if (!px || (Date.parse(px.date) - Date.parse(d)) / 86400000 > 10) continue;
    const b = basisFromQuarters(symbol, fsQ, bsQ, d, { mode: 'asOf', official });
    if (!b.ok || b.latestPeriod !== p) continue;
    out.push({ date: px.date, deadline: d, period: p, close: px.close, regime: regimeOf(b.growthYoY), eps: b.eps, bvps: b.bvps, sps: b.sps, growthYoY: b.growthYoY, netMargin: b.netMargin, cashRatio: b.cashRatio, debtRatio: b.debtRatio });
  }
  return out;
}

/** 依資料期彙總月末點：每期一份證據（倍數取該期中位數）。 */
export function samplesByPeriod(key: RulerKey, points: MonthPoint[]): HistorySample[] {
  const groups = new Map<string, MonthPoint[]>();
  for (const p of points) {
    const d = p[BASIS_FIELD[key]];
    if (d == null || d <= 0) continue;
    const g = groups.get(p.period) || [];
    g.push(p); groups.set(p.period, g);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, g]) => {
    const basis = g[0][BASIS_FIELD[key]]!;
    const ms = g.map((p) => p.close / basis);
    const closes = g.map((p) => p.close);
    return {
      period, quarter: quarterLabel(period), deadline: g[0].deadline, firstDate: g[0].date, date: g[g.length - 1].date, months: g.length,
      close: median(closes), closeMin: Math.min(...closes), closeMax: Math.max(...closes),
      basis, multiple: median(ms), multipleMin: Math.min(...ms), multipleMax: Math.max(...ms),
      growthYoY: g[0].growthYoY, netMargin: g[0].netMargin, cashRatio: g[0].cashRatio, debtRatio: g[0].debtRatio, regime: g[0].regime,
    };
  });
}

export function buildScenarioRows(target: CompanyBasis, peers: PeerInput[], peerRule: string, history: MonthPoint[] = []): ScenarioRowOut[] {
  const tg = target.growthYoY;
  const similarText = tg == null ? '景氣不明' : `營收年增 ${pp(tg)}±${pp(growthTolerance(tg))}`;
  return (['pe', 'pb', 'ps'] as const).map((key) => {
    const list = peerMultiples(key, peers, target);
    if (!target.ok) {
      return { key, basis: null, multiples: null, basisIssue: target.reason, multipleConfidence: null, multipleIssue: null, notApplicable: target.reason, peers: list, samples: [] };
    }
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
    const all = samplesByPeriod(key, history);
    const samples = all
      .filter((s) => similarGrowth(s.growthYoY, target.growthYoY))
      .map((s) => {
        const same = s.period === target.latestPeriod;
        return { ...s, used: !same, excluded: same ? '與目前分母同一資料期，屬市場對同一份財報的定價，排除以免循環' : null };
      });
    const otherRegime = all.filter((s) => !similarGrowth(s.growthYoY, target.growthYoY)).length;
    const used = samples.filter((s) => s.used);
    const monthsUsed = used.reduce((a, s) => a + s.months, 0);
    let multiples: ScenarioMultiplesOut | null = null;
    if (valid.length >= MIN_PEERS) {
      const ms = valid.map((p) => p.multiple!);
      const disp = Math.max(...ms) / Math.min(...ms);
      multiples = {
        method: 'peer', label: '同業倍數情境',
        low: quantile(ms, 0.25), high: quantile(ms, 0.75),
        reason: `核心業務同業 ${valid.length} 家倍數的 25–75 百分位：${valid.map((p) => `${p.name}${p.symbol} ${p.multiple!.toFixed(1)}`).join('、')}`,
        source: '同業估值日收盤 ÷ 同業同口徑財報分母（FinMind；股數經官方面額換算）',
        period: `估值日 ${target.asOf}`, sampleSize: valid.length, peerComparability: peerRule,
        cycle: `同一估值日 ${target.asOf}，同一景氣時點`, ...risk, shareBasis: SHARE_BASIS[key],
        dispersion: disp, confidence: disp > 3 ? 'low' : 'normal',
        caveats: ['同業倍數情境，非合理價', ...(disp > 2 ? [`同業倍數最高/最低達 ${disp.toFixed(1)} 倍，區間僅取中段 50%`] : [])],
      };
    } else if (used.length >= MIN_HISTORY) {
      const ms = used.map((s) => s.multiple);
      const disp = Math.max(...used.map((s) => s.multipleMax)) / Math.min(...used.map((s) => s.multipleMin));
      const excluded = list.filter((p) => p.multiple == null).map((p) => `${p.name}${p.symbol}：${p.excluded}`).join('；');
      multiples = {
        method: 'history', label: '本公司歷史情境參考',
        low: quantile(ms, 0.25), high: quantile(ms, 0.75),
        reason: `本公司景氣相近（${similarText}）資料期 ${used.length} 期（月末點 ${monthsUsed} 個，同期先取中位數）的 25–75 百分位：${used.map((s) => `${s.quarter} ${s.multiple.toFixed(1)}`).join('、')}`,
        source: '本公司月末收盤 ÷ 當時已過法定申報期限的同口徑分母（FinMind）',
        period: `${used[0].firstDate}～${used[used.length - 1].date}`,
        sampleSize: used.length,
        peerComparability: `核心業務且風險／景氣可比同業 ${valid.length} 家（需 ≥${MIN_PEERS}），改用本公司歷史${excluded ? `；同業排除：${excluded}` : ''}`,
        cycle: `僅取營收年增與目前相近（${similarText}）的資料期；描述過去市場定價，不代表合理倍數`,
        ...risk, shareBasis: SHARE_BASIS[key],
        dispersion: disp, confidence: disp > 2 || used.length < 6 ? 'low' : 'normal',
        caveats: [
          '歷史情境參考，非合理價',
          ...(disp > 2 || used.length < 6 ? ['倍數信心低'] : []),
          `獨立證據以資料期計 ${used.length} 期，不以 ${monthsUsed} 個月點或交易日數計`,
          ...(disp > 2 ? [`月點倍數最高/最低達 ${disp.toFixed(1)} 倍，極值影響大，區間僅取中段 50%`] : []),
          ...(used.length < 6 ? [`僅 ${used.length} 期，代表性有限`] : []),
        ],
      };
    }
    const multipleIssue = !multiples
      ? `核心業務且風險／景氣可比同業 ${valid.length} 家（需 ≥${MIN_PEERS}）；本公司景氣相近（${similarText}）歷史 ${used.length} 期（需 ≥${MIN_HISTORY}，同資料期月點只算一期、已排除目前資料期${otherRegime ? `；另有 ${otherRegime} 期營收年增不相近未採用` : ''}），倍數依據不足`
      : null;
    return {
      key, basis, multiples,
      basisIssue: na,
      multipleConfidence: na ? null : multiples ? multiples.method : 'insufficient',
      multipleIssue: na ? null : multipleIssue,
      notApplicable: na ?? multipleIssue, peers: list, samples,
    };
  });
}

// ─────────────── 同業挑選：核心業務優先、題材不列條件、先排序再限流 ───────────────

export type PeerUniverseRow = { symbol: string; name: string; industries: string[]; market_groups?: string[] | null };
export type PeerCandidate = { symbol: string; name: string; rank: number; score: number; reasons: string[]; capital: number | null };
export type PeerAudit = PeerCandidate & { status: 'selected' | 'over_limit' | 'excluded'; detail: string };

/** 族群名稱若是題材／行情標籤（概念股、飆股），不當作商業模式相近的證據。 */
export const isThemeGroup = (g: string) => /概念|飆股|題材/.test(g);

export function rankPeerCandidates(
  target: { symbol: string; industries: string[]; market_groups?: string[] | null },
  universe: PeerUniverseRow[],
  capitalOf: (symbol: string) => number | null,
): PeerCandidate[] {
  const core = (target.industries || [])[0];
  if (!core) return [];
  const tCap = capitalOf(target.symbol);
  const tSecondary = (target.industries || []).slice(1);
  const tGroups = (target.market_groups || []).filter((g) => !isThemeGroup(g));
  return universe
    .filter((u) => u.symbol !== target.symbol && (u.industries || []).includes(core))
    .map((u) => {
      const reasons: string[] = [];
      let score = 0;
      if (u.industries[0] === core) { score += 3; reasons.push(`主業同為「${core}」`); } else { score += 1; reasons.push(`「${core}」為其次要業務（主業 ${u.industries[0]}）`); }
      const sec = tSecondary.filter((t) => u.industries.includes(t));
      if (sec.length) { score += sec.length; reasons.push(`共同次要業務 ${sec.join('、')}`); }
      const grp = tGroups.filter((g) => (u.market_groups || []).includes(g));
      if (grp.length) { score += 2 * grp.length; reasons.push(`同屬族群 ${grp.join('、')}`); }
      return { symbol: u.symbol, name: u.name, rank: 0, score, reasons, capital: capitalOf(u.symbol) };
    })
    .sort((a, b) => b.score - a.score || capDist(tCap, a.capital) - capDist(tCap, b.capital) || a.symbol.localeCompare(b.symbol))
    .map((c, i) => ({ ...c, rank: i + 1, reasons: [...c.reasons, c.capital && tCap ? `實收資本額為本檔 ${(c.capital / tCap).toFixed(2)} 倍` : '無官方資本額'] }));
}
function capDist(t: number | null, v: number | null) {
  return t && v && v > 0 ? Math.abs(Math.log(v / t)) : Number.POSITIVE_INFINITY;
}

/** 先排序、排除不可比者，再取前 max 家；每家附原因。 */
export function auditPeers(ranked: PeerCandidate[], listed: (symbol: string) => boolean, max: number): PeerAudit[] {
  let taken = 0;
  return ranked.map((c) => {
    if (!listed(c.symbol)) return { ...c, status: 'excluded' as const, detail: '官方上市／上櫃名錄查無（興櫃或已下市）：無集中市場收盤與核實面額' };
    if (taken < max) { taken++; return { ...c, status: 'selected' as const, detail: `入選（可比性第 ${c.rank}）` }; }
    return { ...c, status: 'over_limit' as const, detail: `可比性排名第 ${c.rank}，超過請求上限 ${max} 家未讀取` };
  });
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
