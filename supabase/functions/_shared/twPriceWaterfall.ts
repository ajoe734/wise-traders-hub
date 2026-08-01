/**
 * 台股取價瀑布（Deno Edge Function 專用）— F1
 *
 * 對齊 `_shared/usStockPriceWaterfall.ts` 的設計：把「哪一家上游、失敗要不要換家、
 * 重試與熔斷怎麼記」全部藏進實作，對外只留兩個函式。
 *
 * 日 K（30 日 OHLC）
 *   L1 TWSE STOCK_DAY（上市）
 *   L2 TPEx tradingStock（上櫃）
 *   L3 FinMind TaiwanStockPrice（跨市場保底；需 supa 以走全域配額）
 *
 * 即時報價
 *   L1 TWSE MIS getStockInfo
 *   L2 TWSE openapi STOCK_DAY_ALL（僅收盤價，盤後/ MIS 掛掉時的降級）
 *
 * 每一層都：
 *   - 走 `fetchWithRetry`（指數退避 + Retry-After），不再有裸 fetch
 *   - 成功／失敗都寫 `data_source_health` 熔斷統計（F3），供抽屜 upstream_circuit 顯示
 */
import { fetchWithRetry, isRetryExhausted } from './retryFetch.ts';

export interface TwBar {
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type TwOhlcSource = 'twse_stock_day' | 'tpex_daily' | 'finmind_price';
export type TwQuoteSource = 'twse_mis' | 'twse_openapi';

export interface WaterfallAttempt {
  source: string;
  ok: boolean;
  bars?: number;
  reason?: string;
  latencyMs: number;
}

export interface TwOhlcResult {
  bars: TwBar[];
  source: TwOhlcSource | null;
  attempts: WaterfallAttempt[];
}

export interface TwQuoteResult {
  msgArray: Record<string, string>[];
  source: TwQuoteSource | null;
  attempts: WaterfallAttempt[];
}

interface MinimalSupa {
  from: (t: string) => any;
}

export interface WaterfallDeps {
  fetchImpl?: typeof fetch;
  /** 有帶才會記熔斷、才會啟用 FinMind 層（FinMind 需全域配額表）。 */
  supa?: MinimalSupa | null;
  now?: () => Date;
  finmindToken?: string;
  /** 測試用：覆寫熔斷寫入。 */
  recordHealth?: (source: string, ok: boolean, latencyMs: number, code?: string) => Promise<void>;
  /** 測試用：跳過 sleep。 */
  sleep?: (ms: number) => Promise<void>;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.tpex.org.tw/',
  'X-Requested-With': 'XMLHttpRequest',
};

export const MAX_BARS = 30;

/** 民國/西元日期 → ISO；無法解析回 undefined。 */
export function rocToIso(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim().replace(/\s+/g, '');
  const m = s.match(/^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return undefined;
  let y = Number(m[1]);
  if (y < 1911) y += 1911;
  return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

/** TWSE / TPEx 共用列格式：[日期, 量, 額, 開, 高, 低, 收, …] */
export function parseOhlcRow(r: unknown[]): TwBar | null {
  const num = (v: unknown) => Number(String(v).replace(/,/g, ''));
  const o = num(r[3]);
  const h = num(r[4]);
  const l = num(r[5]);
  const c = num(r[6]);
  if (![o, h, l, c].every((n) => Number.isFinite(n) && n > 0)) return null;
  return { date: rocToIso(r[0]), open: o, high: h, low: l, close: c };
}

async function health(deps: WaterfallDeps, source: string, ok: boolean, latencyMs: number, code?: string) {
  if (deps.recordHealth) {
    try { await deps.recordHealth(source, ok, latencyMs, code); } catch { /* 非致命 */ }
    return;
  }
  if (!deps.supa) return;
  try {
    const { recordCircuit } = await import('./circuitBreaker.ts');
    await recordCircuit(deps.supa as any, source, ok, latencyMs, code);
  } catch { /* 非致命 */ }
}

async function getJson(
  url: string,
  source: string,
  deps: WaterfallDeps,
): Promise<unknown | null> {
  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(url, { headers: BROWSER_HEADERS }, {
      source,
      policy: { maxAttempts: 3, baseDelayMs: 500, timeoutMs: 12_000 },
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      await health(deps, source, false, Date.now() - t0, `http_${res.status}`);
      return null;
    }
    const json = await res.json();
    await health(deps, source, true, Date.now() - t0);
    return json;
  } catch (e) {
    const code = isRetryExhausted(e) ? 'UPSTREAM_RETRY_EXHAUSTED' : 'FETCH_ERROR';
    await health(deps, source, false, Date.now() - t0, code);
    return null;
  }
}

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// ── L1: TWSE STOCK_DAY ────────────────────────────────────────────────
async function twseMonth(code: string, d: Date, deps: WaterfallDeps): Promise<TwBar[]> {
  const url =
    `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${ymd(d)}&stockNo=${encodeURIComponent(code)}`;
  const json = await getJson(url, 'twse_stock_day', deps) as any;
  const rows: unknown[][] = json?.data || [];
  return rows.map(parseOhlcRow).filter((x): x is TwBar => !!x);
}

// ── L2: TPEx tradingStock ─────────────────────────────────────────────
async function tpexMonth(code: string, d: Date, deps: WaterfallDeps): Promise<TwBar[]> {
  const roc = `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const url =
    `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?monthDate=${encodeURIComponent(roc)}` +
    `&code=${encodeURIComponent(code)}&id=&response=json&_=${(deps.now?.() ?? new Date()).getTime()}`;
  const json = await getJson(url, 'tpex_daily', deps) as any;
  let rows: unknown[][] = [];
  if (Array.isArray(json?.tables) && Array.isArray(json.tables[0]?.data)) rows = json.tables[0].data;
  else if (Array.isArray(json?.data)) rows = json.data;
  else if (Array.isArray(json?.aaData)) rows = json.aaData;
  return rows.map(parseOhlcRow).filter((x): x is TwBar => !!x);
}

// ── L3: FinMind TaiwanStockPrice ──────────────────────────────────────
async function finmindRecent(code: string, deps: WaterfallDeps): Promise<TwBar[]> {
  const token = deps.finmindToken ?? (globalThis as any).Deno?.env?.get?.('FINMIND_TOKEN') ?? '';
  const now = deps.now?.() ?? new Date();
  const start = new Date(now.getTime() - 60 * 86400_000);
  const p = new URLSearchParams({
    dataset: 'TaiwanStockPrice',
    data_id: code,
    start_date: start.toISOString().slice(0, 10),
    end_date: now.toISOString().slice(0, 10),
  });
  if (token) p.set('token', String(token));
  const json = await getJson(`https://api.finmindtrade.com/api/v4/data?${p}`, 'finmind_price', deps) as any;
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map((r) => {
      const o = Number(r.open), h = Number(r.max), l = Number(r.min), c = Number(r.close);
      if (![o, h, l, c].every((n) => Number.isFinite(n) && n > 0)) return null;
      return { date: String(r.date ?? '').slice(0, 10) || undefined, open: o, high: h, low: l, close: c };
    })
    .filter((x): x is TwBar => !!x);
}

async function withPrevMonth(
  code: string,
  deps: WaterfallDeps,
  fn: (code: string, d: Date, deps: WaterfallDeps) => Promise<TwBar[]>,
): Promise<TwBar[]> {
  const now = deps.now?.() ?? new Date();
  let bars = await fn(code, now, deps);
  if (bars.length < 2) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    bars = [...(await fn(code, prev, deps)), ...bars];
  }
  return bars;
}

/**
 * 取近 30 根日 K。任一層拿到 >= 2 根就停；全部失敗回空陣列（呼叫端可據此顯示降級）。
 * 契約：不會 throw。
 */
export async function fetchTwDailyOhlc(code: string, deps: WaterfallDeps = {}): Promise<TwOhlcResult> {
  const c = String(code ?? '').trim();
  const attempts: WaterfallAttempt[] = [];
  if (!c) return { bars: [], source: null, attempts };

  const layers: Array<{ source: TwOhlcSource; run: () => Promise<TwBar[]> }> = [
    { source: 'twse_stock_day', run: () => withPrevMonth(c, deps, twseMonth) },
    { source: 'tpex_daily', run: () => withPrevMonth(c, deps, tpexMonth) },
  ];
  // FinMind 需要全域配額表；沒有 supa 就不打，避免繞過限流。
  if (deps.supa || deps.finmindToken) {
    layers.push({ source: 'finmind_price', run: () => finmindRecent(c, deps) });
  }

  for (const layer of layers) {
    const t0 = Date.now();
    let bars: TwBar[] = [];
    try {
      bars = await layer.run();
    } catch (e) {
      attempts.push({ source: layer.source, ok: false, reason: String((e as Error)?.message ?? e).slice(0, 200), latencyMs: Date.now() - t0 });
      continue;
    }
    attempts.push({ source: layer.source, ok: bars.length >= 2, bars: bars.length, latencyMs: Date.now() - t0 });
    if (bars.length >= 2) return { bars: bars.slice(-MAX_BARS), source: layer.source, attempts };
  }
  return { bars: [], source: null, attempts };
}

// ── 即時報價瀑布 ───────────────────────────────────────────────────────

/** 同 code 出現 tse/otc 兩筆時，保留有價或有量的那筆。 */
export function dedupeMsgArray(rawArray: Record<string, string>[]): Record<string, string>[] {
  const best = new Map<string, Record<string, string>>();
  for (const item of rawArray || []) {
    if (!item?.c) continue;
    const cur = best.get(item.c);
    if (!cur) { best.set(item.c, item); continue; }
    const curZ = parseFloat(cur.z), newZ = parseFloat(item.z);
    const curV = parseInt(cur.v, 10) || 0, newV = parseInt(item.v, 10) || 0;
    if ((!isNaN(newZ) && newZ > 0 && (isNaN(curZ) || curZ <= 0)) || (newV > 0 && curV === 0)) {
      best.set(item.c, item);
    }
  }
  return Array.from(best.values());
}

/** "tse_2330.tw|otc_6274.tw" → ["2330","6274"] */
export function codesFromExCh(exCh: string): string[] {
  return String(exCh || '')
    .split('|')
    .map((s) => s.split('_')[1]?.split('.')[0]?.trim())
    .filter((s): s is string => !!s);
}

/**
 * 即時報價：L1 MIS，失敗／全空時降級到 TWSE openapi 日收盤快照（只有 z/y 欄位）。
 * 契約：不會 throw；`source === null` 代表兩層都掛。
 */
export async function fetchTwQuotes(exCh: string, deps: WaterfallDeps = {}): Promise<TwQuoteResult> {
  const attempts: WaterfallAttempt[] = [];
  const ts = (deps.now?.() ?? new Date()).getTime();

  const t0 = Date.now();
  const mis = await getJson(
    `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${ts}`,
    'twse_mis',
    deps,
  ) as any;
  const misRows = dedupeMsgArray(mis?.msgArray || []);
  attempts.push({ source: 'twse_mis', ok: misRows.length > 0, bars: misRows.length, latencyMs: Date.now() - t0 });
  if (misRows.length > 0) return { msgArray: misRows, source: 'twse_mis', attempts };

  const wanted = new Set(codesFromExCh(exCh));
  const t1 = Date.now();
  const all = await getJson(
    'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    'twse_openapi',
    deps,
  ) as any;
  const rows: any[] = Array.isArray(all) ? all : [];
  const fallback = rows
    .filter((r) => wanted.has(String(r?.Code ?? '').trim()))
    .map((r) => {
      const close = String(r.ClosingPrice ?? '').replace(/,/g, '');
      const change = Number(String(r.Change ?? '0').replace(/,/g, ''));
      const y = Number.isFinite(Number(close)) && Number.isFinite(change)
        ? String(Number(close) - change)
        : '';
      return {
        c: String(r.Code).trim(),
        n: String(r.Name ?? ''),
        z: close,
        y,
        v: String(r.TradeVolume ?? '').replace(/,/g, ''),
        o: String(r.OpeningPrice ?? '').replace(/,/g, ''),
        h: String(r.HighestPrice ?? '').replace(/,/g, ''),
        l: String(r.LowestPrice ?? '').replace(/,/g, ''),
        _src: 'twse_openapi',
      } as Record<string, string>;
    });
  attempts.push({ source: 'twse_openapi', ok: fallback.length > 0, bars: fallback.length, latencyMs: Date.now() - t1 });
  if (fallback.length > 0) return { msgArray: fallback, source: 'twse_openapi', attempts };

  return { msgArray: [], source: null, attempts };
}
