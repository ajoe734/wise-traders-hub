/**
 * reversalSignals — 30 日走勢卡的「精簡轉折觀察」（純函式，不碰 DOM）
 *
 * 只做 4 種高訊號量價轉折，全部用已完成的 daily OHLCV 判斷：
 *   低檔放量長下影 / 低檔放量多頭吞噬 / 高檔爆量長上影 / 高檔放量空頭吞噬
 *
 * 設計約束（來自產品規格）：
 *  - 盤中未完成 K 棒不得冒充已確認訊號（呼叫端以 intraday 旗標排除最後一根）。
 *  - 位置條件（近期低／高檔、短期漲跌勢、接近支撐／壓力）必須可測試地定義，
 *    禁止只看一根 K 棒、禁止硬編碼特定股票價格。
 *  - 訊號當日只能是「待確認」；後續完整交易日收盤站上／跌破觸發價才 confirmed，
 *    反向失效為 failed。失效與過期訊號不再常駐。
 */
import type { Bar } from './volumeAnalysis';

export type ReversalKind =
  | 'hammer'              // 低檔放量長下影
  | 'bullish_engulfing'   // 低檔放量多頭吞噬
  | 'shooting_star'       // 高檔爆量長上影
  | 'bearish_engulfing';  // 高檔放量空頭吞噬

export type ReversalDirection = 'bullish' | 'bearish';
export type ReversalState = 'pending' | 'confirmed' | 'failed';

export interface ReversalSignal {
  kind: ReversalKind;
  direction: ReversalDirection;
  state: ReversalState;
  /** 訊號日（ISO yyyy-mm-dd） */
  signalDate: string;
  /** 多方＝訊號日高點；空方＝訊號日低點。確認門檻價。 */
  triggerPrice: number;
  /** 命中理由（可測試、可顯示於 debug） */
  reasons: string[];
  /** 在傳入 bars 陣列中的索引 */
  index: number;
  /** 相對 20 日均量（訊號日） */
  relVolume: number;
  /** 確認／失效日（尚未發生為 null） */
  resolvedDate: string | null;
  /** 訊號後已經過的完整交易日數 */
  ageBars: number;
  /** 確認／失效日之後已經過的完整交易日數（未解決為 null 時以 0 計） */
  confirmedAgeBars: number;
}

// ── 可調參數（集中一處，測試可引用） ─────────────────────
export const REVERSAL_VOL_RATIO = 1.2;      // 相對 20 日均量門檻
export const VOL_LOOKBACK = 20;             // 均量視窗（不含當日）
export const CTX_LOOKBACK = 20;             // 近期高／低檔視窗（含當日）
export const NEAR_EXTREME_PCT = 0.03;       // 距離區間端點 3% 內視為「近期低／高檔」
export const TREND_LEN = 5;                 // 短期趨勢比較長度
export const TREND_PCT = 0.02;              // 短期漲跌勢門檻
export const NEAR_ZONE_PCT = 0.03;          // 接近壓力／支撐 3%
export const MIN_BODY_RATIO = 0.05;         // 實體 / 全日區間；低於此視為 doji，不判形態
export const SHADOW_BODY_MULT = 2;          // 影線 >= 實體 2 倍
export const PENDING_MAX_AGE = 5;           // 待確認超過 5 個完整交易日即過期
export const CONFIRMED_MAX_AGE = 3;         // 已確認顯示 3 個完整交易日

export const REVERSAL_LABEL: Record<ReversalKind, string> = {
  hammer: '低檔放量長下影',
  bullish_engulfing: '低檔放量多頭吞噬',
  shooting_star: '高檔爆量長上影',
  bearish_engulfing: '高檔放量空頭吞噬',
};

/** 同日多型態時的決勝序（風險提示優先，且為 deterministic）。 */
export const KIND_PRIORITY: ReversalKind[] = [
  'shooting_star',
  'bearish_engulfing',
  'hammer',
  'bullish_engulfing',
];

function ok(n: unknown): n is number {
  return Number.isFinite(Number(n));
}

/** 訊號日相對 20 日均量；視窗內任一根缺量回 null。 */
function relVolumeAt(bars: Bar[], i: number): number | null {
  if (i < VOL_LOOKBACK) return null;
  const win = bars.slice(i - VOL_LOOKBACK, i);
  const vals = win.map((b) => b.volumeLots);
  if (vals.length < VOL_LOOKBACK || vals.some((v) => v == null)) return null;
  const avg = (vals as number[]).reduce((a, b) => a + b, 0) / VOL_LOOKBACK;
  const cur = bars[i]?.volumeLots;
  if (!(avg > 0) || cur == null) return null;
  return cur / avg;
}

interface Ctx {
  nearLow: boolean;
  nearHigh: boolean;
  downtrend: boolean;
  uptrend: boolean;
  nearResistance: boolean;
}

