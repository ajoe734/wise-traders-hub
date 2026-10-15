/**
 * 估值站牌（純函式，零 I/O）。規則唯一來源：docs/valuation/three-rulers-rules.md
 * 主尺選擇 → 近一年逐日倍數 P20/P50/P80 × 近四季實際基本面；同業參考＝基本面 × 人工名單當日倍數平均。
 */
import peerGroupsJson from '@/checkup/data/valuationPeerGroups.json';
import { industryCodeOf } from '@/checkup/lib/industryCodes';

export type StationRuler = 'pe' | 'pb' | 'ps';

export const STATION_DEFAULTS = { peCap: 60, psGrowth: 0.2, lookbackDays: 240, minDays: 240, minPeers: 3, stressHaircut: 0.8 } as const;
export type StationThresholds = { peCap: number; psGrowth: number };

const FIN_KEYWORDS = ['金融', '銀行', '保險', '證券', '金控'];
export function isFinancialStock(industry?: string | null): boolean {
  return !!industry && FIN_KEYWORDS.some((k) => industry.includes(k));
}

export type MainRulerInput = {
  industry?: string | null;
  /** 近四季 EPS（財報）；null＝未知。 */
  ttmEps: number | null;
  /** 當日本益比；null＝無（虧損時交易所不公告）。 */
  currentPe: number | null;
  /** 營收年增率（0.25＝25%）；null＝未知。 */
  revenueYoY: number | null;
};

export function pickMainRuler(input: MainRulerInput, t: StationThresholds = STATION_DEFAULTS): { key: StationRuler; reason: string } {
  if (isFinancialStock(input.industry)) return { key: 'pb', reason: '金融股用 PB' };
  const loss = input.ttmEps != null && input.ttmEps <= 0;
  const tooHigh = input.currentPe != null && input.currentPe > t.peCap;
  if (loss || tooHigh) {
    const why = loss ? '近四季虧損' : `本益比超過 ${t.peCap} 倍`;
    if (input.revenueYoY != null && input.revenueYoY > t.psGrowth) return { key: 'ps', reason: `${why}，營收年增超過 ${Math.round(t.psGrowth * 100)}% 用 PS` };
    return { key: 'pb', reason: `${why}，營收年增未超過 ${Math.round(t.psGrowth * 100)}% 用 PB` };
  }
  return { key: 'pe', reason: '穩定獲利用 PE' };
}

/** 位置分位：排序後取 (n-1)·q 線性內插。 */
export function positionQuantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type Station = { key: 'board' | 'belt' | 'pressure'; label: string; multiple: number; price: number };
export type StationsResult =
  | { status: 'ready'; key: StationRuler; basis: number; days: number; stations: Station[] }
  | { status: 'insufficient'; key: StationRuler; reason: string };

/** history：依交易日升冪的逐日倍數；basis：近四季實際每股基本面。 */
export function buildStations(key: StationRuler, history: number[] | null | undefined, basis: number | null): StationsResult {
  if (!(basis != null && basis > 0)) return { status: 'insufficient', key, reason: key === 'pe' ? '近四季虧損或缺財報 EPS，PE 不適用' : '缺近四季財報每股基本面' };
  const valid = (history || []).filter((v) => Number.isFinite(v) && v > 0);
  if (!valid.length) return { status: 'insufficient', key, reason: `尚無逐日 ${key.toUpperCase()} 倍數序列` };
  const year = valid.slice(-STATION_DEFAULTS.lookbackDays);
  if (year.length < STATION_DEFAULTS.minDays) return { status: 'insufficient', key, reason: `資料不滿一年（${year.length}／${STATION_DEFAULTS.minDays} 個交易日）` };
  const sorted = [...year].sort((a, b) => a - b);
  const mk = (k: Station['key'], label: string, q: number): Station => {
    const multiple = positionQuantile(sorted, q);
    return { key: k, label, multiple, price: basis * multiple };
  };
  return { status: 'ready', key, basis, days: year.length, stations: [mk('board', '上車站', 0.2), mk('belt', '下車安全帶', 0.5), mk('pressure', '高壓站', 0.8)] };
}

export type PeerGroup = { key: string; code?: string | null; label: string; pickedAt: string; symbols: string[]; curation?: 'manual' | 'auto'; custom?: boolean; include?: string[]; exclude?: string[] };
export const PEER_GROUPS: PeerGroup[] = (peerGroupsJson as { groups: PeerGroup[] }).groups;
/**
 * 依產業代碼對應名單（名稱只經代碼表轉碼，不做字串比對）：
 * 含本檔的跨產業人工自訂組 → 本檔主產業代碼的名單 → 任何含本檔的名單 → null。
 */
export function findPeerGroup(symbol: string, industry?: string | null, groups: PeerGroup[] = PEER_GROUPS): PeerGroup | null {
  const code = industryCodeOf(industry);
  return groups.find((g) => g.custom && g.symbols.includes(symbol))
    ?? (code ? groups.find((g) => !g.custom && g.code === code) : null)
    ?? groups.find((g) => g.symbols.includes(symbol))
    ?? null;
}

export type PeerReference =
  | { status: 'ready'; group: string; curation: 'manual' | 'auto'; n: number; avgMultiple: number; price: number; symbols: string[] }
  | { status: 'insufficient'; reason: string };

