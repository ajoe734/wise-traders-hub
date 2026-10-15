/**
 * valuation-ps-sync：同業名單成員的每日 PS 倍數（站牌同業參考用）。
 * - mode=basis：每股營收（sps）只透過 valuation-fundamentals（peers:false）計算，與本檔站牌同口徑；
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
import universe from '../_shared/peerPsUniverse.json' with { type: 'json' };

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; legendflow/1.0)' } };
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try { requireCronKey(req); } catch (e) {
    if (e instanceof AuthError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }
  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === 'daily' ? 'daily' : 'basis';
  const limit = Math.min(Math.max(Number(body?.limit) || 60, 1), 200);
  const concurrency = Math.min(Math.max(Number(body?.concurrency) || 3, 1), 6);
  const priority: string[] = Array.isArray(body?.symbols) ? body.symbols.filter((s: unknown) => typeof s === 'string' && /^\d{4}$/.test(s)) : [];
  const db = serviceClient();
  const all: string[] = (universe as { symbols: string[] }).symbols;

  const { data: basesRaw, error: bErr } = await db.from('tw_sales_basis').select('symbol,sps,latest_period,computed_at').limit(5000);
  if (bErr) return json({ error: 'DB', message: bErr.message }, 500);
  const bases = new Map((basesRaw ?? []).map((b) => [b.symbol, { ...b, sps: Number(b.sps) } as SalesBasis]));
  const log = async (status: string, detail: Record<string, unknown>) => {
    try { await db.from('system_jobs_log').insert({ job_name: 'valuation_ps_sync', status, detail: { mode, ...detail }, duration_ms: Date.now() - started }); } catch { /* ignore */ }
  };

  if (mode === 'daily') {
    try {
      const [tw, tp] = await Promise.all([
        fetchWithRetry('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', UA, { source: 'twse-stock-day-all' }).then((r) => r.json()),
        fetchWithRetry('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', UA, { source: 'tpex-daily-close' }).then((r) => r.json()),
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
  const queue = [...new Set([...priority, ...all])].filter((s) => priority.includes(s) || needsBasisRefresh(bases.get(s), d)).slice(0, limit);
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/valuation-fundamentals`;
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const result = { ok: 0, skipped: [] as Array<{ symbol: string; reason: string }>, psRows: 0, stoppedForQuota: false };
  let idx = 0;
  const worker = async () => {
    while (idx < queue.length && !result.stoppedForQuota) {
      const symbol = queue[idx++];
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` }, body: JSON.stringify({ symbol, peers: false }) });
        const j = await r.json().catch(() => null);
        if (!j?.ok) {
          const reason = String(j?.message ?? j?.error ?? `HTTP ${r.status}`);
          if (/額度/.test(reason)) result.stoppedForQuota = true;
          result.skipped.push({ symbol, reason }); continue;
        }
        const b = j.basis;
        if (!b?.ok || !(Number(b.sps) > 0) || !b.latestPeriod) { result.skipped.push({ symbol, reason: b?.reason ?? '缺近四季每股營收' }); continue; }
        await db.from('tw_sales_basis').upsert({ symbol, sps: Number(b.sps), period: String(b.period), latest_period: b.latestPeriod, computed_at: new Date().toISOString() }, { onConflict: 'symbol' });
        const hist = (Array.isArray(j.psDaily) ? j.psDaily : []).filter((p: { ps: number }) => Number(p.ps) > 0)
          .map((p: { date: string; ps: number }) => ({ symbol, trade_date: p.date, ps: Math.round(Number(p.ps) * 10000) / 10000, source: 'valuation-fundamentals' }));
        if (hist.length) {
          const { error } = await db.from('tw_ps_daily').upsert(hist, { onConflict: 'symbol,trade_date' });
          if (!error) result.psRows += hist.length;
        }
        result.ok++;
      } catch (e) { result.skipped.push({ symbol, reason: String(e) }); }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const pending = all.filter((s) => needsBasisRefresh(bases.get(s), d)).length - result.ok;
  await log(result.stoppedForQuota ? 'failed' : 'success', { queued: queue.length, ...result, skipped: result.skipped.slice(0, 50), pending });
  return json({ ok: true, mode, queued: queue.length, ...result, pending });
});
