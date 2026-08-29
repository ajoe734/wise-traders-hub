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
/** Stage 1 §C：request-scope DB/RPC 併發硬上限。禁止任何路徑繞過。 */
const MAX_DB_CONCURRENCY = 6;
/**
 * Stage 1 §A：code-level gate。batch path 分成三個 complete-await 階段
 * （bulk → stamp → payload），stamp 與 payload 永不重疊，
 * 故任一時刻 DB/RPC 峰值 = max(bulk 6, stamp 2*2=4, payload 6) = 6。
 */
const CODE_CONCURRENCY = 2;

/** bulk 取列上限；達上限視為 truncated，未命中的 stock 一律退回 per-code 查詢。 */
const BULK_ROW_LIMIT = 5000;

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
// Stage 1 §C：request-scope semaphore（hard max = MAX_DB_CONCURRENCY）
// ============================================================
// 註：callback 常回傳 supabase client 的 thenable（型別為 any），故用 `() => T`
// 搭配 `Awaited<T>` 推導，否則 T 會被推成 unknown，整個 batch path 都失去型別。
export type Sem = <T>(fn: () => T) => Promise<Awaited<T>>;

export function createSemaphore(max: number): Sem {
  let active = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < max) {
        active++;
        resolve();
        return;
      }
      // 排隊者由 release 端遞增 active，避免多個 waiter 同時被喚醒而超出上限。
      queue.push(() => {
        active++;
        resolve();
      });
    });
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };
  return async <T>(fn: () => T): Promise<Awaited<T>> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

// ============================================================
// Stage 1 §A/§B：batch-only context（POST batch path 才建立）
// ============================================================
export interface BatchCtx {
  rawSince: string;
  /** #4 done queue：stock → 已 done 的 trade_date 集合 */
  queueDone: Map<string, Set<string>>;
  queueDoneComplete: boolean;
  /** #8 queue 最新一列 */
  queueLatest: Map<string, any>;
  queueLatestComplete: boolean;
  /** #9 未解決失敗列（已依 trade_date desc、每股最多 10 列） */
  failures: Map<string, any[]>;
  failuresComplete: boolean;
  /** #11 upstream probe：多列時比照 maybeSingle 的錯誤語意視為 false */
  probe: Map<string, boolean>;
  probeComplete: boolean;
  /** #10 全域 market_batch config */
  marketBatchConfig: any;
  /** #12 全域 data_source_health */
  healthRows: any[];
  /** #13 per-date single-flight memo */
  snapshotByDate: Map<string, Promise<any>>;
}

