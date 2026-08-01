// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
//
// F4：三大法人單日資料一律走 `_shared/institutionalDay.ts`（TWSE T86 → FinMind），
// 與 tw-institutional-daily-sync 共用同一份解析與雙軌邏輯，不再自行裸 fetch。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { cacheGet, cacheSet } from '../_shared/memoryCache.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';

import { corsHeaders } from '../_shared/cors.ts';
import { codedErrorResponse } from '../_shared/errorCodes.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { fetchInstitutionalDay, type InstDayResult } from '../_shared/institutionalDay.ts';

const CACHE_TTL_MS = 5 * 60 * 1000;

type Payload = {
  available: boolean;
  rows: InstDayResult['rows'];
  data: unknown[];
  fields: unknown[];
  source: InstDayResult['source'];
  attempts: InstDayResult['attempts'];
};

Deno.serve(withLogging('checkup-institutional', async (req, log) => {
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
    let payload = cacheGet<Payload>(cacheKey);
    if (!payload) {
      const result = await fetchInstitutionalDay(date as string, { supa: serviceClient() as any });
      if (result.source === null) {
        log.error('institutional_all_sources_failed', { date, attempts: result.attempts });
        return new Response(JSON.stringify({
          error: '三大法人數據抓取失敗',
          code: 'UPSTREAM_UNAVAILABLE',
          attempts: result.attempts,
        }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (result.source !== 'twse_t86') {
        log.warn('institutional_degraded_source', { date, source: result.source, attempts: result.attempts });
      }
      payload = {
        available: result.rows.length > 0,
        rows: result.rows,
        data: result.raw?.data || [],
        fields: result.fields,
        source: result.source,
        attempts: result.attempts,
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
