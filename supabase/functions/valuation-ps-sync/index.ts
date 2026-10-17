/**
 * valuation-ps-sync：同業名單成員的每日 PS 倍數（站牌同業參考用）。
 * - mode=basis：每股營收（sps）以共用純函式 computeCompanyBasis／dailyPsSeries 計算（與本檔站牌同口徑），
 *   股數 DB-first official_share_registry、缺才用 FinMind 已發行股數；
 *   順便寫入近 250 日逐日 PS。下一季申報期限過後才重算；FinMind 額度用完即停。
 * - mode=daily：證交所／櫃買全市場收盤各取一次 × 已存 sps → 當日 PS。
 * 每次執行寫 system_jobs_log（job_name=valuation_ps_sync）。純計算在 _shared/peerPsCore.ts。
 */
// AUTH: cron-key
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithRetry } from '../_shared/retryFetch.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { needsBasisRefresh, parseCloses, psRows, type SalesBasis } from '../_shared/peerPsCore.ts';
import { computeCompanyBasis, dailyPsSeries, latestOrdinaryShare, officialFromIssuedShares, type FinRow, type OfficialShares } from '../_shared/fundamentalsBasis.ts';
import universe from '../_shared/peerPsUniverse.json' with { type: 'json' };
import { discoverFilings, commitFiling, committedFiling, readFilingVersions, readSalesBases } from '../_shared/filingVersionStore.ts';
import { taipeiDate } from '../_shared/filingRefreshCore.ts';
import { z } from 'npm:zod@3';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; legendflow/1.0)' } };

