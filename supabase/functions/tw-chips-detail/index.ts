// deno-lint-ignore-file no-explicit-any
// tw-chips-detail
// 前端唯一查詢入口：回傳單一 stock_id 的籌碼摘要（三大法人 1/5/20/60 日 + BSR top brokers + 集中度）。
//
// 本次修訂（S11「昨日 fallback」）：
//   - BSR 來源不再只看 tw_chips_rollup。若最新 rollup 已落後預期交易日，
//     且 tw_bsr_daily 有更新且 complete 的原始資料，則以「raw_fallback」形式
//     計算近 5 日視窗（d20/d60 保留 null，因為 rollup 才有那些欄位）。
//   - `bsr_source`、`bsr_freshness_status`、`bsr_lag_weekdays`、`bsr_expected_date`
//     為前端顯示「顯示昨天的、今日同步中」提示的唯一依據。
//   - completeness 定義：該日 raw broker rows >= 5。queue.status='done' 只作診斷輔助，
//     不可單獨證明完整，避免歷史 fake-done 狀態讓畫面誤顯示今日空資料。
//     未 complete 的今日 partial data 不會被推為 fallbackAsOf，避免覆蓋昨日完整結果。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { cacheGet, cacheSet } from "../_shared/memoryCache.ts";
import {
  computeBsrWindow,
  countRowsByDate,
  pickCompleteFallbackDate,
  pickWindowDates,
  DONE_BROKER_THRESHOLD,
} from "../_shared/bsrRollup.ts";
import { expectedLatestBsrDate, weekdayDiff } from "../_shared/tradingDate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CACHE_TTL_MS = 5 * 60 * 1000;

