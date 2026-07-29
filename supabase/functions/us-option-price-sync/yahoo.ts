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

const UA = 'Mozilla/5.0 (compatible; LovableCheckup/1.0)';

export async function fetchYahooOptionQuote(
  underlying: string,
  expiry: string,
): Promise<YahooOptionChain> {
  const epoch = expiryToUtcEpoch(expiry);
  const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(
    underlying,
  )}?date=${epoch}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) {
    // Ensure the body is consumed to avoid Deno resource leaks.
    await res.text().catch(() => '');
    throw new Error(`yahoo_status_${res.status}`);
  }
  const payload = await res.json();
  return parseYahooOptionPayload(payload, underlying, expiry);
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
