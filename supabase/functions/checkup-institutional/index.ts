// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { cacheGet, cacheSet } from '../_shared/memoryCache.ts';

import { corsHeaders } from '../_shared/cors.ts';
import { codedErrorResponse } from '../_shared/errorCodes.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

const CACHE_TTL_MS = 5 * 60 * 1000;

Deno.serve(withLogging('checkup-institutional', async (req) => {
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

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'GET') {
    return codedErrorResponse('METHOD_NOT_ALLOWED', '不支援的 HTTP 方法');
  }

  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');

    const issues = validateInput({
      fields: {
        date: { required: true, type: 'string', pattern: /^\d{8}$/, label: 'date YYYYMMDD' },
      },
      source: { date },
    });
    if (issues.length) return validationResponse(issues, corsHeaders);

    const cacheKey = `institutional:${date}`;
    let payload = cacheGet<{ available: boolean; data: unknown[]; fields: unknown[] }>(cacheKey);
    if (!payload) {
      const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&rt=true`;
      const response = await fetch(twseUrl, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });
      if (!response.ok) throw new Error(`TWSE API 回應錯誤：${response.status}`);
      const data = await response.json();
      payload = {
        available: !!data?.data,
        data: data?.data || [],
        fields: data?.fields || [],
      };
      cacheSet(cacheKey, payload, CACHE_TTL_MS);
    }

    return new Response(JSON.stringify({
      date,
      ...payload,
      fetchedAt: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Institutional API error:', err);
    return new Response(JSON.stringify({
      error: '三大法人數據抓取失敗',
      detail: (err as Error).message,
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
