// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const ALLOWED_ENDPOINTS = [
  'SQUOTE_EW_QUOTAS_ALL',   // 上櫃股票每日收盤行情 (對應 TWSE 的 STOCK_DAY_ALL)
  'SQUOTE_EW_PEBR_ALL',     // 上櫃股票本益比/殖利率/淨值比 (對應 TWSE 的 BWIBBU_ALL)
];

const TPEX_BASE = 'https://www.tpex.org.tw/openapi/v1';

const endpointPaths: Record<string, string> = {
  'SQUOTE_EW_QUOTAS_ALL': '/tpex_mainboard_quotes',
  'SQUOTE_EW_PEBR_ALL': '/tpex_mainboard_peratio',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get('endpoint');
    const codesParam = url.searchParams.get('codes'); // comma-separated stock codes

    if (!endpoint || !ALLOWED_ENDPOINTS.includes(endpoint)) {
      return new Response(
        JSON.stringify({ error: `Invalid endpoint. Allowed: ${ALLOWED_ENDPOINTS.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tpexUrl = `${TPEX_BASE}${endpointPaths[endpoint]}`;
    const response = await fetch(tpexUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TPEX API error: ${response.status} - ${text}`);
    }

    let data = await response.json();

    // Filter by stock codes if provided
    // TPEX uses "SecuritiesCompanyCode" for stock code field
    if (codesParam && Array.isArray(data)) {
      const codes = codesParam.split(',').map(c => c.trim());
      data = data.filter((item: any) =>
        codes.includes(item.SecuritiesCompanyCode) || codes.includes(item.Code)
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('TPEX proxy error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
