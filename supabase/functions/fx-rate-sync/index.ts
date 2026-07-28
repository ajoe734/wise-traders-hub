// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * fx-rate-sync
 *
 * 取得 USD/TWD 匯率並 upsert 到 public.fx_rates。
 * 資料源：
 *   L1 Yahoo Finance TWD=X (query1.finance.yahoo.com/v8/finance/chart/TWD=X)
 *   L2 exchangerate.host  (fallback，無金鑰)
 *
 * 走 cron：台北時間 08:00-17:00 每 30 分鐘、盤外每 2 小時。
 */

const YAHOO_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/TWD=X?interval=1d&range=1d';
const FALLBACK_URL = 'https://api.exchangerate.host/latest?base=USD&symbols=TWD';

async function fetchYahoo(): Promise<{ rate: number; source: string } | null> {
  try {
    const r = await fetch(YAHOO_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LegendflowFX/1.0)' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price < 20 || price > 45) return null;
    return { rate: price, source: 'Yahoo Finance' };
  } catch {
    return null;
  }
}

async function fetchFallback(): Promise<{ rate: number; source: string } | null> {
  try {
    const r = await fetch(FALLBACK_URL);
    if (!r.ok) return null;
    const j = await r.json();
    const price = Number(j?.rates?.TWD);
    if (!Number.isFinite(price) || price < 20 || price > 45) return null;
    return { rate: price, source: 'exchangerate.host' };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const result = (await fetchYahoo()) ?? (await fetchFallback());
  if (!result) {
    return new Response(JSON.stringify({ ok: false, error: 'all sources failed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 502,
    });
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from('fx_rates').upsert({
    currency_pair: 'USDTWD',
    rate: Number(result.rate.toFixed(4)),
    source: result.source,
    fetched_at: now,
    updated_at: now,
  });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }

  return new Response(JSON.stringify({ ok: true, ...result, fetched_at: now }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});
