// Minimal Yahoo Finance option chain fetcher.
// Endpoint: https://query2.finance.yahoo.com/v7/finance/options/{SYMBOL}?date={epochSec}
// Returns a map keyed by OCC contractSymbol so the sync function can look up
// each leg without another API call.

export interface YahooOptionQuote {
  mark: number; // (bid+ask)/2 if both>0; else lastPrice
  bid: number | null;
  ask: number | null;
  volume: number | null;
  yesterday_close: number | null;
}

export interface YahooOptionChain {
  underlying: string;
  expiry: string;
  byOcc: Map<string, YahooOptionQuote>;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Yahoo 從 2023 起對 /v7/finance/options 要求 cookie + crumb，缺了就回 401。
// 這裡做一次性 handshake 並在同一次 function 執行內快取。
let cachedAuth: { cookie: string; crumb: string } | null = null;

async function getYahooAuth(): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedAuth) return cachedAuth;
  try {
    const res = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'manual',
    });
    await res.text().catch(() => '');
    const raw = res.headers.get('set-cookie') || '';
    const cookie = raw
      .split(/,(?=[^;]+=)/)
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
    if (!cookie) return null;
    const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Accept: '*/*', Cookie: cookie },
    });
    const crumb = (await cr.text()).trim();
    if (!cr.ok || !crumb || crumb.length > 32 || crumb.includes('<')) return null;
    cachedAuth = { cookie, crumb };
    return cachedAuth;
  } catch {
    return null;
  }
}

export async function fetchYahooOptionQuote(
  underlying: string,
  expiry: string,
): Promise<YahooOptionChain> {
  const epoch = expiryToUtcEpoch(expiry);
  const base = (host: string, crumb?: string) =>
    `https://${host}/v7/finance/options/${encodeURIComponent(underlying)}?date=${epoch}` +
    (crumb ? `&crumb=${encodeURIComponent(crumb)}` : '');

  const attempts: Array<{ url: string; cookie?: string }> = [{ url: base('query2.finance.yahoo.com') }];
  const auth = await getYahooAuth();
  if (auth) {
    attempts.unshift({ url: base('query1.finance.yahoo.com', auth.crumb), cookie: auth.cookie });
  }

  let lastStatus = 0;
  for (const attempt of attempts) {
    const res = await fetch(attempt.url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(attempt.cookie ? { Cookie: attempt.cookie } : {}),
      },
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      lastStatus = res.status;
      cachedAuth = null; // 下次重新 handshake
      continue;
    }
    const payload = await res.json();
    return parseYahooOptionPayload(payload, underlying, expiry);
  }
  throw new Error(`yahoo_status_${lastStatus || 0}`);
}


/** Pure — used by tests without network. */
export function parseYahooOptionPayload(
  payload: unknown,
  underlying: string,
  expiry: string,
): YahooOptionChain {
  const out: YahooOptionChain = { underlying, expiry, byOcc: new Map() };
  const result = (payload as { optionChain?: { result?: unknown[] } })?.optionChain?.result?.[0] as
    | { options?: Array<{ calls?: unknown[]; puts?: unknown[] }> }
    | undefined;
  const options = result?.options?.[0];
  const combined = [...(options?.calls ?? []), ...(options?.puts ?? [])];
  for (const c of combined) {
    const row = c as {
      contractSymbol?: string;
      bid?: number;
      ask?: number;
      lastPrice?: number;
      volume?: number;
      change?: number;
    };
    if (!row.contractSymbol) continue;
    const bid = Number.isFinite(row.bid) ? Number(row.bid) : null;
    const ask = Number.isFinite(row.ask) ? Number(row.ask) : null;
    const last = Number.isFinite(row.lastPrice) ? Number(row.lastPrice) : null;
    let mark: number;
    if (bid !== null && ask !== null && bid > 0 && ask > 0) {
      mark = Math.round(((bid + ask) / 2) * 100) / 100;
    } else if (last !== null && last > 0) {
      mark = last;
    } else {
      continue;
    }
    const yesterdayClose =
      last !== null && Number.isFinite(row.change) ? Math.round((last - Number(row.change)) * 100) / 100 : null;
    out.byOcc.set(row.contractSymbol, {
      mark,
      bid,
      ask,
      volume: row.volume ?? null,
      yesterday_close: yesterdayClose,
    });
  }
  return out;
}

function expiryToUtcEpoch(expiry: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!m) throw new Error('invalid_expiry');
  // Yahoo expects the option expiry midnight UTC epoch (seconds).
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000);
}
