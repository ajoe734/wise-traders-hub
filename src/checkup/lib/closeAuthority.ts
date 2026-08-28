/**
 * closeAuthority — 「最後完整交易日官方收盤」的唯一取數 seam。
 *
 * 為什麼不能沿用 `daily_price_snapshots`：那張表是每日 14:00（台北）從
 * `current_prices` 複寫過去的鏡像，遇到冷門股（例：6274 連三日都寫 1620、
 * 量 8453）就會把「上一次成功的盤中 quote」偽裝成當日收盤，且欄位缺 OHLC。
 * 官方日 K（TWSE STOCK_DAY / FinMind）才是收盤事實。
 *
 * 契約：
 *   - 只回傳 `state==='confirmed'`（tradeDate 對齊 latestCompletedTradeDate
 *     且 OHLCV 完整）的收盤；否則該代號不出現在結果中。
 *   - 呼叫端拿不到 → 必須顯示「待確認」，不得用舊 cache / quote / Demo 值頂替。
 */
import { getCheckupGateway } from './gateway';
import {
  buildConfirmedClose,
  type ConfirmedClose,
  type SparklineLike,
} from './confirmedClose';
import { loadMarketHolidays } from './marketHolidaysLoader';

export type ConfirmedCloseMap = Record<string, ConfirmedClose>;

/**
 * gateway attempt 的可觀測結果：
 *   'ok'     invoke resolved 且 `data.result` 是 object（缺席的 code → factual pending）
 *   'absent' invoke resolved 但 `data.result` 不是 object（回應形狀不合契約）
 *   'throw'  invoke throw（transport failure）
 * 只有 'ok' 代表「這次 attempt 真的完成」，caller 才可據此關掉重試。
 */
export type CloseFetchTransport = 'ok' | 'throw' | 'absent';

export interface DailyCloseCardsResult {
  cards: ConfirmedCloseMap;
  transport: CloseFetchTransport;
}

/** 取一批代號的官方日 K，並回報 transport（供 caller 判斷 attempt 是否完成）。 */
export async function fetchDailyCloseCardsDetailed(
  codes: string[],
  now: Date = new Date(),
): Promise<DailyCloseCardsResult> {
  const symbols = Array.from(
    new Set((codes || []).map((c) => String(c || '').trim()).filter(Boolean)),
  );
  const cards: ConfirmedCloseMap = {};
  if (!symbols.length) return { cards, transport: 'ok' };

  // 休市日表未載入時 buildConfirmedClose 會標 pending（不謊報已確認）
  await loadMarketHolidays().catch(() => false);

  try {
    const data = await getCheckupGateway()
      .invoke<{ result?: Record<string, SparklineLike> }>('checkup-sparkline', { codes: symbols });
    const raw = (data as { result?: unknown } | null | undefined)?.result;
    const ok = !!raw && typeof raw === 'object' && !Array.isArray(raw);
    const result = (ok ? raw : {}) as Record<string, SparklineLike>;
    for (const symbol of symbols) {
      cards[symbol] = buildConfirmedClose(symbol, result[symbol], { now });
    }
    return { cards, transport: ok ? 'ok' : 'absent' };
  } catch {
    for (const symbol of symbols) cards[symbol] = buildConfirmedClose(symbol, null, { now });
    return { cards, transport: 'throw' };
  }
}

/** 取一批代號的官方日 K，並轉成收盤身分卡（含 pending 者，供 UI 說明原因）。 */
export async function fetchDailyCloseCards(
  codes: string[],
  now: Date = new Date(),
): Promise<ConfirmedCloseMap> {
  return (await fetchDailyCloseCardsDetailed(codes, now)).cards;
}

/** 只留下已確認的收盤（symbol → close）。 */
export function confirmedOnly(map: ConfirmedCloseMap): Record<string, ConfirmedClose> {
  const out: Record<string, ConfirmedClose> = {};
  for (const [symbol, cc] of Object.entries(map || {})) {
    if (cc.state === 'confirmed' && cc.close != null) out[symbol] = cc;
  }
  return out;
}

/** 取一批代號的已確認收盤價（未確認者不會出現）。 */
export async function fetchConfirmedCloses(
  codes: string[],
  now: Date = new Date(),
): Promise<Record<string, ConfirmedClose>> {
  return confirmedOnly(await fetchDailyCloseCards(codes, now));
}
