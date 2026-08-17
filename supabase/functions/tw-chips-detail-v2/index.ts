// AUTH: public
// deno-lint-ignore-file no-explicit-any
// tw-chips-detail-v2 (READ-ONLY side-by-side endpoint)
// 契約與舊 tw-chips-detail 完全相同，唯一差異：移除所有 write / rebuild / enqueue。
//   - 不呼叫任何 writer RPC
//   - 不註冊 DB inflight hook（原版會寫 finmind inflight 表）
// 前端唯一籌碼查詢入口：支援單一 stock_id（GET/POST）與多股 batch（stock_ids）。
// 回傳單一 stock_id 的完整籌碼摘要（三大法人 1/5/20/60 日 + BSR top brokers + 集中度）。
// 僅讀公開市場資料表；不需要使用者身份，避免 demo/匿名模式因 anon JWT 無 sub 被誤擋。

import { serviceClient } from '../_shared/supabaseClients.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { cacheGet, cacheSet } from "../_shared/memoryCache.ts";
import { coalesce, setCoalesceObserver } from "../_shared/requestCoalescer.ts";
import { computeChipsStamp } from "../_shared/chipsStamp.ts";
import {
  countRowsByDate,
  pickCompleteFallbackDate,
  DONE_BROKER_THRESHOLD,
  LOW_QUALITY_BROKER_THRESHOLD,
} from "../_shared/bsrRollup.ts";
import { expectedLatestBsrDate, weekdayDiff } from "../_shared/tradingDate.ts";
import { resolveAllWindows } from "../_shared/seriesReadiness.ts";
import { classifyBsrProvider } from "../_shared/bsrProviderState.ts";


const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_BATCH = 30;

type BsrSource = "rollup" | "raw_fallback" | null;
type BsrFreshness =
  | "ineligible"
  | "fresh"
  | "syncing"
  | "sync_failed"
  | "lagging"
  | "not_queued"
  | "no_data";

type DailySeriesRow = {
  trade_date: string;
  concentration_ratio: number | null;
  broker_count: number | null;
  low_quality: boolean | null;
};

