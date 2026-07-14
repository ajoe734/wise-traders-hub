/**
 * 美股取價瀑布（Deno Edge Function 專用）
 *
 * L1: Yahoo Finance chart API（symbol 無後綴）
 * L2: Stooq CSV（symbol.us）
 *
 * 回傳格式與 TW 管線相容，供 stock-price-sync / daily-performance 共用。
 * 注意：美股沒有 10% 漲跌停，limit_up / limit_down 一律 null。
 */

export interface UsQuote {
  symbol: string;
  name: string | null;
  price: number;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  yesterday_close: number | null;
  change_value: number | null;
  change_percent: number | null;
  volume: number | null;
  source: 'yahoo' | 'stooq';
}

const YAHOO_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchYahoo(symbol: string): Promise<UsQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, Accept: 'application/json' } });
    if (!res.ok) {
      await res.text().catch(() => '');
      return null;
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;
    const price = Number(meta.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) return null;
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
    const yClose = Number.isFinite(prev) && prev > 0 ? prev : null;
    const changeValue = yClose != null ? Math.round((price - yClose) * 100) / 100 : null;
    const changePercent =
      yClose != null && yClose > 0
        ? Math.round(((price - yClose) / yClose) * 10000) / 100
        : null;
    // Try day high/low/open from last non-null bar
    const timestamps: number[] = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0];
    const opens: (number | null)[] = q?.open || [];
    const highs: (number | null)[] = q?.high || [];
    const lows: (number | null)[] = q?.low || [];
    const vols: (number | null)[] = q?.volume || [];
    let lastIdx = -1;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (Number.isFinite(highs[i] as number)) {
        lastIdx = i;
        break;
      }
    }
    const pick = (arr: (number | null)[]) => {
      if (lastIdx < 0) return null;
      const v = Number(arr[lastIdx]);
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    return {
      symbol,
      name: (meta.shortName as string) || (meta.longName as string) || null,
      price,
      open_price: pick(opens),
      high_price: pick(highs),
      low_price: pick(lows),
      yesterday_close: yClose,
      change_value: changeValue,
      change_percent: changePercent,
      volume: pick(vols),
      source: 'yahoo',
    };
  } catch {
    return null;
  }
}

async function fetchStooq(symbol: string): Promise<UsQuote | null> {
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(
      symbol.toLowerCase(),
    )}.us&i=d&f=sd2t2ohlcv`;
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
    if (!res.ok) {
      await res.text().catch(() => '');
      return null;
    }
    const text = await res.text();
    // CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const cols = lines[1].split(',');
    if (cols.length < 8) return null;
    const [, , , openS, highS, lowS, closeS, volS] = cols;
    const price = parseFloat(closeS);
    if (!Number.isFinite(price) || price <= 0) return null;
    const num = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    return {
      symbol,
      name: null,
      price,
      open_price: num(openS),
      high_price: num(highS),
      low_price: num(lowS),
      yesterday_close: null,
      change_value: null,
      change_percent: null,
      volume: num(volS),
      source: 'stooq',
    };
  } catch {
    return null;
  }
}

/** 逐檔取價（sequential 以避開 rate limit）。上層自行組 batch。 */
export async function fetchUsQuote(symbol: string): Promise<UsQuote | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  return (await fetchYahoo(sym)) || (await fetchStooq(sym));
}

export async function fetchUsQuotes(symbols: string[]): Promise<Map<string, UsQuote>> {
  const out = new Map<string, UsQuote>();
  for (const s of symbols) {
    const q = await fetchUsQuote(s);
    if (q) out.set(q.symbol, q);
    // small delay to be polite to Yahoo
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}
