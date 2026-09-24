/**
 * quoteRequestGate —— 報價批次請求的過期保護（2026-09-24）。
 *
 * 契約：
 *   - 每次 refreshPrices 取一個單調遞增 request id；只有「最新」id 的回應可以寫入持倉。
 *   - 新請求開始時 abort 上一個（signal 交給支援 AbortSignal 的 fetch；不支援者靠 id 丟棄）。
 *   - 合併只動價格相關欄位；股數／成本／名稱一律取「目前」持倉（prev），
 *     因此請求開始後使用者的編輯不會被舊回應覆蓋。
 *   - 代碼已不在持倉（使用者刪除）→ 不復活；回應時間早於持倉現有報價時間 → 不倒退。
 */

export interface QuoteHit {
  price: number;
  source: string;
  updatedAt?: string | null;
  tradeDate?: string | null;
  state?: string | null;
  reason?: string | null;
}

export interface QuoteRequestTicket {
  id: number;
  startedAt: number;
  signal: AbortSignal | null;
}

export function createQuoteRequestGate() {
  let seq = 0;
  let current: AbortController | null = null;
  return {
    begin(now: number = Date.now()): QuoteRequestTicket {
      seq += 1;
      try { current?.abort(); } catch { /* ignore */ }
      current = typeof AbortController !== 'undefined' ? new AbortController() : null;
      return { id: seq, startedAt: now, signal: current?.signal ?? null };
    },
    isCurrent(ticket: QuoteRequestTicket): boolean {
      return ticket.id === seq;
    },
    get latestId() { return seq; },
  };
}

/** 價格相關欄位；合併時只允許寫這些欄位。 */
export const QUOTE_FIELDS = [
  'price', 'value', 'pnl', 'pct',
  'priceSource', 'priceTradeDate', 'priceState', 'priceReason', 'priceUpdatedAt', 'priceError',
] as const;

type Calc = (h: any, price: number) => { value: number; pnl: number; pct: number };

/**
 * 以「目前」持倉 h 為底，只覆寫價格欄位。
 * 回傳原物件代表不需變更（避免整份持倉換參考）。
 */
/** 成交輸入帶來的價格（成交價，不是市場報價）。 */
export const TRADE_PRICE_SOURCES = new Set(['manual', 'screenshot']);

/** 這檔目前顯示的價格是否只是成交價、尚未拿到市場報價。 */
export function isAwaitingMarketQuote(h: any): boolean {
  return !!h && TRADE_PRICE_SOURCES.has(h.priceSource);
}

export function mergeQuoteIntoHolding(h: any, hit: QuoteHit | undefined, calc: Calc, nowIso: string): any {
  if (!h || !hit || !(Number(hit.price) > 0)) return h;
  const prevTs = h.priceUpdatedAt ? Date.parse(h.priceUpdatedAt) : NaN;
  const hitTs = hit.updatedAt ? Date.parse(hit.updatedAt) : NaN;
  // 比現有「市場報價」還舊（例如 realtime 已推了更新價）→ 不倒退。
  // 成交價（manual/screenshot）的時間戳是輸入當下，不可拿來擋掉較早時間的市場報價。
  if (!isAwaitingMarketQuote(h) && Number.isFinite(prevTs) && Number.isFinite(hitTs) && hitTs < prevTs) return h;
  const { value, pnl, pct } = calc(h, Number(hit.price));
  const next = {
    ...h,
    price: Number(hit.price),
    value, pnl, pct,
    priceSource: hit.source,
    priceTradeDate: hit.tradeDate ?? null,
    priceState: hit.state ?? null,
    priceReason: hit.state === 'confirmed' ? null : (hit.reason || 'stale_trade_date'),
    priceUpdatedAt: hit.updatedAt || nowIso,
    priceError: null,
  };
  for (const k of QUOTE_FIELDS) if (next[k] !== h[k]) return next;
  return h;
}