export async function buildBatchCtx(supa: any, sem: Sem, ids: string[]): Promise<BatchCtx> {
  const rawSince = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);

  // 6 條 bulk，恰好用滿 semaphore；全部 await 完成後才進 code phase（兩階段不重疊）。
  const [doneRes, latestRes, failRes, cfgRes, probeRes, healthRes] = await Promise.all([
    sem(() =>
      supa
        .from("tw_bsr_sync_queue")
        .select("stock_id, trade_date")
        .in("stock_id", ids)
        .eq("status", "done")
        .gte("trade_date", rawSince)
        .limit(BULK_ROW_LIMIT)
    ),
    sem(() =>
      supa
        .from("tw_bsr_sync_queue")
        .select("stock_id, status, attempts, max_attempts, next_run_at, last_error, updated_at, trade_date")
        .in("stock_id", ids)
        .order("updated_at", { ascending: false })
        .limit(BULK_ROW_LIMIT)
    ),
    sem(() =>
      supa
        .from("tw_bsr_fetch_failures")
        .select("stock_id, trade_date, reason, attempts, resolved_at, next_retry_at, backoff_seconds, consecutive_failures, last_error, error_class")
        .in("stock_id", ids)
        .is("resolved_at", null)
        .order("trade_date", { ascending: false })
        .limit(BULK_ROW_LIMIT)
    ),
    sem(() =>
      supa
        .from("tw_bsr_sync_config")
        .select("config")
        .eq("key", "market_batch")
        .maybeSingle()
    ),
    sem(() =>
      supa
        .from("tw_bsr_upstream_probe")
        .select("stock_id, exhausted")
        .in("stock_id", ids)
        .limit(BULK_ROW_LIMIT)
    ),
    sem(() =>
      supa
        .from("data_source_health")
        .select("source, circuit_state, disabled_until, consecutive_failures, last_error_code")
        .in("source", ["finmind_bsr", "twse_t86"])
    ),
  ]);

  // 任一 bulk 失敗或被截斷 → 該類 complete=false，未命中的 stock 退回 per-code 查詢。
  const doneRows = (doneRes?.data ?? []) as any[];
  const queueDone = new Map<string, Set<string>>();
  for (const r of doneRows) {
    const k = String(r.stock_id);
    if (!queueDone.has(k)) queueDone.set(k, new Set<string>());
    queueDone.get(k)!.add(String(r.trade_date));
  }

  const latestRows = (latestRes?.data ?? []) as any[];
  const queueLatest = new Map<string, any>();
  for (const r of latestRows) {
    // 已依 updated_at desc 排序 → 每股第一次出現即為最新。
    const k = String(r.stock_id);
    if (!queueLatest.has(k)) {
      const { stock_id: _drop, ...rest } = r;
      queueLatest.set(k, rest);
    }
  }

  const failRows = (failRes?.data ?? []) as any[];
  const failures = new Map<string, any[]>();
  for (const r of failRows) {
    const k = String(r.stock_id);
    const arr = failures.get(k);
    if (arr) {
      if (arr.length < 10) arr.push(r);
    } else {
      failures.set(k, [r]);
    }
  }

  const probeRows = (probeRes?.data ?? []) as any[];
  const probeCount = new Map<string, number>();
  const probe = new Map<string, boolean>();
  for (const r of probeRows) {
    const k = String(r.stock_id);
    probeCount.set(k, (probeCount.get(k) ?? 0) + 1);
    probe.set(k, !!r.exhausted);
  }
  for (const [k, n] of probeCount) {
    // maybeSingle 在多列時回 error → 原行為為 false，這裡照抄。
    if (n > 1) probe.set(k, false);
  }

  return {
    rawSince,
    queueDone,
    queueDoneComplete: !doneRes?.error && doneRows.length < BULK_ROW_LIMIT,
    queueLatest,
    queueLatestComplete: !latestRes?.error && latestRows.length < BULK_ROW_LIMIT,
    failures,
    failuresComplete: !failRes?.error && failRows.length < BULK_ROW_LIMIT,
    probe,
    probeComplete: !probeRes?.error && probeRows.length < BULK_ROW_LIMIT,
    marketBatchConfig: cfgRes?.error ? null : (cfgRes?.data ?? null),
    healthRows: (healthRes?.data ?? []) as any[],
    snapshotByDate: new Map<string, Promise<any>>(),
  };
}


