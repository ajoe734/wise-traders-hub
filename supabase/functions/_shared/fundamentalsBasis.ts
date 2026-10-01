/**
 * fundamentalsBasis —— 三把尺（PE/PB/PS）的獨立財報分母與同業倍數純函式。
 *
 * 不依賴 Deno / 瀏覽器 API：Edge Function 與 Vitest 共用同一份。
 *
 * 規則（不得放寬）：
 *   - 分母只來自財報原始科目，禁止以股價÷比率反推。
 *   - 股數一律用「普通股股本 ÷ 面額 10 元」的期末股數；並以每季「歸屬母公司淨利 ÷ 財報基本 EPS」
 *     反算股數交叉核對，差距 > 5% 視為股數基準無法核對（含配股、減資、非 10 元面額）。
 *   - PE / PS 用四季加總÷四季平均期末股數，不直接相加不同股數基準的 EPS。
 *   - 公開可得日用法定公告期限（實際公告日不晚於此）；期限晚於估值日的季別不用。
 *   - 倍數 = 可比同業「同一估值日收盤 ÷ 同口徑分母」，取最小–最大，有效樣本 < 3 不成立。
 */

export type FinRow = { date: string; type: string; value: number };
export type PriceRow = { date: string; close: number };
export type RulerKey = 'pe' | 'pb' | 'ps';

export const SHARE_BASIS = {
  pe: '四季平均期末普通股（股本÷面額10元）',
  pb: '期末普通股（股本÷面額10元）',
  ps: '四季平均期末普通股（股本÷面額10元）',
} as const;

const SHARE_TOLERANCE = 0.05;

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
  publishedAt: string;
  revenue: number | null;
  netIncomeParent: number | null;
  reportedEps: number | null;
  sharesEnd: number | null;
  impliedShares: number | null;
  equityParent: number | null;
};

export type CompanyBasis = {
  symbol: string;
  ok: boolean;
  reason: string | null;
  asOf: string;
  quarters: QuarterLine[];
  period: string | null;
  publishedAt: string | null;
  niTtm: number | null;
  revenueTtm: number | null;
  reportedEpsSum: number | null;
  sharesAvg: number | null;
  sharesEnd: number | null;
  shareChange: boolean;
  equityParent: number | null;
  eps: number | null;
  bvps: number | null;
  sps: number | null;
  /** 個別尺不適用原因（分母 <= 0 或缺科目）。 */
  notApplicable: Partial<Record<RulerKey, string>>;
  growthYoY: number | null;
  positiveQuarters: number | null;
  quartersObserved: number;
  cashRatio: number | null;
  debtRatio: number | null;
};