const FINMIND = 'https://api.finmindtrade.com/api/v4/data';
class QuotaError extends Error {}
const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
async function finmind<T>(dataset: string, id: string, start: string): Promise<T[]> {
  const token = Deno.env.get('FINMIND_TOKEN') || '';
  const res = await fetchWithRetry(`${FINMIND}?dataset=${dataset}&data_id=${encodeURIComponent(id)}&start_date=${start}`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : {}, { source: `finmind_${dataset}`, policy: { maxAttempts: 2 } });
  const j = await res.json().catch(() => null);
  if (j?.status === 402 || res.status === 402) throw new QuotaError('財報資料來源今日額度已用完');
  if (j?.status !== 200 || !Array.isArray(j?.data)) throw new Error(`finmind ${dataset} ${id} status=${j?.status ?? res.status}`);
  return j.data as T[];
}
const today = () => taipeiDate();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try { requireCronKey(req); } catch (e) {
    if (e instanceof AuthError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }
  const started = Date.now();
  const parsed = z.object({ mode: z.enum(['daily','basis']).optional(), limit: z.number().int().min(1).max(200).optional(), concurrency: z.number().int().min(1).max(6).optional(), symbols: z.array(z.string().regex(/^\d{4,6}$/)).max(200).optional() }).strict().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const body = parsed.data;
  const mode = body?.mode === 'daily' ? 'daily' : 'basis';
  const limit = Math.min(Math.max(Number(body?.limit) || 60, 1), 200);
  const concurrency = Math.min(Math.max(Number(body?.concurrency) || 3, 1), 6);
  const priority: string[] = Array.isArray(body?.symbols) ? body.symbols.filter((s: unknown) => typeof s === 'string' && /^\d{4,6}$/.test(s)) : [];
  const db = serviceClient();
  const all: string[] = (universe as { symbols: string[] }).symbols;

  let basesRaw: Awaited<ReturnType<typeof readSalesBases>>;
  try { basesRaw = await readSalesBases(db); } catch (e) { return json({ error: 'DB', message: String(e) },500); }
  const bases = new Map((basesRaw ?? []).map((b) => [b.symbol, { ...b, sps: Number(b.sps) } as SalesBasis]));
  const log = async (status: string, detail: Record<string, unknown>) => {
    try { await db.from('system_jobs_log').insert({ job_name: 'valuation_ps_sync', status, detail: { mode, ...detail }, duration_ms: Date.now() - started }); } catch { /* ignore */ }
  };

  if (mode === 'daily') {
    try {
      // 全市場收盤是 0.3–1MB 的大檔案：預設 30 秒 abort 訊號會在「读完 body」之前就觸發，
      // 而 .json() 在重試圈外，所以只會看到一次 TimeoutError 就整批失敗。
      // 這裡把雨個來源的限時放到 90 秒、重試 2 次，讓每日 PS 不會再整日漏寫。
      const bigFile = { maxAttempts: 2, timeoutMs: 90_000 };
      const [tw, tp] = await Promise.all([
        fetchWithRetry('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', UA, { source: 'twse-stock-day-all', policy: bigFile }).then((r) => r.json()),
        fetchWithRetry('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', UA, { source: 'tpex-daily-close', policy: bigFile }).then((r) => r.json()),
      ]);

      const rows = psRows([...bases.values()], parseCloses(tw, tp)).map((r) => ({ ...r, source: 'twse-tpex-close' }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('tw_ps_daily').upsert(rows.slice(i, i + 500), { onConflict: 'symbol,trade_date' });
        if (error) throw new Error(error.message);
      }
      await log(rows.length ? 'success' : 'empty', { bases: bases.size, rows: rows.length });
      return json({ ok: true, mode, bases: bases.size, rows: rows.length });
    } catch (e) {
      await log('failed', { error: String(e) });
      return json({ ok: false, error: String(e) }, 502);
    }
  }

  const d = today();
  let discovery: Awaited<ReturnType<typeof discoverFilings>>;
  try { discovery = await discoverFilings(db); }
  catch (e) { await log('failed', { phase: 'filing_index', error: String(e) }); return json({ ok: false, error: String(e) }, 200); }
  let filingsRaw: Awaited<ReturnType<typeof readFilingVersions>>;
  try { filingsRaw = await readFilingVersions(db); }
  catch (e) { await log('failed', { phase: 'filing_queue', error: String(e) }); return json({ ok: false, error: String(e) }, 500); }
  const filings = new Map<string, typeof filingsRaw[number]>((filingsRaw ?? []).map((r) => [r.symbol,r]));
  // Only official changed/pending issuers. No blind whole-market financial polling.
  // All listed/OTC issuers get complete versions; only curated peers get daily PS.
  const candidates = (filingsRaw ?? []).filter((r) => r.state !== 'ready');
  const queue = candidates.sort((a,b) => Number(priority.includes(b.symbol)) - Number(priority.includes(a.symbol))
    || (a.last_attempt_at ?? '').localeCompare(b.last_attempt_at ?? '') || a.symbol.localeCompare(b.symbol)).slice(0,limit).map((r) => r.symbol);
  if (!queue.length) {
    await log(discovery.failures.length ? 'failed' : 'success', { discovery, queued: 0, pending: 0 });
    return json({ ok: discovery.failures.length === 0, mode, discovery, queued: 0, pending: 0 });
  }
  const { data: regRows } = await db.from('official_share_registry').select('symbol,par,par_text,issued_shares,preferred_shares,paid_in_capital,source,report_date').in('symbol', queue);
  const registry = new Map<string, OfficialShares>((regRows ?? []).map((r) => [r.symbol, {
    par: Number(r.par), parText: r.par_text ?? String(r.par), issuedShares: Number(r.issued_shares), preferredShares: Number(r.preferred_shares ?? 0),
    paidInCapital: r.paid_in_capital != null ? Number(r.paid_in_capital) : null, source: r.source as OfficialShares['source'], reportDate: r.report_date ?? '',
  }]));
  const result = { ok: 0, skipped: [] as Array<{ symbol: string; reason: string }>, psRows: 0, stoppedForQuota: false };
  let idx = 0;
  const worker = async () => {
    while (idx < queue.length && !result.stoppedForQuota) {
      const symbol = queue[idx++];
      try {
        const { error: attemptError } = await db.from('valuation_filing_versions').update({ last_attempt_at: new Date().toISOString() }).eq('symbol',symbol).eq('expected_period',filings.get(symbol)?.expected_period ?? '').eq('source',filings.get(symbol)?.source ?? '');
        if (attemptError) throw new Error(attemptError.message);
        const start = isoDaysAgo(7 * 365);
        const [fs, bs, px] = await Promise.all([
          finmind<FinRow>('TaiwanStockFinancialStatements', symbol, start),
          finmind<FinRow>('TaiwanStockBalanceSheet', symbol, start),
          finmind<{ date: string; close: number }>('TaiwanStockPrice', symbol, isoDaysAgo(400)),
        ]);
        const expected = filings.get(symbol)?.expected_period ?? null;
        const saveFiling = (sales?: { sps: number; period: string; rows: unknown[] }) => commitFiling(db,symbol,fs,bs,expected,filings.get(symbol)?.version,filings.get(symbol)?.latest_period,filings.get(symbol)?.source,sales);
        const complete = committedFiling(fs, bs, expected);
        if (!complete) throw new Error(`新季 ${expected} 損益或資產負債尚未完整`);
        let official = registry.get(symbol) ?? null;
        if (!official) {
          const sh = await finmind<{ date: string; NumberOfSharesIssued: number }>('TaiwanStockShareholding', symbol, isoDaysAgo(14)).catch(() => []);
          const last = sh.at(-1);
          official = officialFromIssuedShares(last ? Number(last.NumberOfSharesIssued) : null, latestOrdinaryShare(bs), last?.date ?? null);
        }
        const prices = px.map((p) => ({ date: p.date, close: Number(p.close) }));
        const asOf = prices.map((p) => p.date).sort().at(-1);
        if (!asOf) throw new Error('近期無收盤價');
        const b = computeCompanyBasis(symbol, complete.fs, complete.bs, asOf, { mode: 'live', official });
        if (!b.ok || !(Number(b.sps) > 0) || !b.latestPeriod) {
          // Complete filing can be committed even when share verification blocks valuation.
          await saveFiling();
          result.skipped.push({ symbol, reason: b.reason ?? '缺近四季每股營收' });
          result.ok++; continue;
        }
        if (!all.includes(symbol)) { await saveFiling(); result.ok++; continue; }
        const hist = dailyPsSeries(symbol, complete.fs, complete.bs, prices, asOf, official).filter((p) => p.ps > 0)
          .map((p) => ({ symbol, trade_date: p.date, ps: Math.round(p.ps * 10000) / 10000, source: 'finmind-basis' }));
        // Historical rows preserve historical filing deadlines. The latest close uses the new actual TTM basis.
        const latestClose = prices.find((p) => p.date === asOf)?.close;
        if (latestClose && latestClose > 0) {
          const current = { symbol, trade_date: asOf, ps: Math.round(latestClose / Number(b.sps) * 10000) / 10000, source: 'finmind-basis' };
          const pos = hist.findIndex((p) => p.trade_date === asOf);
          if (pos >= 0) hist[pos] = current; else hist.push(current);
        }
        await saveFiling({ sps: Number(b.sps), period: String(b.period), rows: hist });
        result.psRows += hist.length;
        result.ok++;
      } catch (e) {
        if (e instanceof QuotaError) result.stoppedForQuota = true;
        result.skipped.push({ symbol, reason: String((e as Error).message ?? e) });
        const { error: stateError } = await db.from('valuation_filing_versions').update({ state: 'failed', reason: String((e as Error).message ?? e) }).eq('symbol',symbol).eq('expected_period',filings.get(symbol)?.expected_period ?? '').eq('source',filings.get(symbol)?.source ?? '');
        if (stateError) result.skipped.push({ symbol, reason: `狀態寫入失敗：${stateError.message}` });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const pending = candidates.length - result.ok;
  await log(result.stoppedForQuota || result.skipped.length || discovery.failures.length ? 'failed' : 'success', { discovery, queued: queue.length, ...result, skipped: result.skipped.slice(0, 50), pending });
  return json({ ...result, ok: !result.stoppedForQuota && discovery.failures.length === 0, processed: result.ok, mode, discovery, queued: queue.length, pending });
});
