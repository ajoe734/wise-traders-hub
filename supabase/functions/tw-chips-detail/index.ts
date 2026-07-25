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
  LOW_QUALITY_BROKER_THRESHOLD,
} from "../_shared/bsrRollup.ts";
import { expectedLatestBsrDate, weekdayDiff } from "../_shared/tradingDate.ts";
import { resolveAllWindows, type WindowReadiness } from "../_shared/seriesReadiness.ts";

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

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Cache key includes latest rollup as_of_date so any new fulfillment auto-busts.
    // Fetch that stamp cheaply first; if unavailable, fall back to a version-less key
    // and rely on TTL alone.
    const { data: stampRow } = await supa
      .from("tw_chips_rollup")
      .select("as_of_date, updated_at")
      .eq("stock_id", stockId)
      .eq("window_days", 5)
      .order("as_of_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const stampVer = stampRow ? `${stampRow.as_of_date}:${stampRow.updated_at}` : "v0";
    const cacheKey = `chips:${stockId}:${stampVer}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) {
      return jsonResponse({
        ...cached,
        cached: true,
        _cache_meta: { cache: 'hit', stamp_ver: stampVer, served_at: new Date().toISOString() },
      });
    }

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

    // ==== BSR raw daily（僅供 fallback 聚合 top_buy/top_sell 使用）====
    // 序列與 readiness 不再走 raw：改讀 get_bsr_daily_series RPC，避免 PostgREST row cap 截斷。
    // 窗口固定近 14 天：14 × ~750 brokers ≈ 10.5k rows，遠低於任何 cap，且足以覆蓋 fallback 判斷。
    const rawSince = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    const { data: bsrDaily } = await supa
      .from("tw_bsr_daily")
      .select("trade_date, broker_id, broker_name, buy_shares, sell_shares, net_shares")
      .eq("stock_id", stockId)
      .gte("trade_date", rawSince)
      .order("trade_date", { ascending: false })
      .limit(15000);
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
      // 取「以 fallbackAsOf 為最新、往前 N 個已收錄 raw 交易日」聚合
      // 三個窗口一致由 computeBsrWindow 現算，保證 concentration 永遠有值可顯示。
      const idx = rawUniqueDatesDesc.indexOf(fallbackAsOf!);
      const tail = rawUniqueDatesDesc.slice(idx);
      for (const win of [5, 20, 60] as const) {
        const windowDates = pickWindowDates(tail, win);
        const w = computeBsrWindow(bsrRawRows, windowDates);
        if (w) {
          bsr[`d${win}`] = {
            top_buy: w.top_buy,
            top_sell: w.top_sell,
            concentration_ratio: w.concentration_ratio,
          };
        }
      }
    }

    // ==== 三大法人序列 ====
    const instAsc = [...instAll].reverse().slice(-60).map((r) => ({
      date: r.trade_date,
      foreign_net: Number(r.foreign_net || 0),
      trust_net: Number(r.trust_net || 0),
      dealer_net: Number(r.dealer_net || 0),
      total_net: Number(r.total_net || 0),
    }));

    // ==== BSR 每日集中度序列（改由 rollup RPC 供給，讀取成本 O(days)）====
    // 過去用 raw broker rows 現算，會被 PostgREST row cap 截斷（熱門股一天 700+ 分點，
    // 60 天 4 萬列 → cap 只保留前 1000 列 = 前 1~2 天，前端誤顯示「補齊中 2/5」）。
    // 現在直接讀 tw_chips_rollup(window_days=5) 的 concentration_ratio + broker_count，
    // 一日一列、60 列以內，與寫入端（persistAggregated）單一來源。
    type DailySeriesRow = {
      trade_date: string;
      concentration_ratio: number | null;
      broker_count: number | null;
      low_quality: boolean | null;
    };
    const { data: dailySeries, error: seriesErr } = await supa.rpc(
      "get_bsr_daily_series",
      { _stock_id: stockId, _days: 60 },
    );
    if (seriesErr) console.warn("[chips-detail] get_bsr_daily_series failed:", seriesErr.message);
    const bsrConcentration = ((dailySeries || []) as DailySeriesRow[])
      .map((r) => ({
        date: String(r.trade_date),
        concentration_ratio: r.concentration_ratio != null ? Number(r.concentration_ratio) : null,
        top_net: 0, // 保留欄位（舊消費者），實際值僅 fallback 需要，已由 bsr.d5.top_buy 覆蓋
        broker_count: Number(r.broker_count ?? 0),
        low_quality: !!r.low_quality,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const asOfDate = instAll[0]?.trade_date || null;

    // PR-5：新股 fast-lane — 若三大法人完全無資料（可能是新掛牌或觀察名單新股），
    // 且 stock_id 是 4 位純數字（排除權證/ETF+字母後綴），best-effort 觸發入列。
    // 入列 RPC 內部會檢查 fastlane flag 與每日上限，這裡不做二次守門。
    if (!asOfDate && /^[1-9]\d{3}$/.test(stockId)) {
      supa.rpc("enqueue_institutional_new_stock", { _stock_id: stockId })
        .then(({ error }) => {
          if (error) console.warn("[chips-detail] fastlane enqueue failed:", error.message);
        });
    }

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

    // ==== Readiness（M1：讓 UI 有唯一真相判斷 5/20/60 日視窗是否夠畫線）====
    // 三大法人 valid = 有 trade_date 的日期即為 valid（單日就是一個資料點）。
    const instValidDatesAsc = instAsc.map((r) => r.date);
    // M4：BSR valid dates 直接來自 bsrConcentration（源自 rollup），與序列同源，
    // 徹底消除「series 有 N 天但 readiness.have=M」的 split-brain。
    const bsrValidDatesAsc = bsrConcentration
      .filter((p) => (p.broker_count ?? 0) >= DONE_BROKER_THRESHOLD)
      .map((p) => p.date);
    const bsrLowQualityDates = new Set(
      bsrConcentration.filter((p) => p.low_quality).map((p) => p.date),
    );

    // M2：讀 upstream_probe 判斷是否上游窮竭
    let upstreamExhausted = false;
    try {
      const { data: probe } = await supa
        .from("tw_bsr_upstream_probe")
        .select("exhausted")
        .eq("stock_id", stockId)
        .maybeSingle();
      upstreamExhausted = !!probe?.exhausted;
    } catch (_e) { /* 非致命 */ }

    // PR-8：上游熔斷狀態帶入 payload，讓前端 5 態機能提早顯示 upstream_outage 與冷卻時間
    let upstreamCircuit: {
      any_open: boolean;
      sources: Record<string, {
        state: 'closed' | 'open' | 'half_open';
        disabled_until: string | null;
        consecutive_failures: number;
        last_error_code: string | null;
      }>;
    } = { any_open: false, sources: {} };
    try {
      const { data: healthRows } = await supa
        .from('data_source_health')
        .select('source, circuit_state, disabled_until, consecutive_failures, last_error_code')
        .in('source', ['finmind_bsr', 'twse_t86']);
      for (const r of (healthRows || []) as any[]) {
        const st = (r.circuit_state ?? 'closed') as 'closed' | 'open' | 'half_open';
        upstreamCircuit.sources[String(r.source)] = {
          state: st,
          disabled_until: r.disabled_until ?? null,
          consecutive_failures: Number(r.consecutive_failures ?? 0),
          last_error_code: r.last_error_code ?? null,
        };
        if (st === 'open') upstreamCircuit.any_open = true;
      }
    } catch (_e) { /* 非致命 */ }

    const instReadiness = resolveAllWindows({
      validDatesAsc: instValidDatesAsc,
      upstreamExhausted: false, // 三大法人由 TWSE 直供，不用 finmind 探測
    });
    const bsrReadiness = resolveAllWindows({
      validDatesAsc: bsrValidDatesAsc,
      upstreamExhausted,
    });


    // M4：頂層低品質旗標 = 目前顯示的 chosenAsOf 該日 broker count（源自 rollup）< 門檻
    const chosenSeriesPoint = chosenAsOf ? bsrConcentration.find((p) => p.date === chosenAsOf) : null;
    const chosenBrokerCount = chosenSeriesPoint?.broker_count ?? (chosenAsOf ? (rowCountByDate.get(chosenAsOf) ?? 0) : 0);
    const bsrLowQuality = !!chosenAsOf && chosenBrokerCount > 0 && chosenBrokerCount < LOW_QUALITY_BROKER_THRESHOLD;

    // 契約 invariant：readiness.have 必須等於 series 中有效點數；不相等即為 bug，寫警告日誌。
    const seriesValidCount = bsrValidDatesAsc.length;
    if (bsrReadiness["5"].have !== seriesValidCount) {
      console.error("[chips-detail] READINESS_SERIES_MISMATCH", {
        stockId,
        readiness_have: bsrReadiness["5"].have,
        series_valid: seriesValidCount,
        series_len: bsrConcentration.length,
      });
    }

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
      bsr_low_quality_threshold: LOW_QUALITY_BROKER_THRESHOLD,
      bsr_low_quality: bsrLowQuality,
      bsr_broker_count: chosenBrokerCount,
      bsr_low_quality_dates: Array.from(bsrLowQualityDates),
      bsr_last_failure: bsrLastFailure,
      bsr_sync_status: bsrSyncStatus,
      series: {
        institutional_daily: instAsc,
        bsr_concentration: bsrConcentration.slice(-60),
      },
      readiness: {
        institutional: instReadiness,
        bsr_concentration: bsrReadiness,
      },
      source: "TWSE",
      fetched_at: new Date().toISOString(),
    };

    cacheSet(cacheKey, payload, CACHE_TTL_MS);
    return jsonResponse({
      ...payload,
      _cache_meta: { cache: 'miss', stamp_ver: stampVer, served_at: new Date().toISOString() },
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500, { code: "INTERNAL_ERROR" });
  }
});
