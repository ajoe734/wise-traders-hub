import { fetchWithRetry } from './retryFetch.ts';

export const FILING_SECTORS = ['ci', 'basi', 'ins', 'bd', 'fh', 'mim'] as const;
export const FILING_FEEDS = ['TWSE', 'TPEx'].flatMap((market) => FILING_SECTORS.flatMap((sector) => ['06', '07'].map((statement) => ({
  market, sector, statement,
  url: market === 'TWSE' ? `https://openapi.twse.com.tw/v1/opendata/t187ap${statement}_L_${sector}`
    : `https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap${statement}_O_${sector}`,
}))));
export type FilingSignal = { symbol: string; period: string; signature: string };

export function parseFilingRows(raw: unknown): Array<{ symbol: string; period: string; content: string }> {
  if (!Array.isArray(raw)) throw new Error('官方財報索引格式非陣列');
  const out = [];
  for (const row of raw) {
    const symbol = String(row?.['公司代號'] ?? row?.SecuritiesCompanyCode ?? '').trim();
    if (!symbol) continue; // official blank placeholders are not issuers
    const year = Number(row?.['年度'] ?? row?.Year);
    const quarter = Number(row?.['季別'] ?? row?.Season);
    if (!/^\d{4,6}$/.test(symbol) || !Number.isInteger(year) || year < 90 || ![1, 2, 3, 4].includes(quarter)) throw new Error('官方財報索引識別欄位異常');
    const yyyy = year < 1911 ? year + 1911 : year;
    const suffix = ['03-31','06-30','09-30','12-31'][quarter - 1];
    // Output date changes every day; NOT a filing revision or announcement timestamp.
    const content = JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !['Date','出表日期'].includes(k)).sort(([a],[b]) => a.localeCompare(b))));
    out.push({ symbol, period: `${yyyy}-${suffix}`, content });
  }
  return out;
}

export async function collectFilingSignals(feeds: Array<{ statement: string; rows: unknown }>): Promise<FilingSignal[]> {
  const grouped = new Map<string, { symbol: string; period: string; statements: Set<string>; content: string[] }>();
  for (const feed of feeds) for (const r of parseFilingRows(feed.rows)) {
    const key = `${r.symbol}:${r.period}`;
    const g = grouped.get(key) ?? { symbol: r.symbol, period: r.period, statements: new Set<string>(), content: [] };
    g.statements.add(feed.statement); g.content.push(r.content); grouped.set(key,g);
  }
  const signals: FilingSignal[] = [];
  for (const g of grouped.values()) {
    if (!g.statements.has('06') || !g.statements.has('07')) continue;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(g.content.sort().join('\n')));
    signals.push({ symbol: g.symbol, period: g.period, signature: Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2,'0')).join('') });
  }
  const latest = new Map<string, FilingSignal>();
  for (const r of signals) if (!latest.has(r.symbol) || (latest.get(r.symbol)?.period ?? '') < r.period) latest.set(r.symbol,r);
  return [...latest.values()];
}

export async function fetchOfficialFilingIndex() {
  const feeds: Array<{ statement: string; rows: unknown }> = [];
  const failures: string[] = [];
  const queue = [...FILING_FEEDS];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const feed = queue.shift(); if (!feed) break;
      try {
        const response = await fetchWithRetry(feed.url, {}, { source: `filing-index-${feed.market}-${feed.sector}-${feed.statement}`, policy: { maxAttempts: 2, timeoutMs: 20000 } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rows = await response.json(); parseFilingRows(rows);
        feeds.push({ statement: feed.statement, rows });
      } catch (e) { failures.push(`${feed.market}/${feed.sector}/${feed.statement}: ${String(e)}`); }
    }
  }));
  return { signals: await collectFilingSignals(feeds), failures, successfulFeeds: feeds.length, totalFeeds: FILING_FEEDS.length };
}