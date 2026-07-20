// tw-bsr-finmind-sync
// 分層佇列 + 全域限流的 FinMind BSR 抓取器。
//
// 模式 (POST body.mode)：
//   - "worker"   從 tw_bsr_sync_queue 取工作處理（依 priority 1→2→3），呼叫上限 1500/hr。
//   - "enqueue"  依規則產生 pending 工作：
//                  priority=1 使用者持倉，最近 1 個交易日
//                  priority=2 有缺口 / >24h 未更新 / 失敗未解決
//                  priority=3 歷史回填（body.backfill_days）
//   - "manual"   直接指定 stock_ids 抓（管理員用；仍受限流檢查）
//   - "stats"    回傳監控快照（用量、queue 深度、成功率）
//
// 交易日規則：假日/週末不抓；當日 14:00 前收盤未定稿，僅補歷史（不重打當日）。
//
// FinMind Dataset: TaiwanStockTradingDailyReport（單日、單標的）

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import {
  checkRateLimit,
  fetchWithRateLimit,
  RateLimitExhaustedError,
  FINMIND_HOURLY_LIMIT,
} from '../_shared/finmindRateLimit.ts';

const FINMIND_URL = 'https://api.finmindtrade.com/api/v4/data';
const FINMIND_TOKEN = Deno.env.get('FINMIND_TOKEN') ?? '';

