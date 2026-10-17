import { fetchOfficialFilingIndex } from './officialFilingIndex.ts';
import { committedFiling } from './filingRefreshCore.ts';
export { committedFiling } from './filingRefreshCore.ts';
import type { FinRow } from './fundamentalsBasis.ts';
type FilingDatabase = { from: (table: string) => any; rpc?: (name: string, args: Record<string, unknown>) => any };

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

/** 佇列選擇：排除 ready；failed 與 pending 都重試；優先名單先排；最久未嘗試者優先；同時間以代碼穩定排序。 */
export function selectFilingQueue<T extends { symbol: string; state: string; last_attempt_at?: string | null }>(filings: T[], priority: string[], limit: number): string[] {
  return filings.filter((r) => r.state !== 'ready')
    .sort((a, b) => Number(priority.includes(b.symbol)) - Number(priority.includes(a.symbol))
      || (a.last_attempt_at ?? '').localeCompare(b.last_attempt_at ?? '') || a.symbol.localeCompare(b.symbol))
    .slice(0, limit).map((r) => r.symbol);
}

/** 嘗試／失敗標記一律以代碼＋期別＋來源三重守衛，避免蓋掉執行期間剛偵測到的新財報版本。 */
export async function updateFilingState(db: FilingDatabase, filing: { symbol: string; expected_period: string | null; source: string | null }, patch: Record<string, unknown>) {
  const { error } = await db.from('valuation_filing_versions').update(patch)
    .eq('symbol', filing.symbol).eq('expected_period', filing.expected_period ?? '').eq('source', filing.source ?? '');
  if (error) throw new Error(error.message);
}

export async function discoverFilings(db: FilingDatabase) {
  const index = await fetchOfficialFilingIndex();
  if (index.failures.length) throw new Error(`官方索引來源未齊：${index.failures.join('; ')}`);
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

export async function commitFiling(db: FilingDatabase, symbol: string, fs: FinRow[], bs: FinRow[], expected: string | null, priorVersion?: string | null, priorPeriod?: string | null, source?: string | null, sales?: { sps: number; period: string; rows: unknown[] }) {
  const complete = committedFiling(fs, bs, expected);
  if (!complete) throw new Error(`新季 ${expected ?? '未知'} 損益或資產負債資料尚未完整，保留待更新`);
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([complete.fs,complete.bs].map((rows) => rows.filter((r) => r.date === expected).map((r) => [r.type,Number(r.value),r.origin_name ?? '']).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))))));
  const version = Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2,'0')).join('');
  if (priorVersion === version && priorPeriod === expected) throw new Error('官方同季修訂已偵測，但財報來源仍回傳舊版本，保留重試');
  if (!db.rpc || !expected || !source) throw new Error('缺財報版本提交識別');
  const { data, error } = await db.rpc('commit_valuation_filing', {
    _symbol: symbol, _expected: expected, _source: source, _latest: complete.latest,
    _statements: complete.fs, _balance_sheet: complete.bs, _version: version,
    _sps: sales?.sps ?? null, _period: sales?.period ?? null, _ps_rows: sales?.rows ?? [],
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error('官方版本已更新或上游仍舊版，保留重試');
  return complete;
}

export async function readSalesBases(db: FilingDatabase) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('tw_sales_basis').select('symbol,sps,latest_period,computed_at').eq('eligible',true).order('symbol').range(offset,offset+999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}
