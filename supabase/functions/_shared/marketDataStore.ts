/**
 * 市場資料庫存（股價日線、月營收）唯一讀寫接縫。
 * - 頁面讀取型接口（valuation-fundamentals、checkup-sparkline）只准用 read* / requestSymbols，不打外部來源。
 * - 外部抓取只在排程函式 market-data-sync 內進行。
 * 純函式（parse*、rocToIso）與 Vitest 共用。
 */
type Db = { from: (table: string) => any };

export type StoredBar = { date: string; open: number; high: number; low: number; close: number; volume: number | null };
export type MonthRevenueRow = { revenue: number; revenue_year: number; revenue_month: number };

const num = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) && String(v ?? '').trim() !== '' && String(v).trim() !== '--' ? n : null;
};

/** 民國 yyyMMdd → ISO；格式錯誤回 null。 */
export function rocToIso(roc: unknown): string | null {
  const s = String(roc ?? '').trim();
  const m = /^(\d{3})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}

export type PriceRowInsert = { symbol: string; trade_date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; source: string };

/** 證交所 STOCK_DAY_ALL ＋ 櫃買 daily_close_quotes → 日線列（日期一律取資料本身的 Date，不用執行日）。 */
export function parseExchangeDaily(twse: unknown, tpex: unknown): PriceRowInsert[] {
  const out: PriceRowInsert[] = [];
  for (const r of Array.isArray(twse) ? twse : []) {
    const d = rocToIso(r?.Date); const close = num(r?.ClosingPrice); const code = String(r?.Code ?? '').trim();
    if (!d || close == null || close <= 0 || !/^\d{4,6}[A-Z]?$/.test(code)) continue;
    const v = num(r?.TradeVolume);
    out.push({ symbol: code, trade_date: d, open: num(r?.OpeningPrice), high: num(r?.HighestPrice), low: num(r?.LowestPrice), close, volume: v && v > 0 ? v : null, source: 'twse_stock_day_all' });
  }
  for (const r of Array.isArray(tpex) ? tpex : []) {
    const d = rocToIso(r?.Date); const close = num(r?.Close); const code = String(r?.SecuritiesCompanyCode ?? '').trim();
    if (!d || close == null || close <= 0 || !/^\d{4,6}[A-Z]?$/.test(code)) continue;
    const v = num(r?.TradingShares);
    out.push({ symbol: code, trade_date: d, open: num(r?.Open), high: num(r?.High), low: num(r?.Low), close, volume: v && v > 0 ? v : null, source: 'tpex_daily_close' });
  }
  return out;
}

export type RevenueInsert = { symbol: string; revenue_year: number; revenue_month: number; revenue: number; source: string };

/** 官方月營收（千元）→ 當月、上月、去年同月三列（元）。 */
export function parseOfficialMonthRevenue(rows: unknown, source: string): RevenueInsert[] {
  const out: RevenueInsert[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const ym = /^(\d{3})(\d{2})$/.exec(String(r?.['資料年月'] ?? '').trim());
    const code = String(r?.['公司代號'] ?? '').trim();
    if (!ym || !/^\d{4,6}$/.test(code)) continue;
    const y = Number(ym[1]) + 1911; const m = Number(ym[2]);
    const push = (yy: number, mm: number, v: number | null) => { if (v != null && v > 0) out.push({ symbol: code, revenue_year: yy, revenue_month: mm, revenue: v * 1000, source }); };
    push(y, m, num(r?.['營業收入-當月營收']));
    push(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, num(r?.['營業收入-上月營收']));
    push(y - 1, m, num(r?.['營業收入-去年當月營收']));
  }
  return out;
}

/** PostgREST 單次 1,000 列上限：分頁讀。 */
async function pages<T>(make: (from: number) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await make(off).range(off, off + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

export async function readPriceHistory(db: Db, symbol: string, sinceIso: string): Promise<StoredBar[]> {
  const rows = await pages<any>(() => db.from('tw_price_history').select('trade_date,open,high,low,close,volume').eq('symbol', symbol).gte('trade_date', sinceIso).order('trade_date'));
  return rows.map((r) => {
    const close = Number(r.close);
    return { date: String(r.trade_date), open: r.open != null ? Number(r.open) : close, high: r.high != null ? Number(r.high) : close, low: r.low != null ? Number(r.low) : close, close, volume: r.volume != null ? Number(r.volume) : null };
  });
}

export async function readMonthRevenue(db: Db, symbol: string, sinceYear: number): Promise<MonthRevenueRow[]> {
  const { data, error } = await db.from('tw_month_revenue').select('revenue,revenue_year,revenue_month').eq('symbol', symbol).gte('revenue_year', sinceYear).order('revenue_year').order('revenue_month');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ revenue: Number(r.revenue), revenue_year: Number(r.revenue_year), revenue_month: Number(r.revenue_month) }));
}

/** 頁面讀到缺資料時登記回補需求；已存在者不覆蓋嘗試紀錄。失敗不阻斷讀取。 */
export async function requestSymbols(db: Db, symbols: string[]): Promise<void> {
  const rows = [...new Set(symbols)].filter((s) => /^\d{4,6}[A-Z]?$/.test(s)).map((symbol) => ({ symbol }));
  if (!rows.length) return;
  try { await db.from('market_data_requests').upsert(rows, { onConflict: 'symbol', ignoreDuplicates: true }); } catch { /* ignore */ }
}

/** 回補佇列選擇：只取 pending/failed，最久未嘗試優先、代碼穩定排序。 */
export function selectBackfillQueue<T extends { symbol: string; state: string; last_attempt_at?: string | null }>(rows: T[], limit: number): string[] {
  return rows.filter((r) => r.state !== 'ready')
    .sort((a, b) => (a.last_attempt_at ?? '').localeCompare(b.last_attempt_at ?? '') || a.symbol.localeCompare(b.symbol))
    .slice(0, limit).map((r) => r.symbol);
}
