// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
//
// F1：即時報價一律走 `_shared/twPriceWaterfall.ts`（MIS → TWSE openapi 收盤快照），
// 內含重試、退避與熔斷記錄；本函式只負責驗參與回應塑形。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { fetchTwQuotes } from "../_shared/twPriceWaterfall.ts";

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

    const { msgArray, source, attempts } = await fetchTwQuotes(exCh as string, {
      supa: serviceClient() as any,
    });

    if (source === null) {
      log.error('twse_all_sources_failed', { attempts });
      return jsonResponse(
        { error: 'TWSE 報價來源全部無回應', msgArray: [], quote_source: null },
        { status: 502 },
      );
    }
    if (source !== 'twse_mis') {
      log.warn('twse_degraded_source', { source, attempts });
    }

    return jsonResponse(
      { msgArray, rtcode: '0000', quote_source: source },
      { headers: { 'Cache-Control': 'no-cache, no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('twse_proxy_error', { message });
    return jsonResponse({ error: 'TWSE API 請求失敗', detail: message }, { status: 500 });
  }
});

Deno.serve(handler);
