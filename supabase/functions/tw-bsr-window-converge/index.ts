// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// tw-bsr-window-converge
// 收斂式排程：每次呼叫掃描 active TW 持倉，為未達 60 日視窗的個股補齊工作。
// 由 pg_cron 每日盤後多次觸發，直到所有持倉的視窗皆 ready 或 upstream_exhausted。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const cid = crypto.randomUUID();
  try {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const maxStocks = Math.max(1, Math.min(200,
      Number(body?.max_stocks ?? url.searchParams.get('max_stocks') ?? 40)));
    const chunkDates = Math.max(1, Math.min(60,
      Number(body?.chunk_dates ?? url.searchParams.get('chunk_dates') ?? 15)));
    const horizonDays = Math.max(20, Math.min(180,
      Number(body?.horizon_days ?? url.searchParams.get('horizon_days') ?? 110)));

    const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const t0 = Date.now();
    const { data, error } = await supa.rpc('converge_bsr_windows', {
      p_max_stocks: maxStocks,
      p_chunk_dates: chunkDates,
      p_horizon_days: horizonDays,
    });
    const ms = Date.now() - t0;

    if (error) {
      console.error(`[${cid}] converge_bsr_windows error:`, error.message);
      return new Response(JSON.stringify({ ok: false, cid, error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[${cid}] converge done in ${ms}ms:`, JSON.stringify(data));

    return new Response(JSON.stringify({ ok: true, cid, ms, result: data }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${cid}] fatal:`, msg);
    return new Response(JSON.stringify({ ok: false, cid, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