export function computeCompanyBasis(symbol: string, fs: FinRow[], bs: FinRow[], asOf: string): CompanyBasis {
  const fsQ = byQuarter(fs);
  const bsQ = byQuarter(bs);
  const periods = [...new Set([...fsQ.keys()])]
    .filter((p) => { const d = statutoryDeadline(p); return d != null && d <= asOf; })
    .sort();
  const lines: QuarterLine[] = periods.map((p) => {
    const f = fsQ.get(p) || {};
    const b = bsQ.get(p) || {};
    const ni = f.EquityAttributableToOwnersOfParent ?? null;
    const eps = f.EPS ?? null;
    const shares = b.OrdinaryShare != null && b.OrdinaryShare > 0 ? b.OrdinaryShare / 10 : null;
    return {
      period: p,
      publishedAt: statutoryDeadline(p)!,
      revenue: f.Revenue ?? null,
      netIncomeParent: ni,
      reportedEps: eps,
      sharesEnd: shares,
      impliedShares: ni != null && eps != null && Math.abs(eps) >= 0.05 ? ni / eps : null,
      equityParent: b.EquityAttributableToOwnersOfParent ?? null,
    };
  });
  const base: CompanyBasis = {
    symbol, ok: false, reason: null, asOf, quarters: lines.slice(-8), period: null, publishedAt: null,
    niTtm: null, revenueTtm: null, reportedEpsSum: null, sharesAvg: null, sharesEnd: null, shareChange: false,
    equityParent: null, eps: null, bvps: null, sps: null, notApplicable: {},
    growthYoY: null, positiveQuarters: null, quartersObserved: 0, cashRatio: null, debtRatio: null,
  };
  const last4 = lines.slice(-4);
  if (last4.length < 4) return { ...base, reason: `估值日前已過公告期限的季報不足四季（${last4.length}）` };
  // 四季必須連續
  const contiguous = last4.every((l, i) => i === 0 || monthsBetween(last4[i - 1].period, l.period) === 3);
  if (!contiguous) return { ...base, reason: '近四季季報不連續' };
  const latest = last4[3];
  const latestBs = bsQ.get(latest.period) || {};
  if (last4.some((l) => l.sharesEnd == null)) return { ...base, reason: '缺期末普通股股本，無法取得股數基準' };
  // 股數交叉核對
  for (const l of last4) {
    if (l.impliedShares != null && l.impliedShares > 0) {
      const diff = Math.abs(l.impliedShares - l.sharesEnd!) / l.sharesEnd!;
      if (diff > SHARE_TOLERANCE) {
        return { ...base, reason: `${l.period} 淨利÷EPS 反算股數與股本÷10 差 ${(diff * 100).toFixed(1)}%，股數基準無法核對` };
      }
    }
  }
  const sharesList = last4.map((l) => l.sharesEnd!);
  const sharesAvg = sharesList.reduce((a, b) => a + b, 0) / 4;
  const shareChange = Math.max(...sharesList) / Math.min(...sharesList) - 1 > 0.005;
  const sumOf = (k: 'revenue' | 'netIncomeParent' | 'reportedEps') =>
    last4.every((l) => l[k] != null) ? last4.reduce((a, l) => a + Number(l[k]), 0) : null;
  const niTtm = sumOf('netIncomeParent');
  const revenueTtm = sumOf('revenue');
  const reportedEpsSum = sumOf('reportedEps');
  const equityParent = latest.equityParent;
  const notApplicable: Partial<Record<RulerKey, string>> = {};
  const eps = niTtm == null ? null : niTtm / sharesAvg;
  const bvps = equityParent == null ? null : equityParent / latest.sharesEnd!;
  const sps = revenueTtm == null ? null : revenueTtm / sharesAvg;
  if (eps == null) notApplicable.pe = '缺歸屬母公司淨利';
  else if (eps <= 0) notApplicable.pe = '近四季歸屬母公司淨利 ≤ 0，PE 不適用';
  if (bvps == null) notApplicable.pb = '缺歸屬母公司權益';
  else if (bvps <= 0) notApplicable.pb = '歸屬母公司權益 ≤ 0，PB 不適用';
  if (sps == null) notApplicable.ps = '缺營業收入（金融業等無此科目）';
  else if (sps <= 0) notApplicable.ps = '近四季營收 ≤ 0，PS 不適用';

  const prev4 = lines.slice(-8, -4);
  const prevRev = prev4.length === 4 && prev4.every((l) => l.revenue != null)
    ? prev4.reduce((a, l) => a + Number(l.revenue), 0) : null;
  const last8 = lines.slice(-8);
  const totalAssets = latestBs.TotalAssets;
  return {
    ...base,
    ok: true,
    period: `${last4[0].period}～${latest.period}（近四季）`,
    publishedAt: latest.publishedAt,
    niTtm, revenueTtm, reportedEpsSum, sharesAvg, sharesEnd: latest.sharesEnd, shareChange,
    equityParent, eps, bvps, sps, notApplicable,
    growthYoY: prevRev && revenueTtm != null && prevRev > 0 ? revenueTtm / prevRev - 1 : null,
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
    growth: `近四季營收年增 ${pct(b.growthYoY)}`,
    earningsStability: b.positiveQuarters == null ? '—' : `近 ${b.quartersObserved} 季獲利季數 ${b.positiveQuarters}`,
    cash: `現金/總資產 ${pct(b.cashRatio)}`,
    debt: `負債/總資產 ${pct(b.debtRatio)}`,
  };
}

