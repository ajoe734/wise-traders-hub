// AUTH: cron  (X-Cron-Key or service role)
// Phase 1 — US Option daily close mark-price snapshot.
// Reads all open combo signals from expert_signals + expert_signal_legs,
// resolves each leg to its OCC symbol, fetches Yahoo Finance option chain
// mark price, writes rows into public.current_prices (asset_class=us_option).
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { requireCronKey } from '../_shared/authGuard.ts';
import { buildOccSymbol, type OptionRight } from './occ.ts';
import { fetchYahooOptionQuote } from './yahoo.ts';

type LegRow = {
  signal_id: string;
  underlying: string;
  expiry: string; // YYYY-MM-DD
  right: OptionRight;
  strike: number;
};

function r_ok(n: number) { return Number.isFinite(n) && n > 0; }

Deno.serve(withLogging('us-option-price-sync', async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Only cron / service role may invoke.
  try {
    requireCronKey(req);
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    return new Response(
      JSON.stringify({ error: err.message ?? 'forbidden', code: err.code ?? 'FORBIDDEN' }),
      { status: err.status ?? 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Skip if it is not ~market close in US-East. The scheduler fires twice
  // (EDT + EST), so exactly one call per day should proceed.
  const nowNy = nyClock(new Date());
  const forced = new URL(req.url).searchParams.get('force') === '1';
  if (!forced && !isPostCloseNY(nowNy)) {
    return new Response(
      JSON.stringify({ skipped: true, reason: 'outside_us_close_window', ny: nowNy }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const supabase = serviceClient();

  // Pull open combo signals + their legs.
  const { data: signals, error: sigErr } = await supabase
    .from('expert_signals')
    .select('id')
    .eq('is_combo', true)
    // pending（尚未到發布窗）也是實際持倉，需要收盤 mark price。
    .in('status', ['published', 'pending']);
  if (sigErr) throw sigErr;
  const signalIds = (signals ?? []).map((s: { id: string }) => s.id);
  if (signalIds.length === 0) {
    return jsonOk({ message: 'no combos', legs: 0, written: 0 });
  }

  const { data: legsRaw, error: legErr } = await supabase
    .from('expert_signal_legs')
    .select('signal_id, underlying, expiry, right_type, strike')
    .in('signal_id', signalIds);
  if (legErr) throw legErr;
  const legs: LegRow[] = (legsRaw ?? [])
    .map((r: Record<string, unknown>) => ({
      signal_id: String(r.signal_id),
      underlying: String(r.underlying ?? ''),
      expiry: String(r.expiry ?? ''),
      right: (r.right_type === 'P' ? 'P' : 'C') as OptionRight,
      strike: Number(r.strike ?? 0),
    }))
    .filter((l) => l.underlying && l.expiry && r_ok(l.strike));
  if (legs.length === 0) return jsonOk({ message: 'no legs', legs: 0, written: 0 });

  // Group legs by underlying → single Yahoo call per underlying.
  const byUnderlying = new Map<string, LegRow[]>();
  for (const l of legs) {
    const k = l.underlying.toUpperCase();
    byUnderlying.set(k, [...(byUnderlying.get(k) ?? []), l]);
  }

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const misses: { occ: string; reason: string }[] = [];

  for (const [underlying, group] of byUnderlying) {
    // Deduplicate expiry to minimise upstream requests.
    const expiries = Array.from(new Set(group.map((g) => g.expiry)));
    for (const expiry of expiries) {
      let chain;
      try {
        chain = await fetchYahooOptionQuote(underlying, expiry);
      } catch (e) {
        for (const l of group.filter((g) => g.expiry === expiry)) {
          const occ = buildOccSymbol(l);
          if (occ) misses.push({ occ, reason: `yahoo_error:${(e as Error).message}` });
        }
        continue;
      }
      for (const l of group.filter((g) => g.expiry === expiry)) {
        const occ = buildOccSymbol(l);
        if (!occ) continue;
        const quote = chain.byOcc.get(occ);
        if (!quote || !(quote.mark > 0)) {
          misses.push({ occ, reason: 'not_in_chain' });
          continue;
        }
        rows.push({
          symbol: occ,
          name: `${underlying} ${expiry} ${l.strike}${l.right}`,
          price: quote.mark,
          market: 'US',
          currency: 'USD',
          asset_class: 'us_option',
          open_price: null,
          high_price: null,
          low_price: null,
          yesterday_close: quote.yesterday_close ?? null,
          change_value: null,
          change_percent: null,
          volume: quote.volume ?? null,
          best_ask: quote.ask ?? null,
          best_bid: quote.bid ?? null,
          limit_up: null,
          limit_down: null,
          updated_at: now,
        });
      }
    }
  }

  if (rows.length > 0) {
    const { error: upErr } = await supabase.rpc('upsert_current_price', {
      p_writer: 'us-option-price-sync',
      p_rows: rows,
    });
    if (upErr) console.error('upsert_current_price error:', upErr);
  }

  // Phase 7 Step 5 — observability: 未定價的腿必須留痕，否則 combo 永遠 stale 而沒人知道。
  // 本表其他列為 user-scoped；系統級（cron）紀錄一律 user_id = null，兩者互不干擾。
  if (misses.length > 0) {
    const seenAt = now;
    const symbols = misses.map((m) => m.occ);
    const { data: existing } = await supabase
      .from('checkup_price_misses')
      .select('id, symbol, attempts')
      .is('user_id', null)
      .in('symbol', symbols);
    const bySymbol = new Map((existing ?? []).map((r) => [r.symbol as string, r]));

    for (const m of misses) {
      const reason = m.reason.startsWith('yahoo_error') ? 'yahoo_error' : m.reason;
      const prev = bySymbol.get(m.occ);
      const payload = {
        reason,
        last_error: m.reason.slice(0, 500),
        last_seen_at: seenAt,
        resolved_at: null,
      };
      const { error } = prev
        ? await supabase
            .from('checkup_price_misses')
            .update({ ...payload, attempts: Number(prev.attempts ?? 0) + 1 })
            .eq('id', prev.id)
        : await supabase
            .from('checkup_price_misses')
            .insert({ ...payload, symbol: m.occ, user_id: null, attempts: 1 });
      if (error) console.error('price miss log error:', m.occ, error.message);
    }
  }


  // 已定價的腿若先前被記為 miss，標記為已解決（只碰系統級列）。
  if (rows.length > 0) {
    await supabase
      .from('checkup_price_misses')
      .update({ resolved_at: now })
      .is('user_id', null)
      .in('symbol', rows.map((r) => r.symbol as string))
      .is('resolved_at', null);
  }



  return jsonOk({
    legs: legs.length,
    written: rows.length,
    missed: misses.length,
    missSample: misses.slice(0, 10),
  });
}));

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Return America/New_York clock parts (H,M,dow) from UTC. Handles DST via Intl. */
export function nyClock(now: Date): { hour: number; minute: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = wdMap[parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'] ?? 0;
  return { hour, minute, dow };
}

/** Post-close = weekday, between 16:05 and 16:30 NY local. */
export function isPostCloseNY({ hour, minute, dow }: { hour: number; minute: number; dow: number }): boolean {
  if (dow < 1 || dow > 5) return false;
  const m = hour * 60 + minute;
  return m >= 16 * 60 + 5 && m <= 16 * 60 + 30;
}
