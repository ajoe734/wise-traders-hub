// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";

import { corsHeaders } from '../_shared/cors.ts';
import { codedErrorResponse } from '../_shared/errorCodes.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

Deno.serve(withLogging('checkup-mops-revenue', async (req) => {
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
    const stockId = url.searchParams.get('stockId');
    const year = url.searchParams.get('year');
    const month = url.searchParams.get('month');

    const issues = validateInput({
      fields: {
        stockId: { required: true, type: 'string', pattern: /^\d{4,6}[A-Z]?(\.(TW|TWO))?$/i, label: 'stockId（如 2330 或 2330.TWO）' },
        year: { required: false, type: 'string', label: 'year' },
        month: { required: false, type: 'string', label: 'month' },
      },
      source: { stockId, year, month },
    });
    if (issues.length) return validationResponse(issues, corsHeaders);


    // Anti-scraping delay
    await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 2000)));

    const code = stockId.split('.')[0];
    const isTwse = !stockId.includes('.TWO') && !stockId.includes('.otc');
    const typek = isTwse ? 'sii' : 'otc';

    const fetchUrl = `https://mops.twse.com.tw/mops/web/ajax_t51sb01?encodeURIComponent=1&step=1&firstin=1&TYPEK=${typek}&code=${code}`;

    const response = await fetch(fetchUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) throw new Error(`MOPS 回應錯誤：${response.status}`);
    const html = await response.text();

    // Parse HTML for revenue data
    const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      return new Response(JSON.stringify({
        stockId, year, month: Number(month), available: false,
        reason: '無法解析營收表格', fetchedAt: new Date().toISOString(),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Return raw HTML for client-side parsing (simplified approach)
    return new Response(JSON.stringify({
      stockId, year, month: Number(month),
      available: true, html: tableMatch[0],
      fetchedAt: new Date().toISOString(), source: 'MOPS',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      stockId: new URL(req.url).searchParams.get('stockId'),
      available: false, reason: (err as Error).message,
      fetchedAt: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
