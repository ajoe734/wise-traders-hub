/**
 * 全站唯一的市場判別 + 幣別 + 美股交易日 helper。
 *
 * 判別規則（由 instrument / symbol 決定）：
 *   - TW: 4~6 碼數字 + 可選單字母（含 ETF 如 00878、盤後零股 2330R）
 *   - US: 字母開頭、可含 . 或 -（AAPL、BRK.B、BRK-B、GOOG）
 *   - 其他：預設 TW 保底，避免舊資料誤判
 *
 * 呼叫端（stock-price-sync / daily-performance / daily-snapshot /
 * publish-weekly-journals）皆走此檔案，禁止再自寫 regex。
 */

export type Market = 'TW' | 'US';

export function detectMarket(instrumentOrSymbol: string | null | undefined): Market {
  const raw = String(instrumentOrSymbol || '').trim();
  if (!raw) return 'TW';
  const sym = raw.split(/\s+/)[0]?.trim() ?? '';
  if (!sym) return 'TW';
  if (/^\d{4,6}[A-Z]?$/.test(sym)) return 'TW';
  if (/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(sym)) return 'US';
  return 'TW';
}

export function currencyOf(market: Market): 'USD' | 'TWD' {
  return market === 'US' ? 'USD' : 'TWD';
}

export function extractSymbol(instrument: string | null | undefined): string {
  return String(instrument || '').trim().split(/\s+/)[0] ?? '';
}

/**
 * 取得 `d`（UTC）在美東（America/New_York，含 DST）曆日的 YYYY-MM-DD。
 * 若當日是週末，回推到最近的星期五（美股快照用）。
 */
export function nyTradeDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(d);
  const info = Object.fromEntries(
    parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  let ymd = `${info.year}-${info.month}-${info.day}`;
  const wd = info.weekday || '';
  if (wd === 'Sat') {
    // back to Friday
    const d1 = new Date(`${ymd}T12:00:00Z`);
    d1.setUTCDate(d1.getUTCDate() - 1);
    ymd = d1.toISOString().slice(0, 10);
  } else if (wd === 'Sun') {
    const d1 = new Date(`${ymd}T12:00:00Z`);
    d1.setUTCDate(d1.getUTCDate() - 2);
    ymd = d1.toISOString().slice(0, 10);
  }
  return ymd;
}