// ============================================================
// 單股 payload 建構（原 _shared/chipsDetailCore.ts 已內聯，避免部署工具遺漏新 shared 檔）
// ============================================================
async function buildChipsPayload(
  supa: any,
  stockId: string,
  sem: Sem,
  ctx: BatchCtx | null = null,
): Promise<any> {
  // ==== §D 併行區：五個彼此獨立、只依賴 stockId 的讀取 ====
  // 每一條都經 request-scope semaphore（hard max 6）；依賴鏈（raw dates→queue done、
  // fallbackAsOf→rollup、chosenAsOf→snapshot）仍留在後面依原順序執行。
  const rawSince = ctx?.rawSince ??
    new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);

  const qInst = () =>
    sem(() =>
      supa
        .from("tw_institutional_daily")
        .select("trade_date, foreign_net, trust_net, dealer_net, total_net")
        .eq("stock_id", stockId)
        .order("trade_date", { ascending: false })
        .limit(65)
    );
  const qRollup = () =>
    sem(() =>
      supa
        .from("tw_chips_rollup")
        .select("as_of_date, window_days, top_buy_brokers, top_sell_brokers, concentration_ratio, bsr_available")
        .eq("stock_id", stockId)
        .order("as_of_date", { ascending: false })
        .limit(20)
    );
  const qBsrDaily = () =>
    sem(() =>
      supa
        .from("tw_bsr_daily")
        .select("trade_date, broker_id, broker_name, buy_shares, sell_shares, net_shares")
        .eq("stock_id", stockId)
        .gte("trade_date", rawSince)
        .order("trade_date", { ascending: false })
        .limit(15000)
    );
  const qSeries = () =>
    sem(() => supa.rpc("get_bsr_daily_series", { _stock_id: stockId, _days: 60 }));
  const qElig = () => sem(() => supa.rpc("tw_bsr_eligibility", { p_stock_id: stockId }));

  let instRes: any, rollupRes: any, bsrDailyRes: any, seriesRes: any, eligRes: any;
  if (ctx) {
    [instRes, rollupRes, bsrDailyRes, seriesRes, eligRes] = await Promise.all([
      qInst(), qRollup(), qBsrDaily(), qSeries(), qElig(),
    ]);
  } else {
    // 無 batch ctx（single GET）：維持原本的逐條順序與 fail-fast 語意。
    instRes = await qInst();
    if (instRes.error) throw new Error(`DB_ERROR: ${instRes.error.message}`);
    rollupRes = await qRollup();
    bsrDailyRes = await qBsrDaily();
    seriesRes = await qSeries();
    eligRes = await qElig();
  }

  // ==== 三大法人 1/5/20/60 日 ====
  const { data: instRows, error: instErr } = instRes;
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
  const { data: rollupRows } = rollupRes;
  const rollupLatestAsOf: string | null = rollupRows?.[0]?.as_of_date || null;

  // ==== BSR raw daily（僅供 fallback 聚合 top_buy/top_sell 使用）====
  const { data: bsrDaily } = bsrDailyRes;
  const bsrRawRows = (bsrDaily || []) as any[];

  // ==== 序列與 eligibility（併行區結果，語意與原本相同）====
  const { data: dailySeries, error: seriesErr } = seriesRes;
  const { data: eligData } = eligRes;

  // ==== queue done set（判定 completeness 用）====
  const rawUniqueDatesDesc = Array.from(new Set(bsrRawRows.map((r) => r.trade_date))).sort(
    (a, b) => (a < b ? 1 : a > b ? -1 : 0),
  );
  const rawCandidatesForFallback = rawUniqueDatesDesc.slice(0, 20);
  // #4：done queue bulk（IN stock_id + trade_date >= rawSince 的超集），
  // 記憶體再依 per-code 的 rawCandidatesForFallback 交集過濾。
  const useBulkDone = !!ctx && (ctx.queueDoneComplete || ctx.queueDone.has(stockId));
  const { data: doneQueueRows } = useBulkDone
    ? { data: [] as any[] }
    : rawCandidatesForFallback.length
    ? await sem(() =>
      supa
        .from("tw_bsr_sync_queue")
        .select("trade_date, status")
        .eq("stock_id", stockId)
        .eq("status", "done")
        .in("trade_date", rawCandidatesForFallback)
    )
    : { data: [] as any[] };
  const bulkDoneDates = useBulkDone ? (ctx!.queueDone.get(stockId) ?? new Set<string>()) : null;
  const doneDateSet = bulkDoneDates
    ? new Set(rawCandidatesForFallback.filter((d) => bulkDoneDates.has(String(d))).map(String))
    : new Set((doneQueueRows || []).map((r: any) => String(r.trade_date)));

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
    // 依賴鏈保持原順序：fallbackAsOf 決定後才可發此查詢。
    const { data: rows } = await sem(() =>
      supa
        .from("tw_chips_rollup")
        .select("as_of_date, window_days, top_buy_brokers, top_sell_brokers, concentration_ratio, bsr_available")
        .eq("stock_id", stockId)
        .eq("as_of_date", asOf)
    );
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
  // 此 RPC 已在函式開頭與其他獨立讀取一起發出（見 §D 併行區）。
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
  // eligibility RPC 已在函式開頭與其他獨立讀取一起發出（見 §D 併行區）。
  const eligible = !!(eligData && (eligData as any).eligible);
  const ineligibleReason = eligible ? null : ((eligData as any)?.ineligible_reason ?? null);

  // #8：queue 最新一列 bulk（IN + updated_at desc），記憶體取每股最新。
  const { data: queueRows } = ctx && (ctx.queueLatestComplete || ctx.queueLatest.has(stockId))
    ? { data: ctx.queueLatest.has(stockId) ? [ctx.queueLatest.get(stockId)] : [] }
    : await sem(() =>
      supa
        .from("tw_bsr_sync_queue")
        .select("status, attempts, max_attempts, next_run_at, last_error, updated_at, trade_date")
        .eq("stock_id", stockId)
        .order("updated_at", { ascending: false })
        .limit(1)
    );
  const q = (queueRows && queueRows[0]) || null;

  const SAFE_REASON_CODES = new Set([
    "captcha_retry_exhausted", "finmind_error", "http_block",
    "no_chip_data", "not_chip_eligible", "rate_limited", "empty_rows",
  ]);
  // #9：未解決失敗列 bulk（IN + resolved_at is null），記憶體依 trade_date desc 取前 10。
  const { data: failRows } = ctx && (ctx.failuresComplete || ctx.failures.has(stockId))
    ? { data: ctx.failures.get(stockId) ?? [] }
    : await sem(() =>
      supa
        .from("tw_bsr_fetch_failures")
        .select("trade_date, reason, attempts, resolved_at, next_retry_at, backoff_seconds, consecutive_failures, last_error, error_class")

        .eq("stock_id", stockId)
        .is("resolved_at", null)
        .order("trade_date", { ascending: false })
        .limit(10)
    );

  // Provider capability is global, not stock-specific. The market-batch probe is the
  // authoritative persisted evidence for a plan-level rejection; per-stock failure rows
  // may only contain the later circuit-open symptom and must not downgrade terminal → unknown.
  // Raw config stays server-side; only the classifier's safe enum/code are returned.
  // #10：market_batch 是全域 config，batch 內每批只查一次。
  const { data: marketBatchConfig } = ctx
    ? { data: ctx.marketBatchConfig }
    : await sem(() =>
      supa
        .from("tw_bsr_sync_config")
        .select("config")
        .eq("key", "market_batch")
        .maybeSingle()
    );
  const marketBatch = (marketBatchConfig?.config ?? null) as Record<string, unknown> | null;
  // Stage C1 canonical admission gate (v8): the persisted gate itself is authoritative.
  const terminalGate = marketBatch?.admission_blocked === true &&
    String(marketBatch?.admission_terminal_code ?? "") === "bsr_provider_unsupported" &&
    String(marketBatch?.admission_reason ?? "") === "provider_plan_rejected";
  // Legacy probe shape stays supported verbatim (older config rows).
  const legacyUnsupported = marketBatch?.supported === false &&
    String(marketBatch?.last_probe_outcome ?? "") === "unsupported";
  const legacyPrefixHit = legacyUnsupported &&
    String(marketBatch?.last_probe_error ?? "").startsWith("unsupported_plan:");
  const marketBatchUnsupported = terminalGate || legacyUnsupported;
  const marketBatchErrorClass = (terminalGate || legacyPrefixHit)
    ? "provider_plan_rejected"
    : null;
  // Sanitised classifier input. Raw provider/plan text from config never leaves the server;
  // precedence: canonical admission gate > legacy prefixed probe > legacy unsupported probe.
  const marketBatchError: string | null = terminalGate
    ? "provider_plan_rejected"
    : legacyPrefixHit
    ? "unsupported_plan:redacted"
    : legacyUnsupported
    ? "unsupported"
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
    // #11：bulk 命中（或 bulk 完整而該股無列）時用記憶體結果；否則 per-code fallback。
    if (ctx && (ctx.probeComplete || ctx.probe.has(stockId))) {
      upstreamExhausted = ctx.probe.get(stockId) === true;
    } else {
      const { data: probe } = await sem(() =>
        supa
          .from("tw_bsr_upstream_probe")
          .select("exhausted")
          .eq("stock_id", stockId)
          .maybeSingle()
      );
      upstreamExhausted = !!probe?.exhausted;
    }
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
    // #12：全域來源健康，batch 內每批只查一次。
    const healthRows = ctx
      ? ctx.healthRows
      : (await sem(() =>
        supa
          .from('data_source_health')
          .select('source, circuit_state, disabled_until, consecutive_failures, last_error_code')
          .in('source', ['finmind_bsr', 'twse_t86'])
      )).data;
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
      // #13：snapshot status 只依 trade_date（與 stock 無關）→ batch 內 per-date
      // single-flight memoize；無 ctx 時維持原本每次查詢。
      const readSnapshot = () =>
        sem(async () => {
          const { data } = await supa
            .from('tw_bsr_daily_snapshot_status')
            .select('trade_date, status, sealed_at, sealed_by_lane, lane_a_status, lane_b_status, lane_c_status, coverage_stocks, coverage_brokers, updated_at')
            .eq('trade_date', chosenAsOf)
            .maybeSingle();
          return data ?? null;
        });
      let snapPromise: Promise<any>;
      if (ctx) {
        const memo = ctx.snapshotByDate.get(chosenAsOf);
        if (memo) {
          snapPromise = memo;
        } else {
          snapPromise = readSnapshot();
          ctx.snapshotByDate.set(chosenAsOf, snapPromise);
        }
      } else {
        snapPromise = readSnapshot();
      }
      const snap = await snapPromise;
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
// Batch helpers（Stage 1 §A：三階段 complete-await 排程）
// ============================================================
export interface BatchPhaseDeps {
  concurrency: number;
  computeStamp: (id: string) => Promise<string>;
  buildWithStamp: (id: string, stampVer: string) => Promise<any>;
}

