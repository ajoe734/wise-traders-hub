// tw-bsr-finmind-sync
// 用 FinMind API 抓分點（BSR）→ 寫入 tw_bsr_daily → 重算 tw_chips_rollup
// 取代原本走 TWSE OCR 的 tw-bsr-daily-sync（該路徑實務上 CAPTCHA 識別率過低，
// tw_bsr_daily 長期為 0 筆）。
//
// POST body:
//   { stock_ids?: string[], date?: "YYYY-MM-DD", lookback?: number, mode?: "manual"|"queue" }
//   - stock_ids 指定則只抓這些；否則由 buildQueue 從真人未平倉持倉 + 三大法人熱門股中挑
//   - date 預設今天（若非交易日則回滾到最近工作日）
//   - lookback 預設 1（=只抓 date 當天）；手動回填時可設 5/7
//
// FinMind Dataset: TaiwanStockTradingDailyReport
//   欄位：date, securities_trader_no, securities_trader, price, buy, sell, stock_id
//   單位：buy/sell 已是股數（不是張）。

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const FINMIND_URL = 'https://api.finmindtrade.com/api/v4/data';
const FINMIND_TOKEN = Deno.env.get('FINMIND_TOKEN') ?? '';

const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function taipeiToday(): string {
  const now = new Date();
  const tpe = new Date(now.getTime() + 8 * 3600 * 1000);
  return tpe.toISOString().slice(0, 10);
}
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

async function fetchFinmind(stockId: string, startDate: string, endDate: string): Promise<FinmindRow[]> {
  const p = new URLSearchParams({
    dataset: 'TaiwanStockTradingDailyReport',
    data_id: stockId,
    start_date: startDate,
    end_date: endDate,
  });
  if (FINMIND_TOKEN) p.set('token', FINMIND_TOKEN);
  const res = await fetch(`${FINMIND_URL}?${p}`, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`finmind_http_${res.status}:${text.slice(0, 200)}`);
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`finmind_bad_json:${text.slice(0, 200)}`); }
  if (j?.status !== 200 && !Array.isArray(j?.data)) {
    throw new Error(`finmind_api_${j?.status ?? 'unknown'}:${String(j?.msg ?? '').slice(0, 200)}`);
  }
  return Array.isArray(j.data) ? j.data : [];
}

