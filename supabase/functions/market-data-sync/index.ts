/**
 * market-data-sync：唯一把外部市場資料寫進資料庫的排程函式（頁面接口只讀資料庫）。
 * - mode=daily：證交所 STOCK_DAY_ALL ＋ 櫃買收盤各 1 次（全市場、不耗 FinMind）→ tw_price_history。
 * - mode=revenue：證交所／櫃買官方月營收各 1 次（全市場、不耗 FinMind）→ tw_month_revenue。
 * - mode=backfill：market_data_requests 待補代碼，每檔 FinMind 2 次（5 年日線、15 個月營收）；額度用完即停。
 * 每次執行寫 system_jobs_log（job_name=market_data_sync）。
 */
// AUTH: cron-key
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithRetry } from '../_shared/retryFetch.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { parseExchangeDaily, parseOfficialMonthRevenue, selectBackfillQueue, type PriceRowInsert, type RevenueInsert } from '../_shared/marketDataStore.ts';
import { z } from 'npm:zod@3';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; legendflow/1.0)' } };
const BIG = { maxAttempts: 2, timeoutMs: 90_000 };
const FINMIND = 'https://api.finmindtrade.com/api/v4/data';
class QuotaError extends Error {}
const isoDaysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

async function finmind<T>(dataset: string, id: string, start: string): Promise<T[]> {
  const token = Deno.env.get('FINMIND_TOKEN') || '';
  const res = await fetchWithRetry(`${FINMIND}?dataset=${dataset}&data_id=${encodeURIComponent(id)}&start_date=${start}`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : {}, { source: `finmind_${dataset}`, policy: { maxAttempts: 2 } });
  const j = await res.json().catch(() => null);
  if (j?.status === 402 || res.status === 402 || j?.status === 429 || res.status === 429) throw new QuotaError('FinMind 今日額度已用完');
  if (j?.status !== 200 || !Array.isArray(j?.data)) throw new Error(`finmind ${dataset} ${id} status=${j?.status ?? res.status}`);
  return j.data as T[];
}

async function upsertChunks(db: any, table: string, rows: unknown[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try { requireCronKey(req); } catch (e) {
    if (e instanceof AuthError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }
  const parsed = z.object({ mode: z.enum(['daily', 'revenue', 'backfill']), limit: z.number().int().min(1).max(100).optional() }).strict()
    .safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const { mode } = parsed.data;
  const limit = parsed.data.limit ?? 20;
  const db = serviceClient();
  const started = Date.now();
  const log = async (status: string, detail: Record<string, unknown>) => {
    try { await db.from('system_jobs_log').insert({ job_name: 'market_data_sync', status, detail: { mode, ...detail }, duration_ms: Date.now() - started }); } catch { /* ignore */ }
  };

  try {
    if (mode === 'daily') {
      const [tw, tp] = await Promise.all([
        fetchWithRetry('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', UA, { source: 'twse-stock-day-all', policy: BIG }).then((r) => r.json()),
        fetchWithRetry('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', UA, { source: 'tpex-daily-close', policy: BIG }).then((r) => r.json()),
      ]);
      const rows: PriceRowInsert[] = parseExchangeDaily(tw, tp);
      await upsertChunks(db, 'tw_price_history', rows, 'symbol,trade_date');
      await log(rows.length ? 'success' : 'empty', { rows: rows.length, dates: [...new Set(rows.map((r) => r.trade_date))] });
      return json({ ok: true, mode, rows: rows.length });
    }

    if (mode === 'revenue') {
      const [tw, tp] = await Promise.all([
        fetchWithRetry('https://openapi.twse.com.tw/v1/opendata/t187ap05_L', UA, { source: 'twse-month-revenue', policy: BIG }).then((r) => r.json()),
        fetchWithRetry('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O', UA, { source: 'tpex-month-revenue', policy: BIG }).then((r) => r.json()),
      ]);
      const rows: RevenueInsert[] = [...parseOfficialMonthRevenue(tw, 'twse_t187ap05'), ...parseOfficialMonthRevenue(tp, 'tpex_t187ap05')];
      const dedup = [...new Map(rows.map((r) => [`${r.symbol}:${r.revenue_year}:${r.revenue_month}`, r])).values()];
      await upsertChunks(db, 'tw_month_revenue', dedup, 'symbol,revenue_year,revenue_month');
      await log(dedup.length ? 'success' : 'empty', { rows: dedup.length });
      return json({ ok: true, mode, rows: dedup.length });
    }

    // backfill
    const { data: reqRows, error } = await db.from('market_data_requests').select('symbol,state,last_attempt_at').neq('state', 'ready').limit(1000);
    if (error) throw new Error(error.message);
    const queue = selectBackfillQueue(reqRows ?? [], limit);
    const result = { ok: 0, failed: [] as Array<{ symbol: string; reason: string }>, stoppedForQuota: false };
    for (const symbol of queue) {
      if (result.stoppedForQuota) break;
      const { data: cur } = await db.from('market_data_requests').select('attempts').eq('symbol', symbol).maybeSingle();
      await db.from('market_data_requests').update({ last_attempt_at: new Date().toISOString(), attempts: (cur?.attempts ?? 0) + 1 }).eq('symbol', symbol);
      try {
        const px = await finmind<{ date: string; open: number; max: number; min: number; close: number; Trading_Volume: number }>('TaiwanStockPrice', symbol, isoDaysAgo(5 * 365 + 10));
        const rev = await finmind<{ revenue: number; revenue_year: number; revenue_month: number }>('TaiwanStockMonthRevenue', symbol, isoDaysAgo(460)).catch((e) => { if (e instanceof QuotaError) throw e; return []; });
        const prices = px.filter((p) => Number(p.close) > 0).map((p) => ({ symbol, trade_date: p.date, open: Number(p.open) || null, high: Number(p.max) || null, low: Number(p.min) || null, close: Number(p.close), volume: Number(p.Trading_Volume) > 0 ? Number(p.Trading_Volume) : null, source: 'finmind_price' }));
        if (!prices.length) throw new Error('來源無日線資料（可能非上市櫃）');
        await upsertChunks(db, 'tw_price_history', prices, 'symbol,trade_date');
        const revRows = rev.filter((r) => Number(r.revenue) > 0).map((r) => ({ symbol, revenue_year: Number(r.revenue_year), revenue_month: Number(r.revenue_month), revenue: Number(r.revenue), source: 'finmind_month_revenue' }));
        if (revRows.length) await upsertChunks(db, 'tw_month_revenue', revRows, 'symbol,revenue_year,revenue_month');
        await db.from('market_data_requests').update({ state: 'ready', reason: `日線 ${prices.length} 根、月營收 ${revRows.length} 筆` }).eq('symbol', symbol);
        result.ok++;
      } catch (e) {
        if (e instanceof QuotaError) { result.stoppedForQuota = true; await db.from('market_data_requests').update({ reason: e.message }).eq('symbol', symbol); break; }
        const reason = e instanceof Error ? e.message : String(e);
        result.failed.push({ symbol, reason });
        await db.from('market_data_requests').update({ state: 'failed', reason }).eq('symbol', symbol);
      }
    }
    await log(result.failed.length || result.stoppedForQuota ? 'partial' : 'success', { queued: queue.length, ...result });
    return json({ ok: true, mode, queued: queue.length, ...result });
  } catch (e) {
    await log('failed', { error: String(e) });
    return json({ ok: false, error: String(e) }, 502);
  }
});
