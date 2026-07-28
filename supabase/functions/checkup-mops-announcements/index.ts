// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";

import { corsHeaders } from '../_shared/cors.ts';
import { codedErrorResponse } from '../_shared/errorCodes.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

const ANNOUNCEMENT_TYPES: Record<string, string> = {
  '營收': 'revenue', '股利': 'dividend', '配息': 'dividend', '除權': 'dividend',
  '除息': 'dividend', '董事': 'corporate', '股東': 'corporate', '增資': 'corporate',
  '併購': 'corporate', '法說': 'conference', '重訊': 'material',
};

function inferType(title: string) {
  for (const [kw, type] of Object.entries(ANNOUNCEMENT_TYPES)) {
    if (title.includes(kw)) return type;
  }
  return 'other';
}

Deno.serve(withLogging('checkup-mops-announcements', async (req) => {
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


    // Random delay for anti-scraping
    await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 1000)));

    const year = parseInt(date.slice(0, 4)) - 1911;
    const month = date.slice(4, 6);
    const day = date.slice(6, 8);

    const body = new URLSearchParams({
      encodeURIComponent: '1', step: '1', firstin: '1', off: '1',
      keyword4: '', code1: '', TYPEK2: '', checkbtn: '',
      queryName: 'co_id', inpuType: 'co_id', TYPEK: 'all',
      isnew: 'true', co_id: '',
      date1: `${year}/${month}/${day}`, date2: `${year}/${month}/${day}`,
      keyword3: '',
    });

    const response = await fetch('https://mops.twse.com.tw/mops/web/ajax_t05st01', {
      signal: AbortSignal.timeout(10000),
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://mops.twse.com.tw/mops/web/t05st01',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `MOPS responded ${response.status}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const html = await response.text();
    const announcements: any[] = [];
    const rowRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/gi;
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      const code = match[1].replace(/<[^>]*>/g, '').trim().toUpperCase();
      const name = match[2].replace(/<[^>]*>/g, '').trim();
      const time = match[3].replace(/<[^>]*>/g, '').trim();
      const title = match[4].replace(/<[^>]*>/g, '').trim();
      if (code && title && /^\d{4,6}[A-Z]?$/i.test(code)) {
        announcements.push({ code, name, type: inferType(title), title, time });
      }
    }

    return new Response(JSON.stringify({
      date, announcements, fetchedAt: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '取得 MOPS 資料失敗', detail: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
