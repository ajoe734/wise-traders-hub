/**
 * us-stock-quote
 *
 * 用 Finnhub 抓美股即時報價（與名稱）。
 *
 * Request:
 *   POST { symbols: string[], persist?: boolean }
 *
 * Response:
 *   {
 *     quotes: Record<string, {
 *       symbol: string;
 *       price: number | null;
 *       change: number | null;
 *       change_pct: number | null;
 *       prev_close: number | null;
 *       currency: 'USD';
 *       fetched_at: string;
 *     }>;
 *     names?: Record<string, string>;
 *   }
 *
 * persist=true 會把報價寫進 current_prices（currency='USD'）；給 holdings 取用。
 */

import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

interface QuoteResult {
  symbol: string;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  prev_close: number | null;
  currency: 'USD';
  fetched_at: string;
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isUsSymbol(s: string): boolean {
  return /^[A-Z]{1,5}(\.[A-Z])?$/.test(s);
}

async function finnhubQuote(symbol: string, apiKey: string): Promise<QuoteResult> {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`finnhub quote ${symbol} HTTP ${res.status}`);
      return {
        symbol, price: null, change: null, change_pct: null, prev_close: null,
        currency: 'USD', fetched_at: fetchedAt,
      };
    }
    const j = await res.json();
    // Finnhub /quote: c=current, d=change, dp=percent change, pc=prev close
    const price = Number(j?.c);
    const prev = Number(j?.pc);
    const change = Number(j?.d);
    const changePct = Number(j?.dp);
    return {
      symbol,
      price: Number.isFinite(price) && price > 0 ? price : null,
      change: Number.isFinite(change) ? change : null,
      change_pct: Number.isFinite(changePct) ? changePct : null,
      prev_close: Number.isFinite(prev) && prev > 0 ? prev : null,
      currency: 'USD',
      fetched_at: fetchedAt,
    };
  } catch (e) {
    console.warn(`finnhub quote ${symbol} error`, e);
    return {
      symbol, price: null, change: null, change_pct: null, prev_close: null,
      currency: 'USD', fetched_at: fetchedAt,
    };
  }
}

async function finnhubProfile(symbol: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`);
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j?.name === 'string' && j.name.trim() ? j.name.trim() : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('FINNHUB_API_KEY');
    if (!apiKey) return ok({ error: 'FINNHUB_API_KEY not configured' }, 500);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const rawSymbols = Array.isArray(body?.symbols) ? body.symbols : [];
    const persist = body?.persist === true;
    const includeNames = body?.includeNames === true;

    const symbols: string[] = [...new Set(
      rawSymbols
        .map((s: unknown) => String(s || '').trim().toUpperCase())
        .filter((s: string) => s && isUsSymbol(s)),
    )].slice(0, 50); // 免費方案 60 req/min，每次最多 50 個

    if (symbols.length === 0) return ok({ quotes: {}, names: {} });

    // 並行抓報價（Finnhub 沒 batch endpoint）
    const results = await Promise.all(symbols.map((s) => finnhubQuote(s, apiKey)));
    const quotes: Record<string, QuoteResult> = {};
    for (const r of results) quotes[r.symbol] = r;

    let names: Record<string, string> = {};
    if (includeNames) {
      const nameResults = await Promise.all(
        symbols.map(async (s) => [s, await finnhubProfile(s, apiKey)] as const),
      );
      for (const [s, n] of nameResults) if (n) names[s] = n;
    }

    // 持久化到 current_prices（給 holdings 取用）
    if (persist) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const rows = results
        .filter((r) => r.price != null && r.price > 0)
        .map((r) => ({
          symbol: r.symbol,
          price: r.price,
          change: r.change ?? 0,
          change_pct: r.change_pct ?? 0,
          prev_close: r.prev_close,
          currency: 'USD',
          updated_at: r.fetched_at,
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('current_prices')
          .upsert(rows as any, { onConflict: 'symbol' });
        if (error) console.warn('current_prices upsert error:', error);
      }

      // 順手寫 stock_names（如果有抓到名字）
      if (includeNames && Object.keys(names).length > 0) {
        const nameRows = Object.entries(names).map(([symbol, name]) => ({
          symbol, name, currency: 'USD', market: 'US',
        }));
        const { error } = await supabase
          .from('stock_names')
          .upsert(nameRows as any, { onConflict: 'symbol' });
        if (error) console.warn('stock_names upsert error:', error);
      }
    }

    return ok({ quotes, names });
  } catch (e) {
    console.error('us-stock-quote error', e);
    return ok({ error: (e as Error).message }, 500);
  }
});