export interface BatchPhaseOutcome {
  ok: boolean;
  id: string;
  value?: any;
  error?: string;
}

/**
 * 三階段排程。BEGIN/END 之間刻意寫成「無型別註記、不引用外部符號」的自足片段，
 * 讓 vitest 可以把它切出來直接 new Function 執行（真 runtime 驗證，不是字串比對）。
 */
export const runBatchPhases: (
  ids: string[],
  deps: BatchPhaseDeps,
) => Promise<BatchPhaseOutcome[]> =
  // --- BEGIN runBatchPhases (executable contract slice) ---
  async function (ids, deps) {
    const limit = Math.max(1, deps.concurrency);
    const stampVers = new Array(ids.length).fill(null);
    const errors = new Array(ids.length).fill(null);
    const values = new Array(ids.length).fill(null);

    // ---- stamp phase：只做 computeChipsStamp，全部 settled 後才可進 payload ----
    let si = 0;
    const stampWorker = async () => {
      while (si < ids.length) {
        const i = si++;
        try {
          stampVers[i] = await deps.computeStamp(ids[i]);
        } catch (err) {
          errors[i] = err instanceof Error ? err.message : String(err);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(limit, ids.length) }, stampWorker),
    );

    // ---- payload phase：只跑 stamp 成功的 code，且此階段不得再算 stamp ----
    const pending = ids
      .map((id, i) => ({ id, i }))
      .filter(({ i }) => errors[i] === null);
    let pi = 0;
    const payloadWorker = async () => {
      while (pi < pending.length) {
        const k = pi++;
        const { id, i } = pending[k];
        try {
          values[i] = await deps.buildWithStamp(id, stampVers[i]);
        } catch (err) {
          errors[i] = err instanceof Error ? err.message : String(err);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(limit, pending.length) }, payloadWorker),
    );

    // 輸出永遠依原 batch order
    return ids.map((id, i) =>
      errors[i] !== null
        ? { ok: false, id, error: errors[i] }
        : { ok: true, id, value: values[i] }
    );
  };