/** 同業參考：人工名單（排除自己）當日倍數平均 × 本公司基本面；PS 取同業每日 PS（收盤 ÷ 近四季每股營收）；有效 < 3 家顯示資料不足。 */
export function buildPeerReference(
  symbol: string, key: StationRuler, basis: number | null,
  peers: Array<{ symbol: string; pe?: number | null; pb?: number | null; ps?: number | null }>,
  group: PeerGroup | null = findPeerGroup(symbol),
): PeerReference {
  if (!group) return { status: 'insufficient', reason: '尚未建立人工同業名單' };
  if (!(basis != null && basis > 0)) return { status: 'insufficient', reason: '缺近四季財報每股基本面' };
  const wanted = new Set(group.symbols.filter((s) => s !== symbol));
  const rows = peers.filter((p) => wanted.has(p.symbol))
    .map((p) => ({ symbol: p.symbol, m: Number(p[key]) }))
    .filter((r) => Number.isFinite(r.m) && r.m > 0);
  if (rows.length < STATION_DEFAULTS.minPeers) return { status: 'insufficient', reason: `同業不足 ${STATION_DEFAULTS.minPeers} 家（${group.label} 可用 ${rows.length} 家）` };
  const avg = rows.reduce((s, r) => s + r.m, 0) / rows.length;
  return { status: 'ready', group: group.label, curation: group.curation === 'manual' ? 'manual' : 'auto', n: rows.length, avgMultiple: avg, price: basis * avg, symbols: rows.map((r) => r.symbol) };
}

/** multiple/source 為 null＝只有預估 EPS（新聞具名來源），沒有券商前瞻倍數。 */
export type ForwardInput = { eps: number; multiple: number | null; period: string; source: string | null; epsSource?: string } | null;
export type SelfForward = { eps: number; period: string; source: string };
export type ForwardReference =
  | { status: 'ready'; mode: 'broker'; price: number; stress: number; impliedMultiple: number | null; period: string; source: string }
  | {
    status: 'ready'; mode: 'historical'; epsKind: 'news' | 'self'; eps: number; low: number; price: number; high: number;
    stress: number; stressLow: number; stressHigh: number; multiples: { p20: number; p50: number; p80: number };
    impliedMultiple: number | null; period: string; source: string;
  }
  | { status: 'insufficient'; reason: string };

/** 月營收自建前瞻 EPS：近四季 EPS × (1 + 近 3 個月營收年增率)；虧損或缺資料不畫。 */
export function selfForwardEps(ttmEps: number | null, rev: { yoy: number; latestMonth: string } | null | undefined): SelfForward | null {
  if (!(ttmEps != null && ttmEps > 0) || !rev || !Number.isFinite(rev.yoy) || rev.yoy <= -1) return null;
  const eps = ttmEps * (1 + rev.yoy);
  if (!(eps > 0)) return null;
  return { eps, period: '未來四季', source: `月營收自建估算（近 3 個月營收年增 ${(rev.yoy * 100).toFixed(1)}%，至 ${rev.latestMonth.replace('-', '/')}）` };
}

/**
 * 前瞻參考優先序：券商明寫前瞻倍數 > 新聞具名預估 EPS × 近一年歷史 PE P20/P50/P80 > 月營收自建 EPS × 同區間 > 資料不足。
 * 壓力測試＝EPS 八折。歷史倍數模式一律標「歷史倍數，非券商前瞻倍數」。
 */
export function buildForwardReference(input: ForwardInput, price: number | null, peHistory?: number[] | null, self?: SelfForward | null): ForwardReference {
  const implied = (eps: number) => (price && price > 0 ? price / eps : null);
  if (input && input.eps > 0 && input.multiple != null && input.multiple > 0 && input.source && input.period) {
    return {
      status: 'ready', mode: 'broker', price: input.eps * input.multiple, stress: input.eps * STATION_DEFAULTS.stressHaircut * input.multiple,
      impliedMultiple: implied(input.eps), period: input.period, source: input.source,
    };
  }
  const news = input && input.eps > 0 && input.period ? { eps: input.eps, period: input.period, source: input.epsSource || '具名新聞' } : null;
  const base = news ?? self ?? null;
  if (!base) return { status: 'insufficient', reason: '尚無前瞻預估 EPS（新聞沒有具名預估，月營收或近四季 EPS 不足）' };
  const year = (peHistory || []).filter((v) => Number.isFinite(v) && v > 0).slice(-STATION_DEFAULTS.lookbackDays);
  if (year.length < STATION_DEFAULTS.minDays) return { status: 'insufficient', reason: `近一年本益比不滿一年（${year.length}／${STATION_DEFAULTS.minDays} 個交易日），無歷史倍數可套` };
  const sorted = [...year].sort((a, b) => a - b);
  const p20 = positionQuantile(sorted, 0.2); const p50 = positionQuantile(sorted, 0.5); const p80 = positionQuantile(sorted, 0.8);
  const h = STATION_DEFAULTS.stressHaircut;
  return {
    status: 'ready', mode: 'historical', epsKind: news ? 'news' : 'self', eps: base.eps,
    low: base.eps * p20, price: base.eps * p50, high: base.eps * p80,
    stress: base.eps * h * p50, stressLow: base.eps * h * p20, stressHigh: base.eps * h * p80,
    multiples: { p20, p50, p80 }, impliedMultiple: implied(base.eps), period: base.period, source: base.source,
  };
}

/** 現價相對站牌的白話位置。 */
export function stationPosition(price: number | null, st: StationsResult): string | null {
  if (st.status !== 'ready' || !(price != null && price > 0)) return null;
  const [b, m, p] = st.stations.map((s) => s.price);
  const near = (x: number) => Math.abs(price - x) / x <= 0.03;
  if (near(b)) return '在上車站附近';
  if (price < b) return '低於上車站';
  if (price < m) return '介於上車站與下車安全帶';
  if (price < p) return '介於下車安全帶與高壓站';
  return '高於高壓站（警報）';
}
