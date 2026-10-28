import { fetchWithRetry, recordRetryFailure, RetryExhaustedError } from './retryFetch.ts';
import { nasdaqAssetClass, parseNasdaqHistory } from './usSnapshotRebuild.ts';

export async function fetchNasdaqDaily(symbol: string, from: string, through: string, supa: any) {
  const assetClass = nasdaqAssetClass(symbol);
  const url = assetClass ? `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetClass}&fromdate=${from}&todate=${through}&limit=500` : null;
  let raw = JSON.stringify({ unsupported: symbol });
  if (url) {
    try {
      const response = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' } }, { source: 'nasdaq_daily', policy: { timeoutMs: 20000 }, health: { supa } });
      if (!response.ok) throw new Error(`Nasdaq HTTP ${response.status}`);
      raw = await response.text();
    } catch (error) {
      if (error instanceof RetryExhaustedError) await recordRetryFailure(supa, error, { fn: 'nasdaq_daily', stage: 'historical_ohlcv' });
      throw error;
    }
  }
  const bytes = new TextEncoder().encode(raw);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const payload = JSON.parse(raw);
  return { bars: parseNasdaqHistory(payload, through), evidence: { source: 'nasdaq', url, sha256, fetched_at: new Date().toISOString(), price_basis: 'displayed_historical_close_not_adjclose', raw_response: payload } };
}