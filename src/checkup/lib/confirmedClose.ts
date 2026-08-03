/**
 * confirmedClose — 「最後完整交易日收盤」的**唯一身分**（純函式）。
 *
 * 問題：同一個數字在畫面上有四種可能來源（官方日 K、盤中 quote、舊 cache、
 * Demo 合成值），過去它們全部被寫進 `holding.price` 而沒有身分標記，於是
 * 8/4 午夜看到的「現價」其實是 8/3 上午 quote 或 Demo ±1.5% 亂數。
 *
 * 契約：
 *   - 只有「上游日 K 的最後一根 == latestCompletedTradeDate 且 OHLCV 完整」
 *     才算 confirmed（`state='confirmed'`）。
 *   - 其他一律 `state='pending'` 並帶 `reason`，UI 必須顯示「待確認」與
 *     實際落在哪一天，禁止用舊值假裝今日收盤。
 *   - 任何「應使用收盤」的欄位（現價、市值、今日漲跌、損益）都必須讀這裡。
 */
import {
  latestCompletedTradeDate,
  tradingDayLag,
  holidaysLoaded,
  type CalendarMarket,
} from './marketCalendar';

export interface DailyBar {
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number | null;
}

export interface SparklineLike {
  ohlc?: DailyBar[];
  closes?: number[];
  source?: string | null;
  fetchedAt?: string | null;
  tradeDate?: string | null;
}

export type ConfirmedCloseState = 'confirmed' | 'pending';
export type PendingReason =
  | 'no_bars'
  | 'no_source'
  | 'incomplete_ohlcv'
  | 'stale_trade_date'
  | 'ahead_of_expected'
  | 'holidays_unloaded';

/** 收盤身分卡：任何顯示收盤的地方都要能追溯到這張卡。 */
export interface ConfirmedClose {
  symbol: string;
  market: CalendarMarket;
  /** 期待的最後完整交易日 */
  expectedTradeDate: string;
  /** 實際資料落在哪一個交易日 */
  tradeDate: string | null;
  close: number | null;
  prevClose: number | null;
  changeAmount: number | null;
  changePercent: number | null;
  volume: number | null;
  source: string | null;
  fetchedAt: string | null;
  state: ConfirmedCloseState;
  reason: PendingReason | null;
  /** 落後幾個交易日（0 = 對齊） */
  lagTradingDays: number;
  /** 快取／稽核用的身分字串 */
  identity: string;
}

export const CONFIRMED_CLOSE_SCHEMA_VERSION = 1;

const REASON_TEXT: Record<PendingReason, string> = {
  no_bars: '上游無日 K',
  no_source: '來源未知',
  incomplete_ohlcv: '當日 OHLCV 不完整',
  stale_trade_date: '上游尚未提供該交易日',
  ahead_of_expected: '上游日期超前預期交易日',
  holidays_unloaded: '休市日表未載入',
};

function isCompleteBar(b?: DailyBar | null): boolean {
  if (!b) return false;
  const nums = [b.open, b.high, b.low, b.close].map(Number);
  if (!nums.every((n) => Number.isFinite(n) && n > 0)) return false;
  return Number.isFinite(Number(b.volume)) && Number(b.volume) > 0;
}

export function identityOf(input: {
  market: CalendarMarket; symbol: string; dataset: string; tradeDate: string | null;
}): string {
  return [
    input.market,
    String(input.symbol || '').toUpperCase(),
    input.dataset,
    input.tradeDate || 'none',
    `v${CONFIRMED_CLOSE_SCHEMA_VERSION}`,
  ].join(':');
}

/** 資料集快取鍵：市場 + 標的 + 資料集 + 交易日 + schema 版本。 */
export function datasetCacheKey(
  symbol: string,
  dataset: string,
  now: Date = new Date(),
  market: CalendarMarket = 'TW',
): string {
  return identityOf({
    market,
    symbol,
    dataset,
    tradeDate: latestCompletedTradeDate(now, { market }),
  });
}