const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ============ 交易日 / 時間工具 ============
function taipeiNow(): Date { return new Date(Date.now() + 8 * 3600 * 1000); }
function taipeiToday(): string { return taipeiNow().toISOString().slice(0, 10); }
function rollBackToWeekday(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isWeekday(iso: string): boolean {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  return dow !== 0 && dow !== 6;
}
/** 台北時間是否已收盤（14:00 後 BSR 才有意義）*/
function isAfterClose(): boolean {
  const t = taipeiNow();
  return t.getUTCHours() >= 14; // 14:00 台北
}

// ============ FinMind fetch（走限流器）============
type FinmindRow = {
  date: string;
  securities_trader_id?: string;
  securities_trader_no?: string;
  securities_trader: string;
  price: number;
  buy: number;
  sell: number;
  stock_id: string;
};

async function fetchFinmindOneDay(stockId: string, date: string): Promise<FinmindRow[]> {
  const p = new URLSearchParams({
    dataset: 'TaiwanStockTradingDailyReport',
    data_id: stockId,
    start_date: date,
  });
  if (FINMIND_TOKEN) p.set('token', FINMIND_TOKEN);
  const res = await fetchWithRateLimit(supa, `${FINMIND_URL}?${p}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`finmind_http_${res.status}:${text.slice(0, 200)}`);
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`finmind_bad_json:${text.slice(0, 200)}`); }
  if (j?.status !== 200 && !Array.isArray(j?.data)) {
    throw new Error(`finmind_api_${j?.status ?? 'unknown'}:${String(j?.msg ?? '').slice(0, 200)}`);
  }
  return Array.isArray(j.data) ? j.data : [];
}

// ============ 聚合 & 寫入 ============
type Aggregated = {
  stock_id: string; trade_date: string; broker_id: string; broker_name: string;
  buy_shares: number; sell_shares: number; net_shares: number;
  avg_buy_price: number | null; avg_sell_price: number | null;
};
function aggregate(rows: FinmindRow[]): Aggregated[] {
  const map = new Map<string, Aggregated & { buy_amt: number; sell_amt: number }>();
  for (const r of rows) {
    const brokerId = String(r.securities_trader_id || r.securities_trader_no || '').trim();
    if (!brokerId) continue;
    const key = `${r.stock_id}|${r.date}|${brokerId}`;
    const buy = Number(r.buy || 0), sell = Number(r.sell || 0), price = Number(r.price || 0);
    let cur = map.get(key);
    if (!cur) {
      cur = {
        stock_id: r.stock_id, trade_date: r.date, broker_id: brokerId,
        broker_name: r.securities_trader || brokerId,
        buy_shares: 0, sell_shares: 0, net_shares: 0,
        avg_buy_price: null, avg_sell_price: null, buy_amt: 0, sell_amt: 0,
      };
      map.set(key, cur);
    }
    cur.buy_shares += buy; cur.sell_shares += sell;
    cur.buy_amt += buy * price; cur.sell_amt += sell * price;
  }
  const out: Aggregated[] = [];
  for (const v of map.values()) {
    v.net_shares = v.buy_shares - v.sell_shares;
    v.avg_buy_price = v.buy_shares > 0 ? +(v.buy_amt / v.buy_shares).toFixed(4) : null;
    v.avg_sell_price = v.sell_shares > 0 ? +(v.sell_amt / v.sell_shares).toFixed(4) : null;
    const { buy_amt: _b, sell_amt: _s, ...rest } = v as any;
    out.push(rest);
  }
  return out;
}

async function rebuildRollup(stockId: string, asOf: string) {
  const since = addDays(asOf, -90);
  const { data: bsrRows } = await supa
    .from('tw_bsr_daily')
    .select('trade_date, broker_id, broker_name, net_shares, buy_shares, sell_shares')
    .eq('stock_id', stockId).gte('trade_date', since).lte('trade_date', asOf)
    .order('trade_date', { ascending: false });
  const uniqueDates = Array.from(new Set((bsrRows || []).map((r: any) => r.trade_date)))
    .sort((a, b) => (a < b ? 1 : -1));
  for (const win of [5, 20, 60] as const) {
    const dates = new Set(uniqueDates.slice(0, win));
    const slice = (bsrRows || []).filter((r: any) => dates.has(r.trade_date));
    if (slice.length === 0) continue;
    const agg = new Map<string, { name: string; net: number; buy: number; sell: number }>();
    for (const r of slice) {
      const cur = agg.get(r.broker_id) || { name: r.broker_name, net: 0, buy: 0, sell: 0 };
      cur.net += Number(r.net_shares || 0);
      cur.buy += Number(r.buy_shares || 0);
      cur.sell += Number(r.sell_shares || 0);
      agg.set(r.broker_id, cur);
    }
    const list = Array.from(agg.entries()).map(([broker_id, v]) => ({ broker_id, ...v }));
    const topBuy = [...list].sort((a, b) => b.net - a.net).slice(0, 3)
      .map((b) => ({ broker_id: b.broker_id, name: b.name, net: b.net }));
    const topSell = [...list].sort((a, b) => a.net - b.net).slice(0, 3)
      .map((b) => ({ broker_id: b.broker_id, name: b.name, net: b.net }));
    const totalBuy = list.reduce((s, b) => s + b.buy, 0);
    const top15Buy = [...list].sort((a, b) => b.buy - a.buy).slice(0, 15).reduce((s, b) => s + b.buy, 0);
    const concentration = totalBuy > 0 ? (top15Buy / totalBuy) * 100 : null;
    await supa.from('tw_chips_rollup').upsert({
      stock_id: stockId, as_of_date: asOf, window_days: win,
      foreign_net: 0, trust_net: 0, dealer_net: 0,
      top_buy_brokers: topBuy, top_sell_brokers: topSell,
      concentration_ratio: concentration, bsr_available: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stock_id,as_of_date,window_days' });
  }
}

// ============ 去重檢查（存在且完整不重打）============
async function isDoneAlready(stockId: string, date: string): Promise<boolean> {
  const { count } = await supa.from('tw_bsr_daily')
    .select('id', { count: 'exact', head: true })
    .eq('stock_id', stockId).eq('trade_date', date);
  // 有 broker >= 5 筆即視為完整
  return (count ?? 0) >= 5;
}

// ============ 單檔處理 ============
async function processStock(stockId: string, date: string): Promise<{
  ok: boolean; rows: number; note?: string; error?: string; rateLimited?: boolean;
}> {
  if (await isDoneAlready(stockId, date)) return { ok: true, rows: 0, note: 'already_done' };
  try {
    const rows = await fetchFinmindOneDay(stockId, date);
    if (rows.length === 0) return { ok: true, rows: 0, note: 'finmind_empty' };
    const agg = aggregate(rows);
    if (agg.length === 0) return { ok: true, rows: 0, note: 'aggregated_empty' };
    const CHUNK = 500;
    for (let i = 0; i < agg.length; i += CHUNK) {
      const { error } = await supa.from('tw_bsr_daily')
        .upsert(agg.slice(i, i + CHUNK), { onConflict: 'stock_id,trade_date,broker_id' });
      if (error) throw new Error(`upsert_failed:${error.message}`);
    }
    await supa.from('tw_bsr_fetch_failures')
      .update({ resolved_at: new Date().toISOString(), last_error_message: null })
      .eq('stock_id', stockId).eq('trade_date', date).is('resolved_at', null);
    await rebuildRollup(stockId, date);
    return { ok: true, rows: agg.length };
  } catch (e) {
    if (e instanceof RateLimitExhaustedError) {
      return { ok: false, rows: 0, error: e.message, rateLimited: true };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, rows: 0, error: msg };
  }
}

// ============ ENQUEUE：三層優先級 ============
async function enqueueTier1Holdings(date: string): Promise<number> {
  // 使用者未平倉 + watchlist（若表存在）
  const { data: openTrades } = await supa
    .from('trade_records').select('stock_symbol').is('close_date', null).limit(5000);
  const ids = Array.from(new Set((openTrades || [])
    .map((r: any) => String(r.stock_symbol || '').trim())
    .filter((s: string) => /^[0-9]{4,6}$/.test(s))));
  if (ids.length === 0) return 0;
  return await enqueueBatch(ids, date, 1, 'tier1_holdings');
}

async function enqueueTier2Gaps(date: string): Promise<number> {
  // (a) tw_institutional_daily 有但 tw_bsr_daily 沒有的近 3 個交易日
  const dates = [date, rollBackToWeekday(addDays(date, -1)), rollBackToWeekday(addDays(date, -2))];
  const gapIds = new Set<string>();
  for (const d of dates) {
    const { data: inst } = await supa.from('tw_institutional_daily')
      .select('stock_id').eq('trade_date', d).limit(1500);
    const instIds = (inst || []).map((r: any) => String(r.stock_id));
    if (instIds.length === 0) continue;
    const { data: done } = await supa.from('tw_bsr_daily')
      .select('stock_id').eq('trade_date', d).in('stock_id', instIds);
    const doneSet = new Set((done || []).map((r: any) => r.stock_id));
    for (const id of instIds) if (!doneSet.has(id) && /^[0-9]{4,6}$/.test(id)) gapIds.add(id);
  }
  // (b) 失敗未解決
  const { data: failed } = await supa.from('tw_bsr_fetch_failures')
    .select('stock_id').is('resolved_at', null)
    .gte('trade_date', addDays(date, -7)).limit(500);
  for (const r of failed || []) if (/^[0-9]{4,6}$/.test(String(r.stock_id))) gapIds.add(String(r.stock_id));
  if (gapIds.size === 0) return 0;
  return await enqueueBatch(Array.from(gapIds), date, 2, 'tier2_gaps');
}

async function enqueueTier3Backfill(endDate: string, days: number): Promise<number> {
  // 對持倉股回填歷史 days 天
  const { data: openTrades } = await supa
    .from('trade_records').select('stock_symbol').is('close_date', null).limit(2000);
  const ids = Array.from(new Set((openTrades || [])
    .map((r: any) => String(r.stock_symbol || '').trim())
    .filter((s: string) => /^[0-9]{4,6}$/.test(s))));
  let total = 0;
  for (let i = 1; i <= days; i++) {
    const d = rollBackToWeekday(addDays(endDate, -i));
    total += await enqueueBatch(ids, d, 3, 'tier3_backfill');
  }
  return total;
}

async function enqueueBatch(stockIds: string[], date: string, priority: number, tag: string): Promise<number> {
  if (stockIds.length === 0 || !isWeekday(date)) return 0;
  // 過濾已完成的
  const { data: done } = await supa.from('tw_bsr_daily')
    .select('stock_id').eq('trade_date', date).in('stock_id', stockIds);
  const doneSet = new Set((done || []).map((r: any) => r.stock_id));
  const targets = stockIds.filter((id) => !doneSet.has(id));
  if (targets.length === 0) return 0;
  const rows = targets.map((id) => ({
    stock_id: id, trade_date: date, priority, status: 'pending',
    next_run_at: new Date().toISOString(), enqueued_by: tag,
  }));
  // ON CONFLICT DO NOTHING via unique partial index — Supabase upsert can't target partial index,
  // so 用手動 filter：先查有無 pending/running，再 insert
  const { data: existing } = await supa.from('tw_bsr_sync_queue')
    .select('stock_id, trade_date')
    .in('stock_id', targets).eq('trade_date', date)
    .in('status', ['pending', 'running']);
  const existSet = new Set((existing || []).map((r: any) => `${r.stock_id}|${r.trade_date}`));
  const toInsert = rows.filter((r) => !existSet.has(`${r.stock_id}|${r.trade_date}`));
  if (toInsert.length === 0) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const { error, count } = await supa.from('tw_bsr_sync_queue')
      .insert(toInsert.slice(i, i + CHUNK), { count: 'exact' });
    if (error) console.warn(`enqueue insert error: ${error.message}`);
    else inserted += count ?? toInsert.slice(i, i + CHUNK).length;
  }
  return inserted;
}

// ============ WORKER ============
async function runWorker(batch: number, maxPriority: number, budgetMs: number): Promise<any> {
  const started = Date.now();
  const results: any[] = [];
  let processed = 0, ok = 0, rateLimitedStop = false;

  // 先看還剩多少配額，超過就 cap batch 大小
  const rl = await checkRateLimit(supa);
  if (!rl.allowed) {
    return { ok: true, note: 'rate_limit_exhausted', rate_limit: rl, processed: 0 };
  }
  const effectiveBatch = Math.min(batch, Math.max(1, rl.remaining));

  const { data: jobs, error } = await supa.rpc('claim_bsr_queue_jobs', {
    _batch: effectiveBatch, _max_priority: maxPriority,
  });
  if (error) return { ok: false, error: `claim_failed:${error.message}` };
  if (!jobs || jobs.length === 0) return { ok: true, note: 'no_jobs', rate_limit: rl, processed: 0 };

  // 併發 3；每筆處理完檢查預算與限流
  const CONCURRENCY = 3;
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      if (Date.now() - started > budgetMs) return;
      if (rateLimitedStop) return;
      const my = idx++;
      const job = jobs[my];
      const t0 = Date.now();
      const r = await processStock(job.stock_id, job.trade_date);
      processed++;
      if (r.ok) ok++;
      results.push({ id: job.id, stock_id: job.stock_id, date: job.trade_date, priority: job.priority, ms: Date.now() - t0, ...r });
      // 更新 queue row
      if (r.ok) {
        await supa.from('tw_bsr_sync_queue').update({
          status: r.note === 'finmind_empty' && !isAfterClose() ? 'pending' : 'done',
          finished_at: new Date().toISOString(),
          last_success_at: r.rows > 0 ? new Date().toISOString() : undefined,
          last_error: null,
          next_run_at: r.note === 'finmind_empty' && !isAfterClose()
            ? new Date(Date.now() + 30 * 60_000).toISOString() : undefined,
        }).eq('id', job.id);
      } else {
        // 失敗：指數退避 next_run_at；attempts >= max 標 failed
        const nextAttempts = (job.attempts ?? 1);
        const backoffMin = Math.min(120, Math.pow(2, nextAttempts) * 5);
        const shouldFail = nextAttempts >= (job.max_attempts ?? 5);
        await supa.from('tw_bsr_sync_queue').update({
          status: shouldFail ? 'failed' : 'pending',
          finished_at: shouldFail ? new Date().toISOString() : null,
          last_error: r.error?.slice(0, 500) ?? null,
          next_run_at: shouldFail ? undefined : new Date(Date.now() + backoffMin * 60_000).toISOString(),
          started_at: null,
        }).eq('id', job.id);
        // 若是限流，剩下的都停手
        if (r.rateLimited) { rateLimitedStop = true; return; }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  const finalRl = await checkRateLimit(supa);
  return {
    ok: true, processed, success: ok,
    claimed: jobs.length, batch: effectiveBatch,
    rate_limit_before: rl, rate_limit_after: finalRl,
    stopped_by_rate_limit: rateLimitedStop,
    elapsed_ms: Date.now() - started,
    results,
  };
}

// ============ STATS ============
async function runStats() {
  const rl = await checkRateLimit(supa);
  // 每小時用量 24 小時分布
  const { data: usage } = await supa.from('tw_bsr_api_usage')
    .select('bucket_start, call_count, success_count, error_count, rate_limited_count')
    .gte('bucket_start', new Date(Date.now() - 24 * 3600_000).toISOString())
    .order('bucket_start', { ascending: false });
  const hourly: Record<string, any> = {};
  for (const r of usage || []) {
    const hr = String(r.bucket_start).slice(0, 13) + ':00';
    if (!hourly[hr]) hourly[hr] = { calls: 0, success: 0, error: 0, r429: 0 };
    hourly[hr].calls += r.call_count;
    hourly[hr].success += r.success_count;
    hourly[hr].error += r.error_count;
    hourly[hr].r429 += r.rate_limited_count;
  }
  // queue 深度
  const { data: depth } = await supa.from('tw_bsr_sync_queue')
    .select('priority, status').in('status', ['pending', 'running']).limit(10000);
  const queue: Record<string, Record<string, number>> = {};
  for (const r of depth || []) {
    const k = `p${r.priority}`;
    queue[k] = queue[k] || { pending: 0, running: 0 };
    queue[k][r.status] = (queue[k][r.status] || 0) + 1;
  }
  // 最近 24h 成功率
  const total24 = (usage || []).reduce((s, r) => s + r.call_count, 0);
  const err24 = (usage || []).reduce((s, r) => s + r.error_count, 0);
  const r429_24 = (usage || []).reduce((s, r) => s + r.rate_limited_count, 0);
  // 各優先級延遲（enqueued → finished）
  const { data: latencies } = await supa.from('tw_bsr_sync_queue')
    .select('priority, enqueued_at, finished_at')
    .eq('status', 'done').not('finished_at', 'is', null)
    .gte('finished_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    .limit(2000);
  const latByP: Record<string, number[]> = {};
  for (const r of latencies || []) {
    const p = `p${r.priority}`;
    const ms = new Date(r.finished_at!).getTime() - new Date(r.enqueued_at).getTime();
    (latByP[p] = latByP[p] || []).push(ms);
  }
  const latSummary: Record<string, any> = {};
  for (const [p, arr] of Object.entries(latByP)) {
    arr.sort((a, b) => a - b);
    latSummary[p] = {
      count: arr.length,
      p50_ms: arr[Math.floor(arr.length * 0.5)],
      p95_ms: arr[Math.floor(arr.length * 0.95)],
      max_ms: arr[arr.length - 1],
    };
  }
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    rate_limit: rl,
    limit_config: { hourly_limit: FINMIND_HOURLY_LIMIT },
    queue_depth: queue,
    last_24h: {
      total_calls: total24, errors: err24, r429: r429_24,
      success_rate: total24 > 0 ? +((1 - err24 / total24) * 100).toFixed(2) : null,
    },
    hourly_last_24h: hourly,
    queue_latency_ms: latSummary,
  };
}

// ============ HTTP entry ============
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const mode = String(body?.mode || 'worker');

    if (mode === 'stats') return json(await runStats());

    if (mode === 'enqueue') {
      const date = rollBackToWeekday(String(body?.date || taipeiToday()));
      const tiers: Record<string, number> = {};
      const doTier1 = body?.tier1 !== false;
      const doTier2 = body?.tier2 !== false;
      const doTier3 = body?.tier3 === true;
      const backfillDays = Math.max(1, Math.min(30, Number(body?.backfill_days ?? 5)));
      if (doTier1) tiers.tier1 = await enqueueTier1Holdings(date);
      if (doTier2) tiers.tier2 = await enqueueTier2Gaps(date);
      if (doTier3) tiers.tier3 = await enqueueTier3Backfill(date, backfillDays);
      return json({ ok: true, mode, date, enqueued: tiers });
    }

    if (mode === 'worker') {
      const batch = Math.max(1, Math.min(100, Number(body?.batch ?? 30)));
      const maxPriority = Math.max(1, Math.min(3, Number(body?.max_priority ?? 3)));
      const budgetMs = Math.max(5_000, Math.min(120_000, Number(body?.budget_ms ?? 45_000)));
      return json(await runWorker(batch, maxPriority, budgetMs));
    }

    if (mode === 'manual') {
      const date = rollBackToWeekday(String(body?.date || taipeiToday()));
      const ids: string[] = Array.isArray(body?.stock_ids)
        ? body.stock_ids.map((s: any) => String(s).trim()).filter((s: string) => /^[0-9]{4,6}$/.test(s))
        : [];
      if (ids.length === 0) return json({ ok: false, error: 'stock_ids required' }, 400);
      const rl = await checkRateLimit(supa);
      if (!rl.allowed) return json({ ok: false, error: 'rate_limit_exhausted', rate_limit: rl }, 429);
      // 直接處理（不入 queue）
      const results = [];
      for (const id of ids.slice(0, Math.min(20, rl.remaining))) {
        results.push({ stock_id: id, ...(await processStock(id, date)) });
      }
      return json({ ok: true, mode, date, results, rate_limit_after: await checkRateLimit(supa) });
    }

    return json({ ok: false, error: `unknown mode: ${mode}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('tw-bsr-finmind-sync fatal:', msg);
    return json({ ok: false, error: msg }, 500);
  }
});
