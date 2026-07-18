/**
 * 全站唯一的市場判別 + 幣別 + 美股交易日 helper。
 *
 * 判別規則（由 instrument / symbol 決定）：
 *   - TW: 4~6 碼數字 + 可選單字母（含 ETF 如 00878、盤後零股 2330R）
 *   - US: 字母開頭、可含 . 或 -（AAPL、BRK.B、BRK-B、GOOG）
 *   - US_OPTION: OCC 21 字元格式（AAPL240119C00150000）
 *   - US_FUTURE: `/` 起首（/ES, /NQ, /CL）
 *   - 其他：預設 TW 保底，避免舊資料誤判
 *
 * 呼叫端（stock-price-sync / daily-performance / daily-snapshot /
 * publish-weekly-journals）皆走此檔案，禁止再自寫 regex。
 */

export type Market = 'TW' | 'US' | 'US_OPTION' | 'US_FUTURE';

const US_OPTION_RE = /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/;
const US_FUTURE_RE = /^\/[A-Z0-9]{1,3}[FGHJKMNQUVXZ]?\d{0,2}$/;

export function detectMarket(instrumentOrSymbol: string | null | undefined): Market {
  const raw = String(instrumentOrSymbol || '').trim();
  if (!raw) return 'TW';
  // 期貨代碼含 `/`，先判別（不要 split，'/ES' 是完整代號）
  const first = raw.split(/\s+/)[0]?.trim() ?? '';
  if (US_FUTURE_RE.test(first)) return 'US_FUTURE';
  // 選擇權：先移除代號和到期日之間可能存在的空白
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (US_OPTION_RE.test(compact) || US_OPTION_RE.test(first.toUpperCase())) return 'US_OPTION';
  if (!first) return 'TW';
  if (/^\d{4,6}[A-Z]?$/.test(first)) return 'TW';
  if (/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(first)) return 'US';
  return 'TW';
}

/** 是否為衍生性商品（無自動行情，pipeline 需 skip） */
export function isDerivativeMarket(m: Market): boolean {
  return m === 'US_OPTION' || m === 'US_FUTURE';
}

export function currencyOf(market: Market): 'USD' | 'TWD' {
  return market === 'TW' ? 'TWD' : 'USD';
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
