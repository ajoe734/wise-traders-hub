import { fetchOfficialFilingIndex } from './officialFilingIndex.ts';
import { committedFiling } from './filingRefreshCore.ts';
export { committedFiling } from './filingRefreshCore.ts';
import type { FinRow } from './fundamentalsBasis.ts';
type FilingDatabase = { from: (table: string) => any };

/** PostgREST caps each response at 1,000 rows even with limit(10000). */
export async function readFilingVersions(db: FilingDatabase) {
  const rows: any[] = [];
  for (let offset=0; ; offset+=1000) {
    const { data, error } = await db.from('valuation_filing_versions').select('symbol,expected_period,latest_period,source,state,last_attempt_at,version').order('symbol').range(offset,offset+999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

export async function discoverFilings(db: FilingDatabase) {
  const index = await fetchOfficialFilingIndex();
  const data = await readFilingVersions(db);
  type Stored = { symbol: string; expected_period: string | null; source: string | null };
  const stored = new Map<string, Stored>(((data ?? []) as Stored[]).map((r) => [r.symbol,r]));
  const rows = index.signals.filter((r) => {
    const old = stored.get(r.symbol);
    return !old || (r.period >= (old.expected_period ?? '') && (r.period !== old.expected_period || r.signature !== old.source));
  }).map((r) => ({ symbol: r.symbol, expected_period: r.period, source: r.signature, detected_at: new Date().toISOString(), state: 'pending', reason: '官方期別已更新，等待完整財報' }));
  for (let i=0; i<rows.length; i+=500) {
    const { error: writeError } = await db.from('valuation_filing_versions').upsert(rows.slice(i,i+500), { onConflict: 'symbol' });
    if (writeError) throw new Error(writeError.message);
  }
  return { changed: rows.length, indexed: index.signals.length, failures: index.failures, successfulFeeds: index.successfulFeeds, totalFeeds: index.totalFeeds };
}

export async function commitFiling(db: FilingDatabase, symbol: string, fs: FinRow[], bs: FinRow[], expected: string | null, priorVersion?: string | null, priorPeriod?: string | null) {
  const complete = committedFiling(fs, bs, expected);
  if (!complete) throw new Error(`新季 ${expected ?? '未知'} 損益或資產負債資料尚未完整，保留待更新`);
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([complete.fs,complete.bs])));
  const version = Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2,'0')).join('');
  if (priorVersion === version && priorPeriod === expected) throw new Error('官方同季修訂已偵測，但財報來源仍回傳舊版本，保留重試');
  const { error } = await db.from('valuation_filing_versions').upsert({ symbol, latest_period: complete.latest, statements: complete.fs, balance_sheet: complete.bs,
    version, fetched_at: new Date().toISOString(), state: 'ready', reason: null }, { onConflict: 'symbol' });
  if (error) throw new Error(error.message);
  return complete;
}