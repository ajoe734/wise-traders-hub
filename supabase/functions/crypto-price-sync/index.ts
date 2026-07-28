// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// crypto-price-sync
// 每 5 分鐘同步 crypto_symbol_map 內所有 is_active=true 的幣別現價
// 資料源優先順序：Binance /api/v3/ticker/24hr → Coingecko simple/price fallback
// 寫入 public.current_prices（asset_class='crypto', currency='USD', market='CRYPTO'）
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

interface SymbolRow {
  symbol: string;
  coingecko_id: string;
  binance_pair: string | null;
}

interface PriceRecord {
  symbol: string;
  name: string | null;
  price: number;
  change_value: number | null;
  change_percent: number | null;
  yesterday_close: number | null;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  volume: number | null;
  updated_at: string;
  currency: 'USD';
  market: 'CRYPTO';
  asset_class: 'crypto';
}

async function fetchBinanceBatch(pairs: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (pairs.length === 0) return out;
  const symbolsParam = encodeURIComponent(JSON.stringify(pairs));
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'legendflow/1.0' } });
  if (!res.ok) {
    console.warn('binance batch failed', res.status, await res.text());
    return out;
  }
  const arr = await res.json() as any[];
  for (const t of arr) out.set(t.symbol, t);
  return out;
}

async function fetchCoingeckoBatch(ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (ids.length === 0) return out;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'legendflow/1.0' } });
  if (!res.ok) {
    console.warn('coingecko batch failed', res.status, await res.text());
    return out;
  }
  const obj = await res.json() as Record<string, any>;
  for (const [id, v] of Object.entries(obj)) out.set(id, v);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const startedAt = Date.now();
  const errors: string[] = [];
  let written = 0;

  try {
    const { data: rows, error: mapErr } = await supabase
      .from('crypto_symbol_map')
      .select('symbol, coingecko_id, binance_pair, display_name')
      .eq('is_active', true);
    if (mapErr) throw mapErr;

    const list = (rows || []) as (SymbolRow & { display_name: string })[];
    const binancePairs = list.filter(r => r.binance_pair).map(r => r.binance_pair!);
    const binanceMap = await fetchBinanceBatch(binancePairs);

    // 找出 Binance 沒回的，用 Coingecko 補
    const missingIds = list
      .filter(r => !r.binance_pair || !binanceMap.has(r.binance_pair!))
      .map(r => r.coingecko_id);
    const cgMap = await fetchCoingeckoBatch(missingIds);

    const now = new Date().toISOString();
    const records: PriceRecord[] = [];

    for (const row of list) {
      let rec: PriceRecord | null = null;
      const bt = row.binance_pair ? binanceMap.get(row.binance_pair) : null;
      if (bt) {
        const price = parseFloat(bt.lastPrice);
        if (Number.isFinite(price)) {
          const openPrice = parseFloat(bt.openPrice);
          rec = {
            symbol: row.symbol,
            name: row.display_name,
            price,
            change_value: parseFloat(bt.priceChange),
            change_percent: parseFloat(bt.priceChangePercent),
            yesterday_close: Number.isFinite(openPrice) ? openPrice : null,
            open_price: Number.isFinite(openPrice) ? openPrice : null,
            high_price: parseFloat(bt.highPrice),
            low_price: parseFloat(bt.lowPrice),
            volume: Math.floor(parseFloat(bt.volume ?? '0')),
            updated_at: now,
            currency: 'USD',
            market: 'CRYPTO',
            asset_class: 'crypto',
          };
        }
      }
      if (!rec) {
        const cg = cgMap.get(row.coingecko_id);
        if (cg && typeof cg.usd === 'number') {
          const changePct = typeof cg.usd_24h_change === 'number' ? cg.usd_24h_change : null;
          const openPrice = changePct != null ? cg.usd / (1 + changePct / 100) : null;
          rec = {
            symbol: row.symbol,
            name: row.display_name,
            price: cg.usd,
            change_value: openPrice != null ? cg.usd - openPrice : null,
            change_percent: changePct,
            yesterday_close: openPrice,
            open_price: openPrice,
            high_price: null,
            low_price: null,
            volume: typeof cg.usd_24h_vol === 'number' ? Math.floor(cg.usd_24h_vol) : null,
            updated_at: now,
            currency: 'USD',
            market: 'CRYPTO',
            asset_class: 'crypto',
          };
        }
      }
      if (rec) records.push(rec);
      else errors.push(`no price for ${row.symbol}`);
    }

    if (records.length > 0) {
      const { error: upErr, data: rpcWritten } = await supabase.rpc('upsert_current_price', {
        p_writer: 'crypto-price-sync',
        p_rows: records,
      });
      if (upErr) throw upErr;
      written = typeof rpcWritten === 'number' ? rpcWritten : records.length;
    }
  } catch (e) {
    console.error('crypto-price-sync error', e);
    errors.push(String(e?.message ?? e));
  }

  const duration_ms = Date.now() - startedAt;
  try {
    await supabase.from('function_run_logs').insert({
      function_name: 'crypto-price-sync',
      status: errors.length > 0 && written === 0 ? 'error' : 'ok',
      duration_ms,
      meta: { written, errors },
    } as any);
  } catch (_) { /* logging best-effort */ }

  return new Response(
    JSON.stringify({ ok: errors.length === 0 || written > 0, written, errors, duration_ms }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
  );
});
