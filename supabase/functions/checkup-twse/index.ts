// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";

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
    const exCh = url.searchParams.get('ex_ch');

    const issues = validateInput({
      fields: {
        ex_ch: { required: true, type: 'string', minLength: 3, label: 'ex_ch（如 tse_2330.tw）' },
      },
      source: { ex_ch: exCh },
    });
    if (issues.length) return validationResponse(issues, corsHeaders);


    // 只用 MIS 即時報價 API（對齊 Python 腳本）
    const ts = Date.now();
    const twseUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${ts}`;
    const response = await fetch(twseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    const data = await response.json();

    const rawArray = data?.msgArray || [];

    // 去重：同一 code 可能有 tse/otc 兩筆，保留有效資料的那筆
    const bestByCode = new Map<string, Record<string, string>>();
    for (const item of rawArray) {
      if (!item.c) continue;
      const existing = bestByCode.get(item.c);
      if (!existing) {
        bestByCode.set(item.c, item);
      } else {
        // 優先保留有成交量或有成交價的
        const existZ = parseFloat(existing.z);
        const newZ = parseFloat(item.z);
        const existV = parseInt(existing.v, 10) || 0;
        const newV = parseInt(item.v, 10) || 0;
        if ((!isNaN(newZ) && newZ > 0 && (isNaN(existZ) || existZ <= 0)) ||
            (newV > 0 && existV === 0)) {
          bestByCode.set(item.c, item);
        }
      }
    }

    // 直接回傳去重後的原始 MIS 資料，不做任何價格修改
    // 前端自行實作 4 層瀑布邏輯：z > h(有量) > a > y
    data.msgArray = Array.from(bestByCode.values());

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-store' },
    });
  } catch (error) {
    console.error('TWSE proxy error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'TWSE API 請求失敗', detail: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