export function positionContext(
  bars: Bar[],
  i: number,
  opts: { resistanceZone?: { lower: number; upper: number } | null } = {},
): Ctx {
  const start = Math.max(0, i - CTX_LOOKBACK + 1);
  const win = bars.slice(start, i + 1);
  const lows = win.map((b) => b.low);
  const highs = win.map((b) => b.high);
  const minLow = Math.min(...lows);
  const maxHigh = Math.max(...highs);
  const cur = bars[i];

  const nearLow = minLow > 0 && cur.low <= minLow * (1 + NEAR_EXTREME_PCT);
  const nearHigh = maxHigh > 0 && cur.high >= maxHigh * (1 - NEAR_EXTREME_PCT);

  const prev = bars[i - 1];
  const past = bars[i - TREND_LEN];
  const downtrend = !!prev && !!past && past.close > 0
    && prev.close <= past.close * (1 - TREND_PCT);
  const uptrend = !!prev && !!past && past.close > 0
    && prev.close >= past.close * (1 + TREND_PCT);

  const z = opts.resistanceZone ?? null;
  const nearResistance = !!z && ok(z.lower) && z.lower > 0
    && cur.high >= z.lower * (1 - NEAR_ZONE_PCT);

  return { nearLow, nearHigh, downtrend, uptrend, nearResistance };
}

interface Shape {
  range: number;
  body: number;
  bodyRatio: number;
  upperShadow: number;
  lowerShadow: number;
  isDoji: boolean;
}

function shapeOf(b: Bar): Shape | null {
  if (!b || ![b.open, b.high, b.low, b.close].every(ok)) return null;
  const range = b.high - b.low;
  if (!(range > 0)) return null; // high = low：無法判形態
  const body = Math.abs(b.close - b.open);
  const bodyRatio = body / range;
  return {
    range,
    body,
    bodyRatio,
    upperShadow: b.high - Math.max(b.open, b.close),
    lowerShadow: Math.min(b.open, b.close) - b.low,
    isDoji: bodyRatio < MIN_BODY_RATIO,
  };
}

function detectAt(
  bars: Bar[],
  i: number,
  opts: { resistanceZone?: { lower: number; upper: number } | null },
): Array<Pick<ReversalSignal, 'kind' | 'direction' | 'reasons'>> {
  const cur = bars[i];
  const prev = bars[i - 1];
  const s = shapeOf(cur);
  if (!cur || !s || s.isDoji) return [];
  const ctx = positionContext(bars, i, opts);
  const out: Array<Pick<ReversalSignal, 'kind' | 'direction' | 'reasons'>> = [];

  const lowCtx = ctx.nearLow || ctx.downtrend;
  const highCtx = ctx.nearHigh || ctx.uptrend || ctx.nearResistance;
  const lowCtxReason = ctx.nearLow ? '近 20 日低檔' : '短期跌勢後';
  const highCtxReason = ctx.nearResistance ? '接近有效壓力' : ctx.nearHigh ? '近 20 日高檔' : '短期漲勢後';

  // 1) 低檔放量長下影
  if (lowCtx
    && s.lowerShadow >= SHADOW_BODY_MULT * s.body
    && cur.close >= cur.low + s.range / 2) {
    out.push({
      kind: 'hammer',
      direction: 'bullish',
      reasons: [lowCtxReason, '下影線 ≥ 實體 2 倍', '收盤位於全日上半部'],
    });
  }

  // 3) 高檔爆量長上影
  if (highCtx
    && s.upperShadow >= SHADOW_BODY_MULT * s.body
    && cur.close <= cur.low + s.range / 2) {
    out.push({
      kind: 'shooting_star',
      direction: 'bearish',
      reasons: [highCtxReason, '上影線 ≥ 實體 2 倍', '收盤位於全日下半部'],
    });
  }

  const ps = prev ? shapeOf(prev) : null;
  if (prev && ps && !ps.isDoji) {
    // 2) 低檔放量多頭吞噬
    if (lowCtx
      && prev.close < prev.open
      && cur.close > cur.open
      && cur.close >= prev.open && cur.open <= prev.close) {
      out.push({
        kind: 'bullish_engulfing',
        direction: 'bullish',
        reasons: [lowCtxReason, '多方實體吞噬前一根空方實體'],
      });
    }
    // 4) 高檔放量空頭吞噬
    if (highCtx
      && prev.close > prev.open
      && cur.close < cur.open
      && cur.close <= prev.open && cur.open >= prev.close) {
      out.push({
        kind: 'bearish_engulfing',
        direction: 'bearish',
        reasons: [highCtxReason, '空方實體吞噬前一根多方實體'],
      });
    }
  }

  return out;
}

/**
 * 偵測全部轉折訊號（依日期由舊到新）。
 * @param bars 已排序、已完成的日 K（呼叫端負責排除盤中未完成棒）
 */
