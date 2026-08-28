/**
 * marketDataStatus — 公開市場資料的「來源／交易日／抓取時間／是否已確認」單一資料源（純函式）
 *
 * 為什麼存在：抽屜以前只顯示「報價更新於 19:20」，讓盤中 quote 的 polling 時間
 * 看起來像是「今日收盤已確認」。實際上兩者是不同事實：
 *   - quote（現價）：盤中會變，polling 成功不代表收盤定案。
 *   - daily close（日 K 收盤）：只有在上游回傳「當日完整 OHLCV」且 tradeDate
 *     等於預期的最後交易日時，才可以標記為已確認（finalized）。
 *
 * 這裡只做判定與文案，不碰 DOM、不發網路請求。
 */

import { latestCompletedTradeDate } from './marketCalendar';
import { datasetCacheKey, identityOf } from './confirmedClose';

export type MarketCode = 'TW';

export interface DailyBarLike {
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number | null;
}

export interface DailyCloseStatus {
  /** 上游來源（TWSE / TPEX / FINMIND …）；未知為 null */
  source: string | null;
  /** 最後一根日 K 的交易日（YYYY-MM-DD）；無資料為 null */
  tradeDate: string | null;
  /** 這批資料的抓取時間（ISO）；未知為 null */
  fetchedAt: string | null;
  /** 是否為「已確認的當日收盤」 */
  isFinal: boolean;
  /** 依台北時間推算的預期最後交易日 */
  expectedTradeDate: string;
  statusLabel: '已確認' | '待來源確認';
  /** UI 顯示文字（精簡一行） */
  text: string;
  pendingReason: 'no_bars' | 'no_source' | 'incomplete_ohlcv' | 'stale_trade_date' | null;
}

function taipeiParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    dow: wdMap[get('weekday')] ?? 0,
  };
}




/** 台北當日日期（YYYY-MM-DD）。 */
export function taipeiDateKey(now: Date = new Date()): string {
  return taipeiParts(now).date;
}

/** 收盤 13:30 + 35 分鐘結算緩衝後，才把「今天」當成可期待的交易日。 */
export const TW_SETTLE_MINUTE = 13 * 60 + 30 + 35;

/**
 * 依台北時間推算「目前應該拿得到的最後一個日 K 交易日」。
 *
 * 實作已下沉到 `marketCalendar.latestCompletedTradeDate`（單一資料源，含
 * `tw_market_holidays` 休市日）；這裡只保留舊呼叫點的相容出口。
 */
export function expectedTradeDate(now: Date = new Date()): string {
  return latestCompletedTradeDate(now, { market: 'TW' });
}

function isCompleteBar(b: DailyBarLike | undefined | null): boolean {
  if (!b) return false;
  const nums = [b.open, b.high, b.low, b.close].map(Number);
  if (!nums.every((n) => Number.isFinite(n) && n > 0)) return false;
  return Number.isFinite(Number(b.volume)) && Number(b.volume) > 0;
}

function fmt(d: string | null): string {
  return d ? d.replace(/-/g, '/') : '—';
}

/**
 * 判定日 K 收盤是否已確認。
 * 已確認條件（全部成立）：有上游 source、最後一根為完整 OHLCV、
 * 且其 tradeDate 等於預期最後交易日。
 */
export function buildDailyCloseStatus({
  bars,
  source,
  fetchedAt,
  now = new Date(),
}: {
  bars: DailyBarLike[] | null | undefined;
  source?: string | null;
  fetchedAt?: string | null;
  now?: Date;
}): DailyCloseStatus {
  const list = Array.isArray(bars) ? bars.filter((b) => b && b.date) : [];
  const last = list.length ? list[list.length - 1] : null;
  const expected = expectedTradeDate(now);
  const src = source ? String(source).toUpperCase() : null;
  const tradeDate = last?.date ? String(last.date) : null;

  let pendingReason: DailyCloseStatus['pendingReason'] = null;
  if (!last) pendingReason = 'no_bars';
  else if (!src) pendingReason = 'no_source';
  else if (!isCompleteBar(last)) pendingReason = 'incomplete_ohlcv';
  else if (tradeDate !== expected) pendingReason = 'stale_trade_date';

  const isFinal = pendingReason == null;
  const tail = src ? ` · ${src}` : '';
  const text = isFinal
    ? `日 K 收盤 已確認 · ${fmt(tradeDate)}${tail}`
    : `日 K 收盤 待來源確認 · 最後交易日 ${fmt(tradeDate)}${tail}`;

  return {
    source: src,
    tradeDate,
    fetchedAt: fetchedAt ? String(fetchedAt) : null,
    isFinal,
    expectedTradeDate: expected,
    statusLabel: isFinal ? '已確認' : '待來源確認',
    text,
    pendingReason,
  };
}

/**
 * 走勢快取鍵：market:symbol:dataset:tradeDate:schemaVersion（單一資料源 = `datasetCacheKey`）。
 * 交易日換日即自然失效；帶 dataset 後不同資料集不會互相汙染。
 */
export function sparklineCacheKey(
  code: string,
  now: Date = new Date(),
  market: MarketCode = 'TW',
): string {
  return datasetCacheKey(code, 'daily_ohlc', now, market);
}

/**
 * 走勢快取鍵（明確 trade date 版）：由 expected snapshot 直接導出，
 * 不在 effect 內再問「現在幾點」，確保 cache key / attempt key / reservation key 同源。
 * 輸出格式與 `sparklineCacheKey` 完全一致（同一支 `identityOf`）。
 */
export function sparklineCacheKeyForTradeDate(
  code: string,
  tradeDate: string,
  market: MarketCode = 'TW',
): string {
  return identityOf({ market, symbol: code, dataset: 'daily_ohlc', tradeDate: tradeDate || null });
}

