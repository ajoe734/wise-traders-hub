// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get('symbol') || '2330.TW';

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

    const response = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Yahoo Finance API error: ${response.status} - ${text}`);
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      throw new Error('No data returned for symbol');
    }

    const meta = result.meta;
    const previousClose = meta.previousClose || meta.chartPreviousClose || 0;
    const price = meta.regularMarketPrice || 0;
    const change = price - previousClose;
    const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

    const quote = {
      symbol: meta.symbol,
      shortName: meta.shortName || symbol,
      currency: meta.currency,
      price,
      previousClose,
      change,
      changePercent,
      marketTime: meta.regularMarketTime,
    };

    return new Response(JSON.stringify(quote), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Stock quote error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