export function detectReversalSignals(
  bars: Bar[] | null | undefined,
  opts: { resistanceZone?: { lower: number; upper: number } | null } = {},
): ReversalSignal[] {
  const src = Array.isArray(bars) ? bars : [];
  if (src.length <= VOL_LOOKBACK) return []; // 資料不足：不產生訊號
  const out: ReversalSignal[] = [];
  for (let i = VOL_LOOKBACK; i < src.length; i += 1) {
    const rel = relVolumeAt(src, i);
    if (rel == null || rel < REVERSAL_VOL_RATIO) continue;
    const hits = detectAt(src, i, opts);
    if (!hits.length) continue;
    // 同日多型態：只保留優先序最高者（deterministic）
    hits.sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind));
    const hit = hits[0];
    const cur = src[i];
    const triggerPrice = hit.direction === 'bullish' ? cur.high : cur.low;

    let state: ReversalState = 'pending';
    let resolvedDate: string | null = null;
    let resolvedIndex: number | null = null;
    for (let j = i + 1; j < src.length; j += 1) {
      const c = src[j].close;
      if (hit.direction === 'bullish') {
        if (c > cur.high) { state = 'confirmed'; resolvedDate = src[j].date; resolvedIndex = j; break; }
        if (c < cur.low) { state = 'failed'; resolvedDate = src[j].date; resolvedIndex = j; break; }
      } else {
        if (c < cur.low) { state = 'confirmed'; resolvedDate = src[j].date; resolvedIndex = j; break; }
        if (c > cur.high) { state = 'failed'; resolvedDate = src[j].date; resolvedIndex = j; break; }
      }
    }

    out.push({
      kind: hit.kind,
      direction: hit.direction,
      state,
      signalDate: cur.date,
      triggerPrice,
      reasons: [...hit.reasons, `相對 20 日均量 ${rel.toFixed(2)} 倍`],
      index: i,
      relVolume: rel,
      resolvedDate,
      ageBars: src.length - 1 - i,
      confirmedAgeBars: resolvedIndex == null ? 0 : src.length - 1 - resolvedIndex,
    });
  }
  return out;
}

/**
 * 畫面同時最多 1 個：已確認 > 待確認；同級取最近；再同取 KIND_PRIORITY。
 * failed 與過期（pending > 5 日、confirmed > 3 日）不再顯示。
 */
export function selectActiveReversal(
  signals: ReversalSignal[] | null | undefined,
): ReversalSignal | null {
  const alive = (Array.isArray(signals) ? signals : []).filter((s) => {
    if (s.state === 'failed') return false;
    if (s.state === 'confirmed') {
      // 以「確認日之後」計齡，避免久遠訊號長期常駐
      const idx = s.resolvedDate ? s.resolvedDate : null;
      return idx == null ? false : s.confirmedAgeBars <= CONFIRMED_MAX_AGE;
    }
    return s.ageBars <= PENDING_MAX_AGE;
  });
  if (!alive.length) return null;
  const rank = (s: ReversalSignal) => (s.state === 'confirmed' ? 0 : 1);
  return [...alive].sort((a, b) => (
    rank(a) - rank(b)
    || b.index - a.index
    || KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind)
  ))[0];
}

function priceText(v: number): string {
  return Number(v).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 走勢摘要第二行文案；無訊號回 null（呼叫端整行不渲染）。 */
export function buildReversalLine(signal: ReversalSignal | null | undefined): string | null {
  if (!signal || signal.state === 'failed') return null;
  const label = REVERSAL_LABEL[signal.kind];
  if (signal.state === 'confirmed') {
    return `${signal.direction === 'bullish' ? '止跌訊號已確認' : '轉弱訊號已確認'} · ${label}`;
  }
  const head = signal.direction === 'bullish' ? '轉折觀察' : '轉弱觀察';
  const verb = signal.direction === 'bullish' ? '站上' : '跌破';
  return `${head} · ${label}，${verb} ${priceText(signal.triggerPrice)} 才確認`;
}

/** tooltip 用：日期 → 該日型態文字（只有命中日才有 key）。 */
export function reversalByDate(
  signals: ReversalSignal[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of Array.isArray(signals) ? signals : []) {
    const state = s.state === 'confirmed' ? '已確認' : s.state === 'failed' ? '已失效' : '待確認';
    out[s.signalDate] = `${REVERSAL_LABEL[s.kind]} · ${state}`;
  }
  return out;
}

/**
 * 顯示優先序：既有突破狀態 > 已確認轉折 > 待確認轉折 > 基本量價狀態。
 * 突破狀態已在第一行講完時，不再增加第二行。
 */
export function shouldShowReversalLine(breakoutState: string | null | undefined): boolean {
  return !(breakoutState === 'breakout_confirmed'
    || breakoutState === 'breakout_unconfirmed'
    || breakoutState === 'failed_breakout');
}
