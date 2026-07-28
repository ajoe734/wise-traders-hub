// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { cacheGet, cacheSet } from '../_shared/memoryCache.ts';

import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
const ALLOWED_ENDPOINTS = [
  'STOCK_DAY_ALL',
  'BWIBBU_ALL',
  'MI_INDEX',
  'STOCK_DAY_AVG_ALL',
];

const TWSE_BASE = 'https://openapi.twse.com.tw/v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

const endpointPaths: Record<string, string> = {
  'STOCK_DAY_ALL': '/exchangeReport/STOCK_DAY_ALL',
  'BWIBBU_ALL': '/exchangeReport/BWIBBU_ALL',
  'MI_INDEX': '/exchangeReport/MI_INDEX',
  'STOCK_DAY_AVG_ALL': '/exchangeReport/STOCK_DAY_AVG_ALL',
};

Deno.serve(withLogging('twse-proxy', async (req) => {
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

    const cacheKey = `twse:${endpoint}`;
    let upstream = cacheGet<unknown>(cacheKey);
    if (!upstream) {
      const twseUrl = `${TWSE_BASE}${endpointPaths[endpoint]}`;
      const response = await fetch(twseUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`TWSE API error: ${response.status} - ${text}`);
      }
      upstream = await response.json();
      cacheSet(cacheKey, upstream, CACHE_TTL_MS);
    }

    let data: unknown = upstream;
    if (codesParam && Array.isArray(data)) {
      const codes = codesParam.split(',').map(c => c.trim());
      data = data.filter((item: any) => codes.includes(item.Code));
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('TWSE proxy error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
