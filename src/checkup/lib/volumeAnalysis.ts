/**
 * volumeAnalysis — 30 日走勢卡的量價分析（純函式，不碰 DOM）
 *
 * 為什麼存在：走勢卡原本只有 K 棒與高低，使用者無法判斷「量」。這裡把
 * 對齊／單位／均量／相對量能／量價狀態／壓力分群／突破判讀集中成可測純函式，
 * 元件只負責畫。
 *
 * 單位契約：輸入 `volume` 預設為「股」（TWSE STOCK_DAY 成交股數 / FinMind
 * Trading_Volume 皆為股）。對外顯示一律用「張」，換算只走 @/lib/lotSize，
 * 禁止在元件內再除以 1000。缺量一律 null，不補 0、不由價格推估。
 */
import { sharesToLots } from '@/lib/lotSize';

export interface RawBar {
  date?: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 成交股數；未知為 null（永遠不是 0） */
  volume: number | null;
  /** 成交張數；未知為 null */
  volumeLots: number | null;
}

export type VolumeUnit = 'shares' | 'lots';

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

function toIsoDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const m = s.match(ISO);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function finitePos(n: unknown): boolean {
  const v = Number(n);
  return Number.isFinite(v) && v > 0;
}

/** 清洗 + 依 trade_date 對齊排序 + 去重（同日後到者勝）。 */
export function normalizeBars(raw: RawBar[] | null | undefined, unit: VolumeUnit = 'shares'): Bar[] {
  const byDate = new Map<string, Bar>();
  for (const b of Array.isArray(raw) ? raw : []) {
    if (!b) continue;
    const date = toIsoDate(b.date);
    if (!date) continue;
    if (![b.open, b.high, b.low, b.close].every(finitePos)) continue;
    const v = Number(b.volume);
    const shares = Number.isFinite(v) && v > 0 ? (unit === 'lots' ? v * 1000 : v) : null;
    byDate.set(date, {
      date,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: shares,
      volumeLots: shares == null ? null : sharesToLots(shares),
    });
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface AvgResult {
  value: number | null;
  available: number;
  required: number;
}

/** 最近 n 根的平均成交張數；視窗內任一根缺量即回 null（不當 0）。 */
export function rollingAvgVolumeLots(
  bars: Bar[],
  n: number,
  opts: { excludeLast?: boolean } = {},
): AvgResult {
  const src = opts.excludeLast ? bars.slice(0, -1) : bars;
  const win = src.slice(-n);
  const vals = win.map((b) => b.volumeLots).filter((v): v is number => v != null);
  if (win.length < n || vals.length < n) {
    return { value: null, available: vals.length, required: n };
  }
  return { value: vals.reduce((a, b) => a + b, 0) / n, available: vals.length, required: n };
}

/** 副圖用：每根對應的 MA5（含當日），不足 5 根為 null。 */
export function ma5Series(bars: Bar[]): Array<number | null> {
  return bars.map((_, i) => {
    if (i < 4) return null;
    const win = bars.slice(i - 4, i + 1).map((b) => b.volumeLots);
    if (win.some((v) => v == null)) return null;
    return (win as number[]).reduce((a, b) => a + b, 0) / 5;
  });
}

export interface VolumeStats {
  hasVolume: boolean;
  intraday: boolean;
  todayLots: number | null;
  todayShares: number | null;
  todayLabel: string;
  ma5Lots: number | null;
  ma5Insufficient: string | null;
  ma20Lots: number | null;
  ma20Insufficient: string | null;
  /** 當日量 / 前 20 完整交易日均量；盤中或資料不足為 null */
  relVolume: number | null;
}

function insufficientLabel(r: AvgResult): string | null {
  return r.value == null ? `資料不足 ${r.available}/${r.required}` : null;
}

export function computeVolumeStats(bars: Bar[], opts: { intraday?: boolean } = {}): VolumeStats {
  const intraday = !!opts.intraday;
  const last = bars[bars.length - 1] ?? null;
  const ma5 = rollingAvgVolumeLots(bars, 5);
  const ma20 = rollingAvgVolumeLots(bars, 20, { excludeLast: true });
  const todayLots = last?.volumeLots ?? null;
  // 盤中：未收盤累積量不可除完整日均量（無 same-time history 就不給倍數）
  const relVolume =
    !intraday && todayLots != null && ma20.value != null && ma20.value > 0
      ? todayLots / ma20.value
      : null;
  return {
    hasVolume: bars.some((b) => b.volumeLots != null),
    intraday,
    todayLots,
    todayShares: last?.volume ?? null,
    todayLabel: intraday ? '盤中成交量' : '今日量',
    ma5Lots: ma5.value,
    ma5Insufficient: insufficientLabel(ma5),
    ma20Lots: ma20.value,
    ma20Insufficient: insufficientLabel(ma20),
    relVolume,
  };
}

export type PriceVolumeState =
  | 'up_vol_up' | 'up_vol_down' | 'down_vol_up' | 'down_vol_down' | 'flat' | 'unknown';

const PV_LABEL: Record<PriceVolumeState, string> = {
  up_vol_up: '價漲量增',
  up_vol_down: '價漲量縮',
  down_vol_up: '價跌量增',
  down_vol_down: '價跌量縮',
  flat: '平盤',
  unknown: '尚無法判斷',
};

export function classifyPriceVolume(
  bars: Bar[],
  opts: { intraday?: boolean } = {},
): { state: PriceVolumeState; label: string } {
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (!last || !prev) return { state: 'unknown', label: PV_LABEL.unknown };
  const chg = (last.close - prev.close) / prev.close;
  if (Math.abs(chg) < 1e-4) return { state: 'flat', label: PV_LABEL.flat };
  if (opts.intraday) return { state: 'unknown', label: PV_LABEL.unknown };
  const ma20 = rollingAvgVolumeLots(bars, 20, { excludeLast: true }).value;
  if (ma20 == null || last.volumeLots == null) return { state: 'unknown', label: PV_LABEL.unknown };
  const volUp = last.volumeLots >= ma20;
  const state: PriceVolumeState = chg > 0
    ? (volUp ? 'up_vol_up' : 'up_vol_down')
    : (volUp ? 'down_vol_up' : 'down_vol_down');
  return { state, label: PV_LABEL[state] };
}

// ── 壓力區 ───────────────────────────────────────────────

export interface ResistanceZone {
  lower: number;
  upper: number;
  touches: number;
  lookback: number;
  basis: 'cluster' | 'swing_high';
}

export const RESISTANCE_LOOKBACK = 60;
const CLUSTER_TOL = 0.02;

/** 前後各 2 個交易日的 local pivot high。 */
export function pivotHighs(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 2; i < bars.length - 2; i += 1) {
    const h = bars[i].high;
    if ([-2, -1, 1, 2].every((k) => h > bars[i + k].high)) out.push(h);
  }
  return out;
}

/**
 * 保守壓力規則：最近 60 日 pivot highs → 2% 內分群 →
 * 優先「現價上方最近、至少 2 次觸及」；否則退回最近 swing high（參考壓力）。
 */
export function findResistanceZone(bars: Bar[], price: number): ResistanceZone | null {
  const win = bars.slice(-RESISTANCE_LOOKBACK);
  const lookback = win.length;
  const pivots = pivotHighs(win).sort((a, b) => a - b);
  if (!pivots.length) return null;

  const groups: number[][] = [];
  for (const p of pivots) {
    const g = groups[groups.length - 1];
    if (g && p <= g[0] * (1 + CLUSTER_TOL)) g.push(p);
    else groups.push([p]);
  }
  const zones = groups.map((g) => ({
    lower: Math.min(...g),
    upper: Math.max(...g),
    touches: g.length,
    lookback,
    basis: 'cluster' as const,
  }));

  const p = Number(price);
  const valid = zones.filter((z) => z.touches >= 2);
  if (Number.isFinite(p)) {
    const above = valid.filter((z) => z.lower > p).sort((a, b) => a.lower - b.lower);
    if (above.length) return above[0];
  }
  if (valid.length) return valid[valid.length - 1];

  // 沒有 2 次觸及 → 只能標示參考壓力（最近的 swing high）
  const singles = zones.map((z) => z.upper).sort((a, b) => a - b);
  const target = Number.isFinite(p)
    ? (singles.find((v) => v > p) ?? singles[singles.length - 1])
    : singles[singles.length - 1];
  return { lower: target, upper: target, touches: 1, lookback, basis: 'swing_high' };
}

export type DistanceState = 'below' | 'testing' | 'above';

export function resistanceDistance(
  zone: ResistanceZone | null,
  price: number,
): { pct: number; state: DistanceState } | null {
  if (!zone || !Number.isFinite(price) || price <= 0) return null;
  if (price > zone.upper) return { pct: (zone.lower - price) / price, state: 'above' };
  if (price >= zone.lower) return { pct: 0, state: 'testing' };
  return { pct: (zone.lower - price) / price, state: 'below' };
}

export type BreakoutState =
  | 'breakout_confirmed' | 'breakout_unconfirmed' | 'failed_breakout'
  | 'testing' | 'below' | 'unknown';

const BREAKOUT_LABEL: Record<BreakoutState, string> = {
  breakout_confirmed: '帶量突破',
  breakout_unconfirmed: '突破，量能未確認',
  failed_breakout: '突破未站穩',
  testing: '測試壓力',
  below: '壓力下方',
  unknown: '尚無壓力區',
};

/** 帶量突破門檻：相對 20 日均量 >= 1.5。 */
export const BREAKOUT_VOL_RATIO = 1.5;

export function breakoutState({
  bars,
  zone,
  relVolume,
  price,
}: {
  bars: Bar[];
  zone: ResistanceZone | null;
  relVolume: number | null;
  /** 判讀基準價；未給則用最後一根收盤（與距離計算用同一個價，避免自相矛盾） */
  price?: number;
}): { state: BreakoutState; label: string } {
  const last = bars[bars.length - 1];
  if (!zone || !last) return { state: 'unknown', label: BREAKOUT_LABEL.unknown };
  const c = Number.isFinite(price as number) && (price as number) > 0 ? Number(price) : last.close;
  if (c > zone.upper) {
    const state: BreakoutState = relVolume != null && relVolume >= BREAKOUT_VOL_RATIO
      ? 'breakout_confirmed'
      : 'breakout_unconfirmed';
    return { state, label: BREAKOUT_LABEL[state] };
  }
  if (c >= zone.lower) return { state: 'testing', label: BREAKOUT_LABEL.testing };
  const recent = bars.slice(-5, -1);
  if (recent.some((b) => b.close > zone.upper)) {
    return { state: 'failed_breakout', label: BREAKOUT_LABEL.failed_breakout };
  }
  return { state: 'below', label: BREAKOUT_LABEL.below };
}

// ── 組裝 ─────────────────────────────────────────────────

export interface VolumeAnalysis {
  /** 顯示用（最近 N 根，預設 30） */
  displayBars: Bar[];
  /** 顯示區間對應的 MA5 量線（不足為 null） */
  displayMa5: Array<number | null>;
  stats: VolumeStats;
  pv: { state: PriceVolumeState; label: string };
  zone: ResistanceZone | null;
  distance: { pct: number; state: DistanceState } | null;
  breakout: { state: BreakoutState; label: string };
  summary: string;
  emptyVolumeReason: string | null;
}

function pct1(v: number): string {
  return `${(Math.abs(v) * 100).toFixed(1)}%`;
}

function lots(v: number | null): string {
  return v == null ? '—' : `${Math.round(v).toLocaleString('zh-TW')} 張`;
}

export function buildVolumeAnalysis({
  rawBars,
  price,
  intraday = false,
  displayCount = 30,
  volumeUnit = 'shares',
}: {
  rawBars: RawBar[] | null | undefined;
  price: number;
  intraday?: boolean;
  displayCount?: number;
  volumeUnit?: VolumeUnit;
}): VolumeAnalysis {
  const bars = normalizeBars(rawBars, volumeUnit);
  const displayBars = bars.slice(-displayCount);
  const stats = computeVolumeStats(bars, { intraday });
  const pv = classifyPriceVolume(bars, { intraday });
  const lastClose = bars[bars.length - 1]?.close;
  const ref = Number.isFinite(price) && Number(price) > 0 ? Number(price) : Number(lastClose);
  const zone = findResistanceZone(bars, ref);
  const distance = resistanceDistance(zone, ref);
  const breakout = breakoutState({ bars, zone, relVolume: stats.relVolume, price: ref });

  // ── 一句話判讀（描述資料狀態，不給買賣建議） ──
  const parts: string[] = [];
  if (zone && distance) {
    const name = zone.basis === 'cluster' ? '壓力區' : '參考壓力';
    if (distance.state === 'testing') parts.push(`價格進入${name}，測試壓力`);
    else if (distance.state === 'above') parts.push(`價格站上${name}上緣，${breakout.label}`);
    else if (Math.abs(distance.pct) <= NEAR_RESISTANCE_PCT) parts.push(`接近${name}，距離 ${pct1(distance.pct)}`);
    else parts.push(`距離${name} ${pct1(distance.pct)}`);
  } else {
    parts.push('近 60 日未形成明確壓力區');
  }
  if (!stats.hasVolume) {
    parts.push('無成交量資料');
  } else if (stats.intraday) {
    parts.push(`盤中成交量 ${lots(stats.todayLots)}，未收盤不與日均量比較`);
  } else if (stats.relVolume != null) {
    parts.push(`成交量為 20 日均量 ${stats.relVolume.toFixed(2)} 倍，${pv.label}`);
  } else {
    parts.push(`20 日均量${stats.ma20Insufficient ?? '不可得'}，${pv.label}`);
  }

  return {
    displayBars,
    displayMa5: ma5Series(bars).slice(-displayCount),
    stats,
    pv,
    zone,
    distance,
    breakout,
    summary: `${parts.join('；')}。`,
    emptyVolumeReason: stats.hasVolume ? null : '無成交量資料',
  };
}

export const __labels = { PV_LABEL, BREAKOUT_LABEL };
