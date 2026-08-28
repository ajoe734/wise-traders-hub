// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
//
// F1：本函式不再自行實作上游抓取。日 K 一律走 `_shared/twPriceWaterfall.ts`
// （TWSE STOCK_DAY → TPEx → FinMind），該模組內含重試、退避與熔斷記錄。
//
// V2（收盤對齊 + retry cooldown）：
//   - 日鍵改用 Asia/Taipei（`taipeiTodayIso`），不再用 Edge 本機 UTC 日期。
//   - cache hit 必須同時滿足原有效性 **且** last_bar >= canonical
//     latestCompletedTradeDate（`expectedLatestBsrDate`，對齊前端 14:05 settle）。
//   - stale（last_bar < expected）時誠實回傳舊 tradeDate，前端維持 pending；
//     provider retry 由 `last_attempted_at`（cache JSON internal-only 欄位）
//     以既有 PARTIAL_TTL_MS 做全域 cooldown，避免 request storm。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { applyCoercion } from "../_shared/inputCoerce.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { fetchTwDailyOhlc, type TwBar } from "../_shared/twPriceWaterfall.ts";
import { expectedLatestBsrDate } from "../_shared/tradingDate.ts";
import { getTwHolidaysCached, taipeiTodayIso } from "../_shared/twTradingCalendar.ts";
import { coalesce } from "../_shared/requestCoalescer.ts";

// __SLICE_START:constants
/** partial（歷史不完整）結果只快取 30 分鐘，讓下一次請求可以再回補。
 *  同一常數也作為 stale 重抓的全域 cooldown（不另設 TTL）。 */
const PARTIAL_TTL_MS = 30 * 60 * 1000;
/** 低於這個根數視為 partial。與 waterfall 的 MIN_COMPLETE_BARS 對齊。 */
const MIN_COMPLETE_BARS = 20;
/** Edge `isAfterCloseAt` 門檻為台北 14:00；前端 closeAuthority 為 13:30+35=14:05。
 *  往前平移 5 分鐘讓兩者精確對齊，避免 14:00–14:05 之間無謂 miss。 */
const SETTLE_ALIGN_MS = 5 * 60 * 1000;
// __SLICE_END:constants

// __SLICE_START:classifyCacheEntry
/**
 * 快取分類（純函式）。
 *   miss               → 無可用資料，必須抓
 *   hit_fresh          → 直接使用
 *   hit_stale_cooldown → last_bar 落後，但在 retry cooldown 內：serve stale、0 fetch
 *   refetch            → last_bar 落後且 cooldown 到期：只重抓該 code
 */
function classifyCacheEntry(d, expected, nowMs) {
  const ohlc = Array.isArray(d?.ohlc) ? d.ohlc : [];
  if (ohlc.length < 2) return 'miss';
  const complete = d.complete === true || ohlc.length >= MIN_COMPLETE_BARS;
  if (!complete) {
    const age = nowMs - Date.parse(String(d.fetched_at ?? ''));
    if (!(age >= 0 && age < PARTIAL_TTL_MS)) return 'miss';
  }
  const lastBar = String(ohlc[ohlc.length - 1]?.date ?? '');
  if (lastBar && expected && lastBar >= expected) return 'hit_fresh';
  const attemptedAt = Date.parse(String(d.last_attempted_at ?? d.fetched_at ?? ''));
  const sinceAttempt = nowMs - attemptedAt;
  if (Number.isFinite(attemptedAt) && sinceAttempt >= 0 && sinceAttempt < PARTIAL_TTL_MS) {
    return 'hit_stale_cooldown';
  }
  return 'refetch';
}
// __SLICE_END:classifyCacheEntry

// __SLICE_START:buildUpsertRow
/**
 * 決定要寫回 `checkup_storage.data` 的內容（純函式）。
 *   - 抓到 >=2 根：更新全部 factual 欄位 + last_attempted_at。
 *   - 抓取失敗但有舊資料：**只**更新 last_attempted_at 當 retry marker，
 *     factual 欄位（ohlc/closes/source/fetched_at/complete/bar_count）逐欄保留。
 *   - 兩者皆無：回 null（不寫）。
 */
function buildUpsertRow(prev, next, nowIso) {
  const nextBars = Array.isArray(next?.ohlc) ? next.ohlc : [];
  if (nextBars.length >= 2) {
    return {
      ohlc: nextBars,
      closes: nextBars.map((b) => b.close),
      source: next.source ?? null,
      fetched_at: nowIso,
      complete: next.complete === true || nextBars.length >= MIN_COMPLETE_BARS,
      bar_count: nextBars.length,
      last_attempted_at: nowIso,
    };
  }
  const prevBars = Array.isArray(prev?.ohlc) ? prev.ohlc : [];
  if (prevBars.length >= 2) {
    return {
      ohlc: prevBars,
      closes: Array.isArray(prev.closes) ? prev.closes : prevBars.map((b) => b.close),
      source: prev.source ?? null,
      fetched_at: prev.fetched_at ?? null,
      complete: prev.complete === true || prevBars.length >= MIN_COMPLETE_BARS,
      bar_count: Number.isFinite(prev.bar_count) ? prev.bar_count : prevBars.length,
      last_attempted_at: nowIso,
    };
  }
  return null;
}
// __SLICE_END:buildUpsertRow