/** 由 sparkline（官方日 K）建立收盤身分卡。 */
export function buildConfirmedClose(
  symbol: string,
  entry: SparklineLike | null | undefined,
  opts: { now?: Date; market?: CalendarMarket } = {},
): ConfirmedClose {
  const market = opts.market || 'TW';
  const now = opts.now || new Date();
  const expected = latestCompletedTradeDate(now, { market });
  const bars = Array.isArray(entry?.ohlc) ? entry!.ohlc!.filter((b) => b && b.date) : [];
  const last = bars.length ? bars[bars.length - 1] : null;
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const tradeDate = last?.date ? String(last.date).slice(0, 10) : null;
  const source = entry?.source ? String(entry.source) : null;

  let reason: PendingReason | null = null;
  if (!last) reason = 'no_bars';
  else if (!source) reason = 'no_source';
  else if (!isCompleteBar(last)) reason = 'incomplete_ohlcv';
  else if (tradeDate && tradeDate > expected) reason = 'ahead_of_expected';
  else if (tradeDate !== expected) reason = 'stale_trade_date';
  else if (!holidaysLoaded(market)) reason = 'holidays_unloaded';

  const close = Number.isFinite(Number(last?.close)) ? Number(last!.close) : null;
  const prevClose = Number.isFinite(Number(prev?.close)) ? Number(prev!.close) : null;
  const changeAmount = close != null && prevClose != null ? close - prevClose : null;
  const changePercent =
    changeAmount != null && prevClose ? (changeAmount / prevClose) * 100 : null;

  return {
    symbol: String(symbol || '').toUpperCase(),
    market,
    expectedTradeDate: expected,
    tradeDate,
    close,
    prevClose,
    changeAmount,
    changePercent,
    volume: Number.isFinite(Number(last?.volume)) ? Number(last!.volume) : null,
    source,
    fetchedAt: entry?.fetchedAt ? String(entry.fetchedAt) : null,
    state: reason == null ? 'confirmed' : 'pending',
    reason,
    lagTradingDays: tradeDate ? Math.max(0, tradingDayLag(expected, tradeDate, { market })) : 0,
    identity: identityOf({ market, symbol, dataset: 'daily_close', tradeDate }),
  };
}

function fmt(d: string | null): string {
  return d ? d.replace(/-/g, '/') : '—';
}

/** 一行狀態文案：已確認顯示交易日；待確認必須說出原因與實際日期。 */
export function confirmedCloseLabel(cc: ConfirmedClose): string {
  if (cc.state === 'confirmed') {
    return `收盤 已確認 · ${fmt(cc.tradeDate)}${cc.source ? ` · ${cc.source.toUpperCase()}` : ''}`;
  }
  const why = cc.reason ? REASON_TEXT[cc.reason] : '未知原因';
  const lag = cc.lagTradingDays >= 1 ? `（落後 ${cc.lagTradingDays} 個交易日）` : '';
  return `收盤 待確認 · 應為 ${fmt(cc.expectedTradeDate)}，目前 ${fmt(cc.tradeDate)}${lag} · ${why}`;
}

export interface HoldingPriceIdentity {
  price: number | null;
  priceSource: string;
  priceTradeDate: string | null;
  priceState: ConfirmedCloseState;
  priceReason: PendingReason | null;
  priceIdentity: string;
  priceUpdatedAt: string | null;
  todayChangePercent: number | null;
  todayChangeAmount: number | null;
}

/**
 * 把收盤身分卡轉成持倉欄位。confirmed 才會給 price；
 * pending 一律不覆寫（回傳 price=null），避免舊值假裝今日收盤。
 */
export function toHoldingPriceIdentity(cc: ConfirmedClose): HoldingPriceIdentity {
  const ok = cc.state === 'confirmed' && cc.close != null;
  return {
    price: ok ? cc.close : null,
    priceSource: ok ? 'official_close' : 'pending_close',
    priceTradeDate: cc.tradeDate,
    priceState: cc.state,
    priceReason: cc.reason,
    priceIdentity: cc.identity,
    priceUpdatedAt: cc.fetchedAt,
    todayChangePercent: ok ? cc.changePercent : null,
    todayChangeAmount: ok ? cc.changeAmount : null,
  };
}