// ============================================================
// 單股 payload 建構（原 _shared/chipsDetailCore.ts 已內聯，避免部署工具遺漏新 shared 檔）
// ============================================================
async function buildChipsPayload(supa: any, stockId: string): Promise<any> {
  // ==== 三大法人 1/5/20/60 日 ====
  const { data: instRows, error: instErr } = await supa
    .from("tw_institutional_daily")
    .select("trade_date, foreign_net, trust_net, dealer_net, total_net")
    .eq("stock_id", stockId)
    .order("trade_date", { ascending: false })
    .limit(65);
  if (instErr) throw new Error(`DB_ERROR: ${instErr.message}`);

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
    .limit(20);
  const rollupLatestAsOf: string | null = rollupRows?.[0]?.as_of_date || null;

  // ==== BSR raw daily（僅供 fallback 聚合 top_buy/top_sell 使用）====
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
  const bsr: Record<string, any> = { d1: null, d5: null, d10: null, d20: null, d60: null };

  const rollupIsCurrent = !!rollupLatestAsOf && rollupLatestAsOf >= expectedDate;
  const fallbackNewer = !!fallbackAsOf && (!rollupLatestAsOf || fallbackAsOf > rollupLatestAsOf);

  const fillFromRollupRows = (rows: any[], asOf: string) => {
    for (const r of rows.filter((x: any) => x.as_of_date === asOf && x.bsr_available)) {
      bsr[`d${r.window_days}`] = {
        top_buy: r.top_buy_brokers,
        top_sell: r.top_sell_brokers,
        concentration_ratio: r.concentration_ratio,
      };
    }
  };
  const readRollupForDate = async (asOf: string) => {
    // READ-ONLY：只 SELECT 既有 rollup，不觸發任何 writer RPC。
    const { data: rows } = await supa
      .from("tw_chips_rollup")
      .select("as_of_date, window_days, top_buy_brokers, top_sell_brokers, concentration_ratio, bsr_available")
      .eq("stock_id", stockId)
      .eq("as_of_date", asOf);
    fillFromRollupRows(rows || [], asOf);
  };

  if (rollupIsCurrent || (!fallbackNewer && rollupLatestAsOf)) {
    bsrSource = "rollup";
    chosenAsOf = rollupLatestAsOf;
    fillFromRollupRows(rollupRows || [], rollupLatestAsOf!);
    // READ-ONLY：缺 d1/d10 也不重建，留 null 由 freshness 語意表達。
  } else if (fallbackNewer) {
    bsrSource = "raw_fallback";
    chosenAsOf = fallbackAsOf;
    await readRollupForDate(fallbackAsOf!);
  }

  // ==== 三大法人序列 ====
  const instAsc = [...instAll].reverse().slice(-60).map((r) => ({
    date: r.trade_date,
    foreign_net: Number(r.foreign_net || 0),
    trust_net: Number(r.trust_net || 0),
    dealer_net: Number(r.dealer_net || 0),
    total_net: Number(r.total_net || 0),
  }));

  // ==== BSR 每日集中度序列 ====
  const { data: dailySeries, error: seriesErr } = await supa.rpc(
    "get_bsr_daily_series",
    { _stock_id: stockId, _days: 60 },
  );
  if (seriesErr) console.warn("[chips-detail] get_bsr_daily_series failed:", seriesErr.message);
  const bsrConcentration = ((dailySeries || []) as DailySeriesRow[])
    .map((r) => ({
      date: String(r.trade_date),
      concentration_ratio: r.concentration_ratio != null ? Number(r.concentration_ratio) : null,
      top_net: 0,
      broker_count: Number(r.broker_count ?? 0),
      low_quality: !!r.low_quality,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const asOfDate = instAll[0]?.trade_date || null;

  // 三大法人的 lag 沿用日曆日；BSR 的 lag 改用工作日。
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
    .select("trade_date, reason, attempts, resolved_at, next_retry_at, backoff_seconds, consecutive_failures, last_error, error_class")

    .eq("stock_id", stockId)
    .is("resolved_at", null)
    .order("trade_date", { ascending: false })
    .limit(10);

  // Provider capability is global, not stock-specific. The market-batch probe is the
  // authoritative persisted evidence for a plan-level rejection; per-stock failure rows
  // may only contain the later circuit-open symptom and must not downgrade terminal → unknown.
  // Raw config stays server-side; only the classifier's safe enum/code are returned.
  const { data: marketBatchConfig } = await supa
    .from("tw_bsr_sync_config")
    .select("config")
    .eq("key", "market_batch")
    .maybeSingle();
  const marketBatch = (marketBatchConfig?.config ?? null) as Record<string, unknown> | null;
  const marketBatchUnsupported = marketBatch?.supported === false &&
    String(marketBatch?.last_probe_outcome ?? "") === "unsupported";
  const marketBatchError = marketBatchUnsupported
    ? String(marketBatch?.last_probe_error ?? "")
    : null;
  const marketBatchErrorClass = marketBatchError?.startsWith("unsupported_plan:")
    ? "provider_plan_rejected"
    : null;

  let bsrLastFailure: any = null;
  if (failRows && failRows[0]) {
    const f: any = failRows[0];
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

  // ==== freshness 語意映射 ====
  let freshness: BsrFreshness;
  if (!eligible) freshness = "ineligible";
  else if (chosenAsOf && chosenAsOf >= expectedDate) freshness = "fresh";
  else if (status === "pending" || status === "running") freshness = "syncing";
  else if (status === "failed" || status === "dead") freshness = "sync_failed";
  else if (chosenAsOf) freshness = "lagging";
  else if (status === "not_queued") freshness = "not_queued";
  else freshness = "no_data";

  // ==== 上游 provider 三態分類（Plan v2 §2）====
  // 舊行為：queue pending 就叫「同步中／下輪自動重試」，但 FinMind 400 register-level
  // 是永久資格拒絕，重試不會好。改由 shared classifier 決定，UI 只讀 server enum。
  const freshData = !!(chosenAsOf && chosenAsOf >= expectedDate);
  const topFail: any = (failRows && failRows[0]) || null;
  const rawErrForClass = freshData
    ? null
    : (topFail?.last_error ?? null) || (q?.last_error && String(q.last_error) !== "quota_deferred"
      ? String(q.last_error)
      : null);
  const providerVerdict = classifyBsrProvider({
    eligible,
    bsrAsOf: chosenAsOf ?? null,
    expectedDate,
    queueStatus: (q?.status as any) ?? null,
    lastErrorRaw: marketBatchError ?? rawErrForClass,
    persistedErrorClass: marketBatchErrorClass ?? topFail?.error_class ?? null,
    attempts: Number(q?.attempts ?? 0),
    maxAttempts: Number(q?.max_attempts ?? 5),
  });

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
    // retryable 現在由 verdict 決定：terminal 拒絕一律 false。
    retryable: providerVerdict.retryable,
    provider_state: providerVerdict.state,
    provider_code: providerVerdict.code,
    retry_promised: providerVerdict.nextRetryAllowed,
  };

  // terminal / unknown 時不得對外承諾 next_retry_at
  if (bsrLastFailure && !providerVerdict.nextRetryAllowed) {
    bsrLastFailure.next_retry_at = null;
  }


  // ==== Readiness ====
  const instValidDatesAsc = instAsc.map((r) => r.date);
  const bsrValidDatesAsc = bsrConcentration
    .filter((p) => (p.broker_count ?? 0) >= DONE_BROKER_THRESHOLD)
    .map((p) => p.date);
  const bsrLowQualityDates = new Set(
    bsrConcentration.filter((p) => p.low_quality).map((p) => p.date),
  );

  let upstreamExhausted = false;
  try {
    const { data: probe } = await supa
      .from("tw_bsr_upstream_probe")
      .select("exhausted")
      .eq("stock_id", stockId)
      .maybeSingle();
    upstreamExhausted = !!probe?.exhausted;
  } catch (_e) { /* 非致命 */ }

  // PR-8：上游熔斷狀態
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
    upstreamExhausted: false,
  });
  const bsrReadiness = resolveAllWindows({
    validDatesAsc: bsrValidDatesAsc,
    upstreamExhausted,
  });

  const chosenSeriesPoint = chosenAsOf ? bsrConcentration.find((p) => p.date === chosenAsOf) : null;
  const chosenBrokerCount = chosenSeriesPoint?.broker_count ?? (chosenAsOf ? (rowCountByDate.get(chosenAsOf) ?? 0) : 0);
  const bsrLowQuality = !!chosenAsOf && chosenBrokerCount > 0 && chosenBrokerCount < LOW_QUALITY_BROKER_THRESHOLD;

  // invariant check
  const seriesValidCount = bsrValidDatesAsc.length;
  if (bsrReadiness["5"].have !== seriesValidCount) {
    console.error("[chips-detail] READINESS_SERIES_MISMATCH", {
      stockId,
      readiness_have: bsrReadiness["5"].have,
      series_valid: seriesValidCount,
      series_len: bsrConcentration.length,
    });
  }

  // P3：snapshot 5 態
  let snapshotState: 'sealed' | 'partial' | 'stale' | 'missing' | 'ineligible' = 'missing';
  let snapshotStatus: any = null;
  if (!eligible) {
    snapshotState = 'ineligible';
  } else if (chosenAsOf) {
    try {
      const { data: snap } = await supa
        .from('tw_bsr_daily_snapshot_status')
        .select('trade_date, status, sealed_at, sealed_by_lane, lane_a_status, lane_b_status, lane_c_status, coverage_stocks, coverage_brokers, updated_at')
        .eq('trade_date', chosenAsOf)
        .maybeSingle();
      snapshotStatus = snap ?? null;
      if (snap?.sealed_at) {
        snapshotState = 'sealed';
      } else if (snap) {
        const lagWd = bsrLagWeekdays ?? 0;
        snapshotState = lagWd > 2 ? 'stale' : 'partial';
      } else {
        snapshotState = 'missing';
      }
    } catch (_e) { /* 非致命 */ }
  }

  const bsrSourceDate = chosenAsOf ?? null;
  const bsrFallbackUsed = bsrSource === 'raw_fallback' ||
    (chosenAsOf && expectedDate && chosenAsOf < expectedDate) ||
    false;

  return {
    stock_id: stockId,
    as_of: asOfDate,
    as_of_lag_days: asOfLagDays,
    institutional,
    bsr,
    bsr_as_of: chosenAsOf,
    bsr_as_of_lag_days: bsrAsOfLagDays,
    bsr_source: bsrSource,
    bsr_source_date: bsrSourceDate,
    bsr_fallback_used: bsrFallbackUsed,
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
    // additive（Plan v2 Stage A）：前端唯一可信的上游狀態來源
    bsr_provider_state: providerVerdict.state,
    bsr_provider_code: providerVerdict.code,
    bsr_retry_promised: providerVerdict.nextRetryAllowed,
    bsr_has_stale_data: providerVerdict.hasStaleData,

    series: {
      institutional_daily: instAsc,
      bsr_concentration: bsrConcentration.slice(-60),
    },
    readiness: {
      institutional: instReadiness,
      bsr_concentration: bsrReadiness,
      sealed: !!snapshotStatus?.sealed_at,
      sealed_at: snapshotStatus?.sealed_at ?? null,
      sealed_by_lane: snapshotStatus?.sealed_by_lane ?? null,
    },
    upstream_circuit: upstreamCircuit,
    snapshot_state: snapshotState,
    snapshot_status: snapshotStatus,
    source: "TWSE",
    _readonly: true,
    fetched_at: new Date().toISOString(),
  };
}

// ============================================================
// Batch helpers
// ============================================================
async function withConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<any>): Promise<any[]> {
  const results: any[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        results[i] = err;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function buildOne(supa: any, stockId: string): Promise<{ payload: any; stampVer: string }> {
  const stamp = await computeChipsStamp(supa, stockId);
  const stampVer = stamp.stampVer;
  const cacheKey = `chips:${stockId}:${stampVer}`;
  let cached = cacheGet<any>(cacheKey);
  if (!cached) {
    cached = await buildChipsPayload(supa, stockId);
    cacheSet(cacheKey, cached, CACHE_TTL_MS);
  }
  return {
    payload: {
      ...cached,
      cached: true,
      _cache_meta: { cache: 'hit', stamp_ver: stampVer, served_at: new Date().toISOString() },
    },
    stampVer,
  };
}

// ============================================================
// HTTP router
// ============================================================
function isValidId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9A-Za-z]{3,10}$/.test(v.trim());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse("method not allowed", 405, { code: "METHOD_NOT_ALLOWED" });
  }

  try {
    let body: any = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }

    const url = new URL(req.url);
    const singleFromUrl = (url.searchParams.get("stock_id") || "").trim();
    const batchFromUrl = (url.searchParams.get("stock_ids") || "").trim();

    let singleId: string | null = null;
    if (singleFromUrl && isValidId(singleFromUrl)) singleId = singleFromUrl;
    if (!singleId && body?.stock_id && isValidId(body.stock_id)) {
      singleId = body.stock_id.trim();
    }

    let batchIds: string[] = [];
    if (batchFromUrl) {
      batchIds = batchFromUrl.split(/[,，\s]+/).filter(isValidId);
    }
    if (Array.isArray(body?.stock_ids)) {
      batchIds = body.stock_ids.map((v: unknown) => String(v ?? "").trim()).filter(isValidId);
    }
    batchIds = batchIds.slice(0, MAX_BATCH);
    const isBatch = batchIds.length > 0;

    if (!singleId && !isBatch) {
      return errorResponse("stock_id or stock_ids required", 400, { code: "BAD_REQUEST" });
    }
    if (isBatch && batchIds.length !== new Set(batchIds).size) {
      return errorResponse("duplicate stock_ids", 400, { code: "BAD_REQUEST" });
    }

    const supa = serviceClient();

    // Single stock path (keeps original response shape + stamp_only + coalescing)
    if (!isBatch && singleId) {
      const stamp = await computeChipsStamp(supa, singleId);
      const stampVer = stamp.stampVer;

      if (url.searchParams.get("stamp_only") === "1") {
        return jsonResponse({
          stock_id: singleId,
          stamp_ver: stampVer,
          chips_as_of: stamp.chipsAsOf,
          inst_as_of: stamp.instAsOf,
          served_at: new Date().toISOString(),
        });
      }

      const cacheKey = `chips:${singleId}:${stampVer}`;
      const cached = cacheGet<any>(cacheKey);
      if (cached) {
        return jsonResponse({
          ...cached,
          cached: true,
          _cache_meta: { cache: 'hit', stamp_ver: stampVer, served_at: new Date().toISOString() },
        });
      }

      let coalescedHit = false;
      setCoalesceObserver((m) => { if (m.key === cacheKey && m.hit) coalescedHit = true; });
      // READ-ONLY：不註冊 DB inflight hook。
      const payload = await coalesce(cacheKey, async () => buildChipsPayload(supa, singleId));

      cacheSet(cacheKey, payload, CACHE_TTL_MS);

      return jsonResponse({
        ...payload,
        coalesced: coalescedHit,
        _cache_meta: { cache: coalescedHit ? 'coalesced' : 'miss', stamp_ver: stampVer, served_at: new Date().toISOString() },
      });
    }

    // Batch path
    const settled = await withConcurrency(batchIds, 3, async (id) => {
      try {
        return { ok: true, id, value: await buildOne(supa, id) };
      } catch (err) {
        return { ok: false, id, error: (err as Error).message };
      }
    });

    const results: Record<string, any> = {};
    const errors: Record<string, string> = {};
    for (const r of settled) {
      if (r.ok) {
        results[r.id] = r.value.payload;
      } else {
        errors[r.id] = r.error;
      }
    }

    return jsonResponse({
      results,
      errors,
      count: Object.keys(results).length,
      failed: Object.keys(errors).length,
      served_at: new Date().toISOString(),
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500, { code: "INTERNAL_ERROR" });
  }
});
