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
import { parseExchangeDaily, parseOfficialMonthRevenue, parseTwseMiIndex, type PriceRowInsert, type RevenueInsert } from '../_shared/marketDataStore.ts';
import { runHistoryBackfill } from '../_shared/historyBackfillRunner.ts';
import { z } from 'npm:zod@3';
import { recordUpstreamQuota } from '../_shared/finmindUpstreamQuota.ts';

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
  await recordUpstreamQuota(serviceClient(), `finmind_${dataset}`, res);
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
  const parsed = z.object({ mode: z.enum(['daily', 'revenue', 'backfill']), limit: z.number().int().min(1).max(100).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict()
    .safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const { mode } = parsed.data;
  const limit = Math.min(40, parsed.data.limit ?? 40);
  const db = serviceClient();
  const started = Date.now();
  const log = async (status: string, detail: Record<string, unknown>) => {
    try { await db.from('system_jobs_log').insert({ job_name: 'market_data_sync', status, detail: { mode, ...detail }, duration_ms: Date.now() - started }); } catch { /* ignore */ }
  };

  try {
    if (mode === 'daily') {
      // 兩所各自取，一邊失敗不拖垮另一邊（2026-10-27 21:00 曾因單邊讀取中斷整次失敗）。
      const [twR, tpR] = await Promise.allSettled([
        fetchWithRetry('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', UA, { source: 'twse-stock-day-all', policy: BIG }).then((r) => r.json()),
        fetchWithRetry('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', UA, { source: 'tpex-daily-close', policy: BIG }).then((r) => r.json()),
      ]);
      const rows: PriceRowInsert[] = parseExchangeDaily(twR.status === 'fulfilled' ? twR.value : [], tpR.status === 'fulfilled' ? tpR.value : []);
      const maxDate = (src: string) => rows.filter((r) => r.source === src).reduce((m, r) => (r.trade_date > m ? r.trade_date : m), '');
      const tpDate = maxDate('tpex_daily_close');
      // STOCK_DAY_ALL 傍晚常仍停在前一交易日 → 以櫃買日期向 MI_INDEX 補上市當日收盤。
      // 目標日：櫃買日期，或台北平日 14:30 後的今天（櫃買取不到時也要補）。
      const tp = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
      const todayTpe = `${tp.year}-${tp.month}-${tp.day}`;
      const afterClose = !['Sat', 'Sun'].includes(tp.weekday) && Number(tp.hour) * 100 + Number(tp.minute) >= 1430;
      const target = [tpDate, afterClose ? todayTpe : '', parsed.data.date ?? ''].sort().pop() ?? '';
      let miRows = -1;
      if (target && maxDate('twse_stock_day_all') < target) {
        try {
          const mi = await fetchWithRetry(`https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${target.replace(/-/g, '')}&type=ALLBUT0999`, UA, { source: 'twse-mi-index', policy: BIG }).then((r) => r.json());
          const parsedMi = parseTwseMiIndex(mi, target);
          miRows = parsedMi.length;
          rows.push(...parsedMi);
        } catch { /* 下方 lag 檢查會警示 */ }
      }
      await upsertChunks(db, 'tw_price_history', rows, 'symbol,trade_date');
      const twDate = [maxDate('twse_stock_day_all'), maxDate('twse_mi_index')].sort().pop() ?? '';
      // 目標日證交所回 0 筆且櫃買也無該日 → 休市，不警示。
      const holiday = miRows === 0 && tpDate !== target;
      const lagging = !holiday && (twR.status === 'rejected' || tpR.status === 'rejected' || (target !== '' && (twDate < target || (tpDate !== '' && tpDate < target))));
      if (lagging) {
        await db.from('system_alerts').insert({
          kind: 'daily_close_lagging', level: 'warning',
          title: '每日收盤：上市與上櫃日期不一致或缺漏',
          message: `twse=${twDate || 'none'} tpex=${tpDate || 'none'} twse_err=${twR.status === 'rejected'} tpex_err=${tpR.status === 'rejected'}`,
        });
      }
      await log(lagging ? 'partial' : rows.length ? 'success' : 'empty', { rows: rows.length, dates: [...new Set(rows.map((r) => r.trade_date))], twse_date: twDate, tpex_date: tpDate });
      return json({ ok: true, mode, rows: rows.length, twse_date: twDate, tpex_date: tpDate });
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
    const result = await runHistoryBackfill(db, {
      prices: (symbol) => finmind('TaiwanStockPrice', symbol, isoDaysAgo(5 * 365 + 10)),
      revenue: (symbol) => finmind('TaiwanStockMonthRevenue', symbol, isoDaysAgo(460)),
      isQuota: (e) => e instanceof QuotaError,
    }, limit);
    await log(result.failed.length || result.stoppedForQuota ? 'partial' : 'success', result);
    return json({ ok: true, mode, ...result });
  } catch (e) {
    await log('failed', { error: String(e) });
    return json({ ok: false, error: String(e) }, 502);
  }
});