// __SLICE_START:entryFromData
/** 由 cache JSON 造出 response entry（internal-only 欄位不外流）。 */
function entryFromData(d) {
  const ohlc = Array.isArray(d?.ohlc) ? d.ohlc : [];
  const closes = Array.isArray(d?.closes) ? d.closes : ohlc.map((b) => b.close);
  return {
    ohlc,
    closes,
    source: d?.source ?? null,
    fetchedAt: d?.fetched_at ?? null,
    tradeDate: ohlc[ohlc.length - 1]?.date ?? null,
    complete: d?.complete === true || ohlc.length >= MIN_COMPLETE_BARS,
    barCount: ohlc.length,
  };
}
// __SLICE_END:entryFromData

// __SLICE_START:planCacheDecisions
/**
 * 依快取分類決定「直接供應」與「要抓」的分流（純函式）。
 * rows: Map<code, cacheData>；回傳 serve（code → cacheData）、toFetch、prev（refetch 者的舊資料）。
 */
function planCacheDecisions(codes, rows, expected, nowMs) {
  const serve = new Map();
  const prev = new Map();
  const toFetch = [];
  let cooldownServed = 0;
  for (const c of codes) {
    const d = rows.get(c);
    if (!d) { toFetch.push(c); continue; }
    const cls = classifyCacheEntry(d, expected, nowMs);
    if (cls === 'hit_fresh') { serve.set(c, d); continue; }
    if (cls === 'hit_stale_cooldown') { serve.set(c, d); cooldownServed += 1; continue; }
    if (cls === 'refetch') prev.set(c, d);
    toFetch.push(c);
  }
  return { serve, prev, toFetch, cooldownServed };
}
// __SLICE_END:planCacheDecisions



/** canonical「最後完整交易日」。禁止自寫 Mon-Fri，一律走 market calendar。 */
function expectedTradeDateFor(nowMs: number, holidays?: string[]): string {
  return expectedLatestBsrDate(nowMs - SETTLE_ALIGN_MS, holidays);
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
    // 同一 request 內去重：同一代號只可能抓一次。
    const codes = Array.from(new Set(
      (codesRaw as unknown[])
        .map((v) => String(v).trim())
        .filter((v) => /^\d{4,6}[A-Z]?$/i.test(v)),
    )).slice(0, 30);

    const sb = serviceClient();

    const nowMs = Date.now();
    const holidays = await getTwHolidaysCached(sb as any, nowMs).catch(() => [] as string[]);
    const day = taipeiTodayIso(nowMs).replace(/-/g, '');
    const expected = expectedTradeDateFor(nowMs, holidays);
    type Entry = {
      ohlc: TwBar[]; closes: number[]; source?: string | null;
      fetchedAt?: string | null; tradeDate?: string | null;
      /** 歷史是否完整（>= MIN_COMPLETE_BARS 根） */
      complete?: boolean; barCount?: number;
    };
    const result: Record<string, Entry> = {};
    let toFetch: string[] = [];
    /** stale 但仍要重抓者的舊資料：抓失敗時回退用，且用來保留 factual 欄位。 */
    let prevData = new Map<string, any>();
    let cooldownServed = 0;

    const cacheKeys = codes.map((c) => `sparkline_v3_${c}_${day}`);
    if (cacheKeys.length > 0) {
      const { data: cached } = await sb
        .from("checkup_storage")
        .select("key,data")
        .eq("user_id", "00000000-0000-0000-0000-000000000000")
        .in("key", cacheKeys);
      const rows = new Map<string, any>();
      (cached || []).forEach((row: any) => {
        const code = String(row.key).replace('sparkline_v3_', '').replace(`_${day}`, '');
        rows.set(code, row?.data || {});
      });

      const plan = planCacheDecisions(codes, rows, expected, nowMs);
      for (const [c, d] of plan.serve) result[c] = entryFromData(d) as Entry;
      toFetch = plan.toFetch;
      prevData = plan.prev;
      cooldownServed = plan.cooldownServed;
    }

    log.info('cache_lookup', {
      total: codes.length,
      hits: codes.length - toFetch.length,
      toFetch: toFetch.length,
      expected,
      cooldown_served: cooldownServed,
    });

    const batchSize = 6;
    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((c) => coalesce(
        `sparkline:${c}:${expected}`,
        () => fetchTwDailyOhlc(c, { supa: sb as any }),
      )));
      const upserts: any[] = [];
      batch.forEach((c, idx) => {
        const r = results[idx];
        const ohlc = r?.bars || [];
        const nowIso = new Date().toISOString();
        const prev = prevData.get(c) ?? null;
        const row = buildUpsertRow(
          prev,
          { ohlc, source: r?.source ?? null, complete: r?.complete === true },
          nowIso,
        );

        if (ohlc.length >= 2) {
          result[c] = entryFromData(row) as Entry;
          if (row && row.complete !== true) {
            log.warn('sparkline_partial_history', {
              code: c, bars: ohlc.length, source: r?.source ?? null, attempts: r?.attempts,
            });
          }
        } else if (prev) {
          // provider 失敗：誠實保留舊 tradeDate / fetched_at，只寫 retry marker。
          result[c] = entryFromData(prev) as Entry;
          log.warn('sparkline_refetch_failed_serving_stale', {
            code: c, attempts: r?.attempts, stale_trade_date: result[c]?.tradeDate ?? null,
          });
        } else {
          result[c] = {
            ohlc: [], closes: [], source: r?.source ?? null,
            fetchedAt: nowIso, tradeDate: null, complete: false, barCount: 0,
          };
          log.warn('sparkline_all_sources_failed', { code: c, attempts: r?.attempts });
        }

        if (row) {
          upserts.push({
            user_id: "00000000-0000-0000-0000-000000000000",
            key: `sparkline_v3_${c}_${day}`,
            data: row,
          });
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
