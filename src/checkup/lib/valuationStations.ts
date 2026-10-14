/**
 * 估值站牌（純函式，零 I/O）。規則唯一來源：docs/valuation/three-rulers-rules.md
 * 主尺選擇 → 近一年逐日倍數 P20/P50/P80 × 近四季實際基本面；同業參考＝基本面 × 人工名單當日倍數平均。
 */
import peerGroupsJson from '@/checkup/data/valuationPeerGroups.json';

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

export type PeerGroup = { key: string; label: string; pickedAt: string; symbols: string[]; curation?: 'manual' | 'auto' };
export const PEER_GROUPS: PeerGroup[] = (peerGroupsJson as { groups: PeerGroup[] }).groups;
/** 先找含本檔的人工名單，再依主分類名稱對應名單（名單全為人工確認，不再區分初選）。 */
export function findPeerGroup(symbol: string, industry?: string | null, groups: PeerGroup[] = PEER_GROUPS): PeerGroup | null {
  return groups.find((g) => g.symbols.includes(symbol))
    ?? (industry ? groups.find((g) => g.label === industry) : null)
    ?? null;
}

export type PeerReference =
  | { status: 'ready'; group: string; curation: 'manual' | 'auto'; n: number; avgMultiple: number; price: number; symbols: string[] }
  | { status: 'insufficient'; reason: string };

/** 同業參考：人工名單（排除自己）當日倍數平均 × 本公司基本面；有效 < 3 家顯示資料不足。 */
export function buildPeerReference(
  symbol: string, key: StationRuler, basis: number | null,
  peers: Array<{ symbol: string; pe?: number | null; pb?: number | null }>,
  group: PeerGroup | null = findPeerGroup(symbol),
): PeerReference {
  if (!group) return { status: 'insufficient', reason: '尚未建立人工同業名單' };
  if (key === 'ps') return { status: 'insufficient', reason: '同業當日 PS 倍數尚無資料' };
  if (!(basis != null && basis > 0)) return { status: 'insufficient', reason: '缺近四季財報每股基本面' };
  const wanted = new Set(group.symbols.filter((s) => s !== symbol));
  const rows = peers.filter((p) => wanted.has(p.symbol))
    .map((p) => ({ symbol: p.symbol, m: Number(p[key]) }))
    .filter((r) => Number.isFinite(r.m) && r.m > 0);
  if (rows.length < STATION_DEFAULTS.minPeers) return { status: 'insufficient', reason: `同業不足 ${STATION_DEFAULTS.minPeers} 家（${group.label} 可用 ${rows.length} 家）` };
  const avg = rows.reduce((s, r) => s + r.m, 0) / rows.length;
  return { status: 'ready', group: group.label, curation: group.curation === 'manual' ? 'manual' : 'auto', n: rows.length, avgMultiple: avg, price: basis * avg, symbols: rows.map((r) => r.symbol) };
}

export type ForwardInput = { eps: number; multiple: number; period: string; source: string } | null;
export type ForwardReference =
  | { status: 'ready'; price: number; stress: number; impliedMultiple: number | null; period: string; source: string }
  | { status: 'insufficient'; reason: string };

/** 前瞻參考：未來四季預估 EPS × 前瞻本益比；壓力測試＝EPS 八折。只有自建預估模型才有。 */
export function buildForwardReference(input: ForwardInput, price: number | null): ForwardReference {
  if (!input || !(input.eps > 0) || !(input.multiple > 0) || !input.source || !input.period) return { status: 'insufficient', reason: '尚無自建預估模型' };
  return {
    status: 'ready', price: input.eps * input.multiple, stress: input.eps * STATION_DEFAULTS.stressHaircut * input.multiple,
    impliedMultiple: price && price > 0 ? price / input.eps : null, period: input.period, source: input.source,
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
