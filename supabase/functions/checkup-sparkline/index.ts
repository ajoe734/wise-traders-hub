// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
//
// F1：本函式不再自行實作上游抓取。日 K 一律走 `_shared/twPriceWaterfall.ts`
// （TWSE STOCK_DAY → TPEx → FinMind），該模組內含重試、退避與熔斷記錄。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { applyCoercion } from "../_shared/inputCoerce.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { fetchTwDailyOhlc, type TwBar } from "../_shared/twPriceWaterfall.ts";

/** partial（歷史不完整）結果只快取 30 分鐘，讓下一次請求可以再回補。 */
const PARTIAL_TTL_MS = 30 * 60 * 1000;
/** 低於這個根數視為 partial。與 waterfall 的 MIN_COMPLETE_BARS 對齊。 */
const MIN_COMPLETE_BARS = 20;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

const handler = withLogging('checkup-sparkline', async (req, log) => {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const fields = {
      codes: {
        required: true, type: 'array' as const, minItems: 1,
        coerce: 'stocksArray',
        acceptTypes: ['string' as const],
        label: 'codes',
        example: '["2330", "2317", "3443"]',
        hint: '股票代碼陣列，可傳字串（會以頓號/逗號自動拆分）或陣列',
      },
    };
    body = applyCoercion(fields as any, body).source;
    const issues = validateInput({ fields: fields as any, source: body });
    if (issues.length) return validationResponse(issues, corsHeaders);

    const codesRaw: unknown = body?.codes;
    const codes = (codesRaw as unknown[])
      .map((v) => String(v).trim())
      .filter((v) => /^\d{4,6}[A-Z]?$/i.test(v))
      .slice(0, 30);

    const sb = serviceClient();

    const day = todayKey();
    type Entry = {
      ohlc: TwBar[]; closes: number[]; source?: string | null;
      fetchedAt?: string | null; tradeDate?: string | null;
      /** 歷史是否完整（>= MIN_COMPLETE_BARS 根） */
      complete?: boolean; barCount?: number;
    };
    const result: Record<string, Entry> = {};
    const toFetch: string[] = [];

    const cacheKeys = codes.map((c) => `sparkline_v3_${c}_${day}`);
    if (cacheKeys.length > 0) {
      const { data: cached } = await sb
        .from("checkup_storage")
        .select("key,data")
        .eq("user_id", "00000000-0000-0000-0000-000000000000")
        .in("key", cacheKeys);
      const map = new Map<string, Entry>();
      const nowMs = Date.now();
      (cached || []).forEach((row: any) => {
        const d = row?.data || {};
        // 只認「有 OHLC」的新快取；舊的 closes-only 快取視為 miss，強制重抓成 K 棒資料
        const ohlc = Array.isArray(d.ohlc) ? d.ohlc : [];
        const closes = Array.isArray(d.closes) ? d.closes : (Array.isArray(d) ? d : []);
        if (ohlc.length < 2) return;
        const complete = d.complete === true || ohlc.length >= MIN_COMPLETE_BARS;
        // partial 不得長效：超過 30 分鐘一律視為 miss，讓回補有機會補齊。
        if (!complete) {
          const age = nowMs - Date.parse(String(d.fetched_at ?? '')) ;
          if (!(age >= 0 && age < PARTIAL_TTL_MS)) return;
        }
        map.set(row.key, {
          ohlc, closes,
          source: d.source ?? null,
          fetchedAt: d.fetched_at ?? null,
          tradeDate: ohlc[ohlc.length - 1]?.date ?? null,
          complete, barCount: ohlc.length,
        });
      });

      for (const c of codes) {
        const k = `sparkline_v3_${c}_${day}`;
        if (map.has(k)) result[c] = map.get(k)!;
        else toFetch.push(c);
      }
    }
    log.info('cache_lookup', { total: codes.length, hits: codes.length - toFetch.length, toFetch: toFetch.length });

    const batchSize = 6;
    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((c) => fetchTwDailyOhlc(c, { supa: sb as any })));
      const upserts: any[] = [];
      batch.forEach((c, idx) => {
        const r = results[idx];
        const ohlc = r?.bars || [];
        const closes = ohlc.map((b) => b.close);
        const fetchedAt = new Date().toISOString();
        const complete = r?.complete === true || ohlc.length >= MIN_COMPLETE_BARS;
        result[c] = {
          ohlc, closes,
          source: r?.source ?? null,
          fetchedAt,
          tradeDate: ohlc[ohlc.length - 1]?.date ?? null,
          complete, barCount: ohlc.length,
        };
        if (ohlc.length >= 2) {
          if (!complete) {
            log.warn('sparkline_partial_history', {
              code: c, bars: ohlc.length, source: r?.source ?? null, attempts: r?.attempts,
            });
          }
          upserts.push({
            user_id: "00000000-0000-0000-0000-000000000000",
            key: `sparkline_v3_${c}_${day}`,
            data: {
              ohlc, closes, source: r?.source ?? null, fetched_at: fetchedAt,
              complete, bar_count: ohlc.length,
            },
          });
        } else {
          log.warn('sparkline_all_sources_failed', { code: c, attempts: r?.attempts });
        }
      });
      if (upserts.length > 0) {
        await sb.from("checkup_storage").upsert(upserts, { onConflict: "user_id,key" });
      }
    }

    return jsonResponse({ result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('sparkline_error', { message: msg });
    return jsonResponse({ error: 'sparkline 取得失敗', detail: msg }, { status: 500 });
  }
});

Deno.serve(handler);