type BsrSource = "rollup" | "raw_fallback" | null;
type BsrFreshness =
  | "ineligible"
  | "fresh"
  | "syncing"
  | "sync_failed"
  | "lagging"
  | "not_queued"
  | "no_data";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  try {
    const url = new URL(req.url);
    const stockId = (url.searchParams.get("stock_id") || "").trim();
    if (!/^[0-9A-Za-z]{3,10}$/.test(stockId)) {
      return errorResponse("stock_id required", 400, { code: "BAD_REQUEST" });
    }

    const cacheKey = `chips:${stockId}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) return jsonResponse({ ...cached, cached: true });

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ==== 三大法人 1/5/20/60 日 ====
    const { data: instRows, error: instErr } = await supa
      .from("tw_institutional_daily")
      .select("trade_date, foreign_net, trust_net, dealer_net, total_net")
      .eq("stock_id", stockId)
      .order("trade_date", { ascending: false })
      .limit(65);
    if (instErr) return errorResponse(instErr.message, 500, { code: "DB_ERROR" });

    const windows = [1, 5, 20, 60] as const;
    const institutional: Record<string, any> = {};
    const instAll = instRows || [];
    for (const w of windows) {
      const slice = instAll.slice(0, w);
      institutional[`d${w}`] = slice.length
        ? {
            foreign_net: slice.reduce((s, r) => s + Number(r.foreign_net || 0), 0),
            trust_net: slice.reduce((s, r) => s + Number(r.trust_net || 0), 0),
            dealer_net: slice.reduce((s, r) => s + Number(r.dealer_net || 0), 0),
            total_net: slice.reduce((s, r) => s + Number(r.total_net || 0), 0),
            days_covered: slice.length,
          }
        : null;
    }

    // ==== BSR rollup（formal，含 d5/d20/d60）====
    const { data: rollupRows } = await supa
      .from("tw_chips_rollup")
      .select("as_of_date, window_days, top_buy_brokers, top_sell_brokers, concentration_ratio, bsr_available")
      .eq("stock_id", stockId)
      .order("as_of_date", { ascending: false })
      .limit(12);
    const rollupLatestAsOf: string | null = rollupRows?.[0]?.as_of_date || null;

    // ==== BSR raw daily（同時給 fallback 與集中度序列用）====
    const { data: bsrDaily } = await supa
      .from("tw_bsr_daily")
      .select("trade_date, broker_id, broker_name, buy_shares, sell_shares, net_shares")
      .eq("stock_id", stockId)
      .order("trade_date", { ascending: false })
      .limit(30000);
    const bsrRawRows = (bsrDaily || []) as any[];

    // ==== queue done set（判定 completeness 用）====
    const rawUniqueDatesDesc = Array.from(new Set(bsrRawRows.map((r) => r.trade_date))).sort(
      (a, b) => (a < b ? 1 : a > b ? -1 : 0),
    );
    const rawCandidatesForFallback = rawUniqueDatesDesc.slice(0, 20);
    const { data: doneQueueRows } = rawCandidatesForFallback.length
      ? await supa
          .from("tw_bsr_sync_queue")
          .select("trade_date, status")
          .eq("stock_id", stockId)
          .eq("status", "done")
          .in("trade_date", rawCandidatesForFallback)
      : { data: [] as any[] };
    const doneDateSet = new Set((doneQueueRows || []).map((r: any) => String(r.trade_date)));

    const rowCountByDate = countRowsByDate(bsrRawRows);
    const fallbackCandidates = rawCandidatesForFallback.map((d) => ({
      date: d,
      rowCount: rowCountByDate.get(d) ?? 0,
    }));
    const fallbackAsOf = pickCompleteFallbackDate(fallbackCandidates, doneDateSet);

    // ==== 決定 BSR 資料來源與 as_of ====
    const nowMs = Date.now();
    const expectedDate = expectedLatestBsrDate(nowMs);

    let bsrSource: BsrSource = null;
    let chosenAsOf: string | null = null;
    const bsr: Record<string, any> = { d5: null, d20: null, d60: null };

    // rollup 已經是最新期望日 → 直接用 rollup
    // 否則若 fallbackAsOf 存在且比 rollup 新 → 用 raw_fallback
    // 其他情況 → 用 rollup（若有）作為降級
    const rollupIsCurrent = !!rollupLatestAsOf && rollupLatestAsOf >= expectedDate;
    const fallbackNewer = !!fallbackAsOf && (!rollupLatestAsOf || fallbackAsOf > rollupLatestAsOf);

    if (rollupIsCurrent || (!fallbackNewer && rollupLatestAsOf)) {
      bsrSource = "rollup";
      chosenAsOf = rollupLatestAsOf;
      for (const r of (rollupRows || []).filter(
        (x: any) => x.as_of_date === rollupLatestAsOf && x.bsr_available,
      )) {
        bsr[`d${r.window_days}`] = {
          top_buy: r.top_buy_brokers,
          top_sell: r.top_sell_brokers,
          concentration_ratio: r.concentration_ratio,
        };
      }
    } else if (fallbackNewer) {
      bsrSource = "raw_fallback";
      chosenAsOf = fallbackAsOf;
      // 取「以 fallbackAsOf 為最新、往前 5 個已收錄 raw 交易日」聚合
      const idx = rawUniqueDatesDesc.indexOf(fallbackAsOf!);
      const windowDates = pickWindowDates(rawUniqueDatesDesc.slice(idx), 5);
      const w5 = computeBsrWindow(bsrRawRows, windowDates);
      if (w5) {
        bsr.d5 = {
          top_buy: w5.top_buy,
          top_sell: w5.top_sell,
          concentration_ratio: w5.concentration_ratio,
        };
      }
      // d20 / d60 仍需 rollup 才有，這裡刻意保留 null（前端不會顯示；trend chart 走 series）
    }

    // ==== 三大法人序列 ====
    const instAsc = [...instAll].reverse().slice(-60).map((r) => ({
      date: r.trade_date,
      foreign_net: Number(r.foreign_net || 0),
      trust_net: Number(r.trust_net || 0),
      dealer_net: Number(r.dealer_net || 0),
      total_net: Number(r.total_net || 0),
    }));

    // ==== BSR 每日集中度序列（Top15 by net desc → sum(max(net,0)) / totalBuy）====
    // 說明：這條序列僅供 trend chart。集中度定義沿用歷史行為（不改），
    //      避免影響 UI 面板數字；rollup / raw_fallback 的 concentration_ratio 由 computeBsrWindow 保證一致。
    const byDate = new Map<string, Array<{ broker_id: string; buy: number; net: number }>>();
    for (const r of bsrRawRows) {
      const d = r.trade_date as string;
      const arr = byDate.get(d) || [];
      arr.push({ broker_id: r.broker_id, buy: Number(r.buy_shares || 0), net: Number(r.net_shares || 0) });
      byDate.set(d, arr);
    }
    const bsrConcentration: Array<{ date: string; concentration_ratio: number | null; top_net: number }> = [];
    for (const [d, arr] of byDate) {
      const totalBuy = arr.reduce((s, x) => s + x.buy, 0);
      const top15 = [...arr].sort((a, b) => b.net - a.net).slice(0, 15);
      const top15Buy = top15.reduce((s, x) => s + Math.max(x.net, 0), 0);
      const ratio = totalBuy > 0 ? (top15Buy / totalBuy) * 100 : null;
      const topNet = top15.reduce((s, x) => s + x.net, 0);
      bsrConcentration.push({ date: d, concentration_ratio: ratio, top_net: topNet });
    }
    bsrConcentration.sort((a, b) => a.date.localeCompare(b.date));

    const asOfDate = instAll[0]?.trade_date || null;
    // 三大法人的 lag 沿用日曆日；BSR 的 lag 改用 weekday。
    const todayTPE = new Date(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    const calDays = (d: string | null) =>
      d ? Math.max(0, Math.round((todayTPE.getTime() - new Date(d).getTime()) / 86400000)) : null;
    const asOfLagDays = calDays(asOfDate);
    const bsrAsOfLagDays = calDays(chosenAsOf);
    const bsrLagWeekdays = chosenAsOf ? weekdayDiff(chosenAsOf, expectedDate) : null;

    // ==== Eligibility + Queue status ====
    const { data: eligData } = await supa.rpc("tw_bsr_eligibility", { p_stock_id: stockId });
    const eligible = !!(eligData && (eligData as any).eligible);
    const ineligibleReason = eligible ? null : ((eligData as any)?.ineligible_reason ?? null);

    const { data: queueRows } = await supa
      .from("tw_bsr_sync_queue")
      .select("status, attempts, max_attempts, next_run_at, last_error, updated_at, trade_date")
      .eq("stock_id", stockId)
      .order("updated_at", { ascending: false })
      .limit(1);
    const q = (queueRows && queueRows[0]) || null;

    const SAFE_REASON_CODES = new Set([
      "captcha_retry_exhausted", "finmind_error", "http_block",
      "no_chip_data", "not_chip_eligible", "rate_limited", "empty_rows",
    ]);
    const { data: failRows } = await supa
      .from("tw_bsr_fetch_failures")
      .select("trade_date, reason, attempts, resolved_at, next_retry_at, backoff_seconds, consecutive_failures")
      .eq("stock_id", stockId)
      .is("resolved_at", null)
      .order("trade_date", { ascending: false })
      .limit(10);

    let bsrLastFailure:
      | {
          trade_date: string;
          error_code: string;
          attempts: number;
          next_retry_at: string | null;
          backoff_seconds: number | null;
          consecutive_failures: number | null;
          last_successful_as_of: string | null;
          lookback_from: string | null;
          lookback_to: string | null;
          lookback_days: number | null;
        }
      | null = null;
    if (failRows && failRows[0]) {
      const f: any = failRows[0];
      // 只要失敗日期比目前顯示日期新，就當成「延遲診斷」出示。
      if (!chosenAsOf || String(f.trade_date) > String(chosenAsOf)) {
        const dates = (failRows as any[])
          .map((r) => String(r.trade_date))
          .filter((d) => !chosenAsOf || d > String(chosenAsOf))
          .sort();
        const lookbackTo = dates[0] || String(f.trade_date);
        const lookbackFrom = String(f.trade_date);
        const spanDays =
          lookbackFrom && lookbackTo
            ? Math.max(1, Math.round((new Date(lookbackFrom).getTime() - new Date(lookbackTo).getTime()) / 86400000) + 1)
            : null;
        const code = SAFE_REASON_CODES.has(String(f.reason)) ? String(f.reason) : "sync_failed";
        bsrLastFailure = {
          trade_date: f.trade_date,
          error_code: code,
          attempts: Number(f.attempts || 0),
          next_retry_at: f.next_retry_at || null,
          backoff_seconds: f.backoff_seconds ?? null,
          consecutive_failures: f.consecutive_failures ?? null,
          last_successful_as_of: chosenAsOf || null,
          lookback_from: lookbackFrom,
          lookback_to: lookbackTo,
          lookback_days: spanDays,
        };
      }
    }

    type BsrStatus = "pending" | "running" | "failed" | "dead" | "not_queued" | "ineligible";
    let status: BsrStatus;
    if (!eligible) status = "ineligible";
    else if (!q) status = "not_queued";
    else if (q.status === "pending" || q.status === "running") status = q.status;
    else if (q.status === "failed") {
      status = Number(q.attempts || 0) >= Number(q.max_attempts || 5) ? "dead" : "failed";
    } else status = "not_queued";

    // ==== freshness 語意映射（前端顯示用）====
    // 優先序：ineligible → fresh → syncing → sync_failed → lagging → not_queued → no_data
    let freshness: BsrFreshness;
    if (!eligible) freshness = "ineligible";
    else if (chosenAsOf && chosenAsOf >= expectedDate) freshness = "fresh";
    else if (status === "pending" || status === "running") freshness = "syncing";
    else if (status === "failed" || status === "dead") freshness = "sync_failed";
    else if (chosenAsOf) freshness = "lagging";
    else if (status === "not_queued") freshness = "not_queued";
    else freshness = "no_data";

    const bsrSyncStatus = {
      eligible,
      ineligible_reason: ineligibleReason,
      asset_class: (eligData as any)?.asset_class ?? null,
      queued: !!q && (q.status === "pending" || q.status === "running"),
      status,
      next_run_at: q?.next_run_at ?? null,
      attempts: Number(q?.attempts ?? 0),
      max_attempts: Number(q?.max_attempts ?? 5),
      error_code: bsrLastFailure?.error_code ?? null,
      retryable: status === "pending" || status === "running" || status === "failed",
    };

    const payload = {
      stock_id: stockId,
      as_of: asOfDate,
      as_of_lag_days: asOfLagDays,
      institutional,
      bsr,
      bsr_as_of: chosenAsOf,
      bsr_as_of_lag_days: bsrAsOfLagDays,
      bsr_source: bsrSource,
      bsr_expected_date: expectedDate,
      bsr_lag_weekdays: bsrLagWeekdays,
      bsr_freshness_status: freshness,
      bsr_completeness_threshold: DONE_BROKER_THRESHOLD,
      bsr_last_failure: bsrLastFailure,
      bsr_sync_status: bsrSyncStatus,
      series: {
        institutional_daily: instAsc,
        bsr_concentration: bsrConcentration.slice(-60),
      },
      source: "TWSE",
      fetched_at: new Date().toISOString(),
    };

    cacheSet(cacheKey, payload, CACHE_TTL_MS);
    return jsonResponse(payload);
  } catch (err) {
    return errorResponse((err as Error).message, 500, { code: "INTERNAL_ERROR" });
  }
});
