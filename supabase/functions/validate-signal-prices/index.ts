// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
/**
 * Price Validation Edge Function
 * 
 * Runs post-market to validate that signal price_hints fall within the day's OHLC range.
 * Uses TWSE/TPEX official EOD data to verify signal prices.
 * 
 * Call: POST /validate-signal-prices
 * Body: { date?: string } — defaults to today (format: YYYY-MM-DD)
 * 
 * Returns: { validated: number, flagged: Signal[], skipped: number }
 */

Deno.serve(withLogging('validate-signal-prices', async (req) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = serviceClient();

    const body = await req.json().catch(() => ({}));
    const targetDate = body.date || new Date().toISOString().slice(0, 10);

    // Fetch today's signals with price_hint
    const startOfDay = `${targetDate}T00:00:00+08:00`;
    const endOfDay = `${targetDate}T23:59:59+08:00`;

    const { data: signals, error: sigError } = await supabase
      .from('expert_signals')
      .select('id, instrument, price_hint, action, expert_id, published_at')
      .gte('published_at', startOfDay)
      .lte('published_at', endOfDay)
      .not('price_hint', 'is', null);

    if (sigError) throw sigError;
    if (!signals || signals.length === 0) {
      return new Response(JSON.stringify({ validated: 0, flagged: [], skipped: 0, message: 'No signals found for date' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract unique stock codes
    const codeMap = new Map<string, typeof signals>();
    for (const sig of signals) {
      const match = sig.instrument?.match(/^(\d{4})/);
      if (!match) continue;
      const code = match[1];
      if (!codeMap.has(code)) codeMap.set(code, []);
      codeMap.get(code)!.push(sig);
    }

    const codes = [...codeMap.keys()];

    // Fetch TWSE EOD data
    const twseRes = await fetch(
      `${supabaseUrl}/functions/v1/twse-proxy?endpoint=STOCK_DAY_ALL&codes=${codes.join(',')}`,
      { headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'apikey': serviceRoleKey } }
    );
    const twseData = twseRes.ok ? await twseRes.json() : [];

    // Fetch TPEX EOD data
    const tpexRes = await fetch(
      `${supabaseUrl}/functions/v1/tpex-proxy?endpoint=SQUOTE_EW_QUOTAS_ALL&codes=${codes.join(',')}`,
      { headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'apikey': serviceRoleKey } }
    );
    const tpexData = tpexRes.ok ? await tpexRes.json() : [];

    // Build price range lookup: code -> { high, low, close }
    const priceRanges = new Map<string, { high: number; low: number; close: number }>();

    // TWSE fields
    if (Array.isArray(twseData)) {
      for (const item of twseData) {
        const code = item.Code;
        const high = parseFloat(item.HighestPrice);
        const low = parseFloat(item.LowestPrice);
        const close = parseFloat(item.ClosingPrice);
        if (code && !isNaN(high) && !isNaN(low)) {
          priceRanges.set(code, { high, low, close });
        }
      }
    }

    // TPEX fields (may use different field names)
    if (Array.isArray(tpexData)) {
      for (const item of tpexData) {
        const code = item.SecuritiesCompanyCode || item.Code;
        const high = parseFloat(item.High || item.HighestPrice);
        const low = parseFloat(item.Low || item.LowestPrice);
        const close = parseFloat(item.Close || item.ClosingPrice);
        if (code && !isNaN(high) && !isNaN(low) && !priceRanges.has(code)) {
          priceRanges.set(code, { high, low, close });
        }
      }
    }

    // Validate each signal
    const flagged: any[] = [];
    let validated = 0;
    let skipped = 0;

    for (const [code, sigs] of codeMap) {
      const range = priceRanges.get(code);
      if (!range) {
        skipped += sigs.length;
        continue;
      }

      for (const sig of sigs) {
        const price = Number(sig.price_hint);
        if (isNaN(price)) { skipped++; continue; }

        if (price < range.low || price > range.high) {
          flagged.push({
            signal_id: sig.id,
            instrument: sig.instrument,
            price_hint: price,
            action: sig.action,
            expert_id: sig.expert_id,
            day_high: range.high,
            day_low: range.low,
            day_close: range.close,
            deviation: price > range.high
              ? `高於最高價 ${((price - range.high) / range.high * 100).toFixed(2)}%`
              : `低於最低價 ${((range.low - price) / range.low * 100).toFixed(2)}%`,
          });
        } else {
          validated++;
        }
      }
    }

    return new Response(JSON.stringify({
      date: targetDate,
      total: signals.length,
      validated,
      flagged,
      skipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Price validation error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