// 把 FinMind 的 per-trade 明細（同一分點同一日可能多筆不同價格）
// 聚合成 tw_bsr_daily 的 broker-per-day 一筆。
type Aggregated = {
  stock_id: string;
  trade_date: string;
  broker_id: string;
  broker_name: string;
  buy_shares: number;
  sell_shares: number;
  net_shares: number;
  avg_buy_price: number | null;
  avg_sell_price: number | null;
};
function aggregate(rows: FinmindRow[]): Aggregated[] {
  const map = new Map<string, Aggregated & { buy_amt: number; sell_amt: number }>();
  for (const r of rows) {
    const brokerId = String(r.securities_trader_id || r.securities_trader_no || '').trim();
    if (!brokerId) continue;
    const key = `${r.stock_id}|${r.date}|${brokerId}`;
    const buy = Number(r.buy || 0);
    const sell = Number(r.sell || 0);
    const price = Number(r.price || 0);
    let cur = map.get(key);
    if (!cur) {
      cur = {
        stock_id: r.stock_id,
        trade_date: r.date,
        broker_id: brokerId,
        broker_name: r.securities_trader || brokerId,
        buy_shares: 0, sell_shares: 0, net_shares: 0,
        avg_buy_price: null, avg_sell_price: null,
        buy_amt: 0, sell_amt: 0,
      };
      map.set(key, cur);
    }
    cur.buy_shares += buy;
    cur.sell_shares += sell;
    cur.buy_amt += buy * price;
    cur.sell_amt += sell * price;
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
  const since = new Date(asOf + 'T00:00:00Z');
  since.setUTCDate(since.getUTCDate() - 90);
  const { data: bsrRows } = await supa
    .from('tw_bsr_daily')
    .select('trade_date, broker_id, broker_name, net_shares, buy_shares, sell_shares')
    .eq('stock_id', stockId)
    .gte('trade_date', since.toISOString().slice(0, 10))
    .lte('trade_date', asOf)
    .order('trade_date', { ascending: false });

  const uniqueDates = Array.from(new Set((bsrRows || []).map((r: any) => r.trade_date))).sort((a, b) => (a < b ? 1 : -1));
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
    const list = Array.from(agg.entries()).map(([broker_id, v]) => ({ broker_id, name: v.name, net: v.net, buy: v.buy, sell: v.sell }));
    const topBuy = [...list].sort((a, b) => b.net - a.net).slice(0, 3).map((b) => ({ broker_id: b.broker_id, name: b.name, net: b.net }));
    const topSell = [...list].sort((a, b) => a.net - b.net).slice(0, 3).map((b) => ({ broker_id: b.broker_id, name: b.name, net: b.net }));
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

async function buildQueue(batch: number, tradeDate: string): Promise<string[]> {
  // 排除當天已有資料的
  const { data: done } = await supa.from('tw_bsr_daily').select('stock_id').eq('trade_date', tradeDate);
  const doneSet = new Set((done || []).map((r: any) => r.stock_id));

  // 1) 真人未平倉持倉
  const { data: openTrades } = await supa
    .from('trade_records').select('stock_symbol').is('close_date', null).limit(2000);
  const p1 = Array.from(new Set((openTrades || [])
    .map((r: any) => String(r.stock_symbol || '').trim())
    .filter((s: string) => /^[0-9]{4,6}$/.test(s))));

  // 2) 近 7 天有三大法人的熱門股
  const { data: inst } = await supa
    .from('tw_institutional_daily').select('stock_id')
    .gte('trade_date', addDays(tradeDate, -7))
    .order('trade_date', { ascending: false }).limit(1500);
  const seen = new Set<string>();
  const p2: string[] = [];
  for (const r of inst || []) {
    const id = String(r.stock_id || '').trim();
    if (!/^[0-9]{4,6}$/.test(id) || seen.has(id)) continue;
    seen.add(id); p2.push(id);
  }

  const out: string[] = [];
  const pushed = new Set<string>();
  for (const src of [p1, p2]) {
    for (const id of src) {
      if (pushed.has(id) || doneSet.has(id)) continue;
      pushed.add(id); out.push(id);
      if (out.length >= batch) return out;
    }
  }
  return out;
}

async function processStock(stockId: string, startDate: string, endDate: string) {
  const rows = await fetchFinmind(stockId, startDate, endDate);
  if (rows.length === 0) {
    return { stock_id: stockId, ok: true, rows: 0, note: 'finmind_empty' };
  }
  const agg = aggregate(rows);
  if (agg.length === 0) return { stock_id: stockId, ok: true, rows: 0, note: 'aggregated_empty' };

  // 批次 upsert
  const CHUNK = 500;
  for (let i = 0; i < agg.length; i += CHUNK) {
    const { error } = await supa
      .from('tw_bsr_daily')
      .upsert(agg.slice(i, i + CHUNK), { onConflict: 'stock_id,trade_date,broker_id' });
    if (error) throw new Error(`upsert_failed:${error.message}`);
  }

  // 解決失敗記錄
  const dates = Array.from(new Set(agg.map((r) => r.trade_date)));
  await supa.from('tw_bsr_fetch_failures')
    .update({ resolved_at: new Date().toISOString(), last_error_message: null })
    .eq('stock_id', stockId).in('trade_date', dates).is('resolved_at', null);

  // 重算 rollup（用最新日期）
  const latest = dates.sort().reverse()[0];
  await rebuildRollup(stockId, latest);

  return { stock_id: stockId, ok: true, rows: agg.length, dates, latest };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const mode = String(body?.mode || (Array.isArray(body?.stock_ids) ? 'manual' : 'queue'));
    const rawDate = String(body?.date || taipeiToday());
    const endDate = rollBackToWeekday(rawDate);
    const lookback = Math.max(1, Math.min(30, Number(body?.lookback ?? 1)));
    const startDate = addDays(endDate, -(lookback - 1));

    let stockIds: string[] = [];
    if (Array.isArray(body?.stock_ids) && body.stock_ids.length > 0) {
      stockIds = body.stock_ids.map((s: any) => String(s).trim()).filter((s: string) => /^[0-9]{4,6}$/.test(s));
    } else {
      const batch = Math.max(1, Math.min(200, Number(body?.batch ?? 50)));
      stockIds = await buildQueue(batch, endDate);
    }

    // debug=true 直接把 FinMind 原始回應吐回（不寫 DB），便於診斷帳號權限
    if (body?.debug === true && stockIds.length > 0) {
      const id = stockIds[0];
      const p = new URLSearchParams({
        dataset: 'TaiwanStockTradingDailyReport',
        data_id: id, start_date: startDate, end_date: endDate,
      });
      if (FINMIND_TOKEN) p.set('token', FINMIND_TOKEN);
      const res = await fetch(`${FINMIND_URL}?${p}`);
      const raw = await res.text();
      return json({
        ok: true, debug: true, token_present: Boolean(FINMIND_TOKEN),
        token_len: FINMIND_TOKEN.length,
        url_no_token: `${FINMIND_URL}?dataset=TaiwanStockTradingDailyReport&data_id=${id}&start_date=${startDate}&end_date=${endDate}`,
        http_status: res.status,
        raw_first_500: raw.slice(0, 500),
      });
    }

    if (stockIds.length === 0) {
      return json({ ok: true, mode, endDate, startDate, processed: 0, note: 'no_targets' });
    }

    const results: any[] = [];
    // FinMind 對免費 tier ~600 req/hr → 併發 3 即可安全，處理完約每檔 200~400ms
    const CONCURRENCY = 3;
    let idx = 0;
    async function worker() {
      while (idx < stockIds.length) {
        const my = idx++;
        const id = stockIds[my];
        const t0 = Date.now();
        try {
          const r = await processStock(id, startDate, endDate);
          results.push({ ...r, ms: Date.now() - t0 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ stock_id: id, ok: false, error: msg, ms: Date.now() - t0 });
          // 記錄失敗（best-effort）
          await supa.from('tw_bsr_fetch_failures').upsert({
            stock_id: id, trade_date: endDate,
            failure_reason: 'finmind_error', last_error_message: msg,
            consecutive_failures: 1, next_retry_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          }, { onConflict: 'stock_id,trade_date' }).then(({ error }) => {
            if (error) console.error('finmind failure log insert error:', error.message);
          });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stockIds.length) }, worker));

    const okCount = results.filter((r) => r.ok).length;
    const rowSum = results.reduce((s, r) => s + (r.rows || 0), 0);

    return json({
      ok: true, mode, endDate, startDate, lookback,
      processed: results.length, success: okCount, rows_upserted: rowSum,
      token_present: Boolean(FINMIND_TOKEN),
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('tw-bsr-finmind-sync fatal:', msg);
    return json({ ok: false, error: msg }, 500);
  }
});
