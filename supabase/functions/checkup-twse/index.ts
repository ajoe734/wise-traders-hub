// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

const handler = withLogging('checkup-twse', async (req, log) => {
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
    const twseUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh as string)}&json=1&delay=0&_=${ts}`;
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

    data.msgArray = Array.from(bestByCode.values());

    return jsonResponse(data, {
      headers: { 'Cache-Control': 'no-cache, no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('twse_proxy_error', { message });
    return jsonResponse({ error: 'TWSE API 請求失敗', detail: message }, { status: 500 });
  }
});

Deno.serve(handler);