// --- END runBatchPhases ---

/** payload phase 專用：接受 precomputed stampVer，絕不呼叫 computeChipsStamp。 */
async function buildPayloadWithStamp(
  supa: any,
  stockId: string,
  stampVer: string,
  sem: Sem,
  ctx: BatchCtx | null,
): Promise<{ payload: any; stampVer: string }> {
  const cacheKey = `chips:${stockId}:${stampVer}`;
  let cached = cacheGet<any>(cacheKey);
  if (!cached) {
    cached = await buildChipsPayload(supa, stockId, sem, ctx);
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
    // Stage 1 §A/§C：request-scope DB/RPC semaphore，hard max=6。
    // computeChipsStamp 在 _shared（本輪禁改）不經 semaphore，但它只在
    // 獨立的 stamp phase 執行（<=2 worker × 2 query = 4），與 payload phase 不重疊。

    const sem = createSemaphore(MAX_DB_CONCURRENCY);

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
      // 無 batch ctx → 走原本的 per-code 查詢路徑（fallback 保留）。
      const payload = await coalesce(cacheKey, async () => buildChipsPayload(supa, singleId, sem, null));

      cacheSet(cacheKey, payload, CACHE_TTL_MS);

      return jsonResponse({
        ...payload,
        coalesced: coalescedHit,
        _cache_meta: { cache: coalescedHit ? 'coalesced' : 'miss', stamp_ver: stampVer, served_at: new Date().toISOString() },
      });
    }

    // Batch path — Stage 1 §A：三階段 complete-await
    //   1) bulk phase：buildBatchCtx（6 條，經 sem）完全結束；
    //   2) stamp phase：code concurrency=2，只做 computeChipsStamp（<=4 條並行）；
    //   3) payload phase：只跑 stamp 成功者，DB/RPC 全走 sem（<=6）。
    // stamp 與 payload 不重疊 → request 任一時刻 DB/RPC 峰值 <=6。
    const ctx = await buildBatchCtx(supa, sem, batchIds);
    const settled = await runBatchPhases(batchIds, {
      concurrency: CODE_CONCURRENCY,
      computeStamp: async (id) => (await computeChipsStamp(supa, id)).stampVer,
      buildWithStamp: (id, stampVer) => buildPayloadWithStamp(supa, id, stampVer, sem, ctx),
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
    return errorResponse(err instanceof Error ? err.message : String(err), 500, { code: "INTERNAL_ERROR" });
  }
});