export type ScenarioBasisOut = {
  value: number; unit: 'TWD/share'; period: string; publishedAt: string; source: string;
  kind: 'reported'; shareBasis: string;
};
export type ScenarioMultiplesOut = {
  low: number; high: number; reason: string; source: string; period: string; sampleSize: number;
  peerComparability: string; cycle: string; growth: string; earningsStability: string; cash: string; debt: string;
  shareBasis: string;
};
export type ScenarioRowOut = {
  key: RulerKey;
  basis: ScenarioBasisOut | null;
  multiples: ScenarioMultiplesOut | null;
  notApplicable: string | null;
  peers: PeerMultiple[];
};

const BASIS_SOURCE: Record<RulerKey, string> = {
  pe: 'FinMind 綜合損益表：歸屬母公司淨利（近四季加總）÷ 資產負債表普通股股本/10',
  pb: 'FinMind 資產負債表：歸屬母公司權益 ÷ 普通股股本/10',
  ps: 'FinMind 綜合損益表：營業收入（近四季加總）÷ 資產負債表普通股股本/10',
};

export function buildScenarioRows(
  target: CompanyBasis,
  peers: PeerInput[],
  peerRule: string,
): ScenarioRowOut[] {
  return (['pe', 'pb', 'ps'] as const).map((key) => {
    const list = peerMultiples(key, peers);
    if (!target.ok) return { key, basis: null, multiples: null, notApplicable: target.reason, peers: list };
    const na = target.notApplicable[key] ?? null;
    const value = target[BASIS_FIELD[key]];
    const basis: ScenarioBasisOut | null = na || value == null ? null : {
      value, unit: 'TWD/share', period: target.period!, publishedAt: target.publishedAt!,
      source: BASIS_SOURCE[key], kind: 'reported', shareBasis: SHARE_BASIS[key],
    };
    const valid = list.filter((p) => p.multiple != null);
    let multiples: ScenarioMultiplesOut | null = null;
    if (valid.length >= 3) {
      const ms = valid.map((p) => p.multiple!);
      const risk = describeRisk(target);
      multiples = {
        low: Math.min(...ms),
        high: Math.max(...ms),
        reason: `同業最低–最高：${valid.map((p) => `${p.name}${p.symbol} ${p.multiple!.toFixed(2)}`).join('、')}`,
        source: '同業估值日收盤 ÷ 同業同口徑財報分母（FinMind）',
        period: `估值日 ${target.asOf}`,
        sampleSize: valid.length,
        peerComparability: peerRule,
        cycle: `同一估值日 ${target.asOf}，同一景氣時點`,
        growth: risk.growth,
        earningsStability: risk.earningsStability,
        cash: risk.cash,
        debt: risk.debt,
        shareBasis: SHARE_BASIS[key],
      };
    }
    const lack = !multiples ? `可比同業有效樣本 ${valid.length} 家（需 ≥3）` : null;
    return { key, basis, multiples, notApplicable: na ?? lack, peers: list };
  });
}

/** 同業挑選：與目標共用全部細分產業標籤；候選超過 max 家時依近四季營收規模最接近者。 */
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
  return [...peers]
    .sort((a, b) => scaleDistance(t, a.basis.revenueTtm) - scaleDistance(t, b.basis.revenueTtm))
    .slice(0, max);
}
function scaleDistance(t: number, v: number | null) {
  return v && v > 0 ? Math.abs(Math.log(v / t)) : Number.POSITIVE_INFINITY;
}
