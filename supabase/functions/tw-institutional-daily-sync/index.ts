// deno-lint-ignore-file no-explicit-any
// tw-institutional-daily-sync
// 抓 TWSE T86（全市場三大法人買賣超日報）並落地到 tw_institutional_daily
// 呼叫方式：
//   GET /tw-institutional-daily-sync?date=YYYYMMDD           // 指定日
//   GET /tw-institutional-daily-sync                          // 預設今日（台北）
// 由 pg_cron 每交易日 17:45 排程呼叫。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 台北時區 YYYYMMDD
function taipeiToday(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now).replaceAll("-", ""); // YYYYMMDD
}

// YYYYMMDD -> YYYY-MM-DD
function toISODate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

// 解析 TWSE 數字字串（含逗號與負號括號）
function parseNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "" || s === "--") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// YYYYMMDD -/+ N 天
function shiftYmd(ymd: string, deltaDays: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6)) - 1;
  const d = Number(ymd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
}

function isWeekend(ymd: string): boolean {
  const dt = new Date(`${toISODate(ymd)}T00:00:00Z`);
  const dow = dt.getUTCDay();
  return dow === 0 || dow === 6;
}

async function fetchTwseT86(date: string) {
  const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALL&response=json`;
  const resp = await fetch(twseUrl, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LegendflowBot/1.0)",
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw new Error(`TWSE ${resp.status}`);
  const raw = await resp.json();
  return raw;
}

const FINMIND_URL = "https://api.finmindtrade.com/api/v4/data";
const FINMIND_TOKEN = Deno.env.get("FINMIND_TOKEN") ?? "";

// per-stock 多日回補：走 FinMind TaiwanStockInstitutionalInvestorsBuySell
async function backfillStockViaFinmind(
  supa: any,
  stockId: string,
  days: number,
): Promise<{ inserted: number; from: string; to: string; rows: number }> {
  const endD = new Date();
  const startD = new Date();
  startD.setUTCDate(startD.getUTCDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = fmt(startD);
  const endDate = fmt(endD);

  const p = new URLSearchParams({
    dataset: "TaiwanStockInstitutionalInvestorsBuySell",
    data_id: stockId,
    start_date: startDate,
    end_date: endDate,
  });
  if (FINMIND_TOKEN) p.set("token", FINMIND_TOKEN);

  const res = await fetch(`${FINMIND_URL}?${p}`, {
    signal: AbortSignal.timeout(25000),
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`finmind_http_${res.status}:${text.slice(0, 200)}`);
  const j = JSON.parse(text);
  if (j?.status !== 200 && !Array.isArray(j?.data)) {
    throw new Error(`finmind_api_${j?.status}:${String(j?.msg ?? "").slice(0, 200)}`);
  }
  const raw: any[] = Array.isArray(j.data) ? j.data : [];

  // FinMind 每天每個投資者類型一列 → 依 date 聚合
  const byDate = new Map<string, { fBuy: number; fSell: number; tBuy: number; tSell: number; dBuy: number; dSell: number }>();
  for (const r of raw) {
    const d = String(r.date || "");
    if (!d) continue;
    const cur = byDate.get(d) || { fBuy: 0, fSell: 0, tBuy: 0, tSell: 0, dBuy: 0, dSell: 0 };
    const name = String(r.name || "");
    const buy = Number(r.buy || 0);
    const sell = Number(r.sell || 0);
    if (name.startsWith("Foreign_Investor") || name === "Foreign_Investor" || name === "Foreign_Dealer_Self") {
      cur.fBuy += buy; cur.fSell += sell;
    } else if (name === "Investment_Trust") {
      cur.tBuy += buy; cur.tSell += sell;
    } else if (name.startsWith("Dealer")) {
      cur.dBuy += buy; cur.dSell += sell;
    }
    byDate.set(d, cur);
  }

  const chunk = Array.from(byDate.entries()).map(([date, v]) => {
    const foreign_net = v.fBuy - v.fSell;
    const trust_net = v.tBuy - v.tSell;
    const dealer_net = v.dBuy - v.dSell;
    return {
      stock_id: stockId,
      trade_date: date,
      foreign_net,
      trust_net,
      dealer_net,
      total_net: foreign_net + trust_net + dealer_net,
      raw: { source: "finmind_backfill" },
    };
  });

  if (chunk.length === 0) return { inserted: 0, from: startDate, to: endDate, rows: 0 };

  const { error } = await supa
    .from("tw_institutional_daily")
    .upsert(chunk, { onConflict: "stock_id,trade_date" });
  if (error) throw new Error(`upsert_failed:${error.message}`);
  return { inserted: chunk.length, from: startDate, to: endDate, rows: raw.length };
}

// ============================================================================
// PR-1: Cold-Start（一次性 60 日全市場回補；TWSE T86 bulk per-day，節流 1.2s/call）
// ============================================================================

const COLD_START_CONFIG_KEY = "cold_start_status";
const COLD_START_HEARTBEAT_MS = 30 * 60 * 1000; // 30 分鐘視為卡死可搶鎖
const COLD_START_SLEEP_MS = 1200; // 每次 TWSE 呼叫間隔
const COLD_START_MAX_DAYS = 90;

type ColdStartStatus = {
  state: "idle" | "running" | "done" | "error";
  days_done: number;
  days_total: number;
  cursor_date: string | null;
  started_at: string | null;
  finished_at: string | null;
  source: string | null;
  last_error?: string | null;
  attempts?: Array<{ date: string; ok: boolean; rows: number; reason?: string }>;
};

async function readColdStartStatus(supa: any): Promise<ColdStartStatus> {
  const { data, error } = await supa
    .from("tw_bsr_sync_config")
    .select("config, updated_at")
    .eq("key", COLD_START_CONFIG_KEY)
    .maybeSingle();
  if (error) throw new Error(`read_config_failed:${error.message}`);
  const cfg = (data?.config ?? {}) as ColdStartStatus;
  return {
    state: cfg.state ?? "idle",
    days_done: cfg.days_done ?? 0,
    days_total: cfg.days_total ?? 60,
    cursor_date: cfg.cursor_date ?? null,
    started_at: cfg.started_at ?? null,
    finished_at: cfg.finished_at ?? null,
    source: cfg.source ?? null,
    last_error: cfg.last_error ?? null,
    attempts: Array.isArray(cfg.attempts) ? cfg.attempts.slice(-20) : [],
  };
}

async function writeColdStartStatus(supa: any, patch: Partial<ColdStartStatus>) {
  const cur = await readColdStartStatus(supa);
  const next = { ...cur, ...patch } as ColdStartStatus;
  const { error } = await supa
    .from("tw_bsr_sync_config")
    .update({ config: next, updated_at: new Date().toISOString() })
    .eq("key", COLD_START_CONFIG_KEY);
  if (error) throw new Error(`write_config_failed:${error.message}`);
}

async function recordSourceHealth(
  supa: any,
  source: string,
  ok: boolean,
  latencyMs: number,
  errCode?: string,
) {
  // 讀-改-寫，失敗不阻擋主流程
  try {
    const { data } = await supa
      .from("data_source_health")
      .select("*")
      .eq("source", source)
      .maybeSingle();
    const now = new Date().toISOString();
    const cur = data ?? { ok_count_10m: 0, fail_count_10m: 0, consecutive_failures: 0 };
    const patch: Record<string, unknown> = {
      ok_count_10m: (cur.ok_count_10m ?? 0) + (ok ? 1 : 0),
      fail_count_10m: (cur.fail_count_10m ?? 0) + (ok ? 0 : 1),
      p95_latency_ms: latencyMs, // 簡化：以最近一次代表；後續 PR-7 會做真正 rolling
      consecutive_failures: ok ? 0 : (cur.consecutive_failures ?? 0) + 1,
      last_error_code: ok ? cur.last_error_code : (errCode ?? "unknown"),
      last_success_at: ok ? now : cur.last_success_at,
      last_failure_at: ok ? cur.last_failure_at : now,
      updated_at: now,
    };
    await supa.from("data_source_health").update(patch).eq("source", source);
  } catch { /* swallow — 觀測失敗不影響資料回補 */ }
}

// 從 ymd 往前列出 N 個工作日（跳過週末）
function planBusinessDates(startYmd: string, days: number): string[] {
  const out: string[] = [];
  let cur = startYmd;
  let guard = days * 3; // 保險上限
  while (out.length < days && guard-- > 0) {
    if (!isWeekend(cur)) out.push(cur);
    cur = shiftYmd(cur, -1);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function isAdminCaller(req: Request): Promise<{ ok: boolean; reason?: string }> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "missing_authorization" };
  // service_role token 允許（edge-to-edge / cron）
  if (token === SERVICE_ROLE_KEY) return { ok: true };
  // 否則以使用者身份呼叫 has_role
  try {
    const userClient = createClient(SUPABASE_URL, token, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user?.id) return { ok: false, reason: "invalid_jwt" };
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: hr, error } = await admin.rpc("has_role", {
      _user_id: u.user.id,
      _role: "company_admin",
    });
    if (error) return { ok: false, reason: `has_role_error:${error.message}` };
    return hr === true ? { ok: true } : { ok: false, reason: "not_admin" };
  } catch (err) {
    return { ok: false, reason: (err as Error).message.slice(0, 120) };
  }
}

async function runColdStart(
  supa: any,
  opts: { days: number; dryRun: boolean; resume: boolean; timeBudgetMs: number },
): Promise<Record<string, unknown>> {
  const status = await readColdStartStatus(supa);

  // 並行守衛：若 running 且心跳未逾時，拒絕；逾時視為卡死可搶
  if (status.state === "running" && status.started_at) {
    const age = Date.now() - new Date(status.started_at).getTime();
    if (age < COLD_START_HEARTBEAT_MS) {
      return {
        ok: false,
        code: "ALREADY_RUNNING",
        message: "cold-start 正在執行中，請稍候或等 30 分鐘心跳過期",
        status,
      };
    }
  }

  const today = taipeiToday();
  // 從昨日往前列 N 個工作日；resume 時若有 cursor 就從 cursor 起繼續
  const startFrom = opts.resume && status.cursor_date
    ? shiftYmd(status.cursor_date.replaceAll("-", ""), -1)
    : shiftYmd(today, -1);
  const plan = planBusinessDates(startFrom, opts.days);

  if (opts.dryRun) {
    return {
      ok: true,
      mode: "cold_start",
      dry_run: true,
      planned_dates: plan.map(toISODate),
      total: plan.length,
      throttle_ms: COLD_START_SLEEP_MS,
      estimated_seconds: Math.ceil((plan.length * COLD_START_SLEEP_MS) / 1000),
    };
  }

  const startedAt = new Date().toISOString();
  await writeColdStartStatus(supa, {
    state: "running",
    days_total: plan.length,
    days_done: opts.resume ? status.days_done : 0,
    cursor_date: null,
    started_at: startedAt,
    finished_at: null,
    source: "twse_t86",
    last_error: null,
    attempts: [],
  });

  const startWall = Date.now();
  const attempts: Array<{ date: string; ok: boolean; rows: number; reason?: string }> = [];
  let done = opts.resume ? status.days_done : 0;
  let stoppedReason: string | null = null;

  for (const ymd of plan) {
    if (Date.now() - startWall > opts.timeBudgetMs) {
      stoppedReason = "time_budget_exceeded";
      break;
    }
    const iso = toISODate(ymd);
    const t0 = Date.now();
    try {
      // 已有該日資料就跳過（idempotent）
      const { count } = await supa
        .from("tw_institutional_daily")
        .select("stock_id", { count: "exact", head: true })
        .eq("trade_date", iso);
      if ((count ?? 0) > 100) {
        attempts.push({ date: iso, ok: true, rows: count ?? 0, reason: "already_present" });
        done += 1;
        await writeColdStartStatus(supa, { days_done: done, cursor_date: iso, attempts });
        continue;
      }

      const raw = await fetchTwseT86(ymd);
      const latency = Date.now() - t0;
      const rows: any[][] = raw?.data ?? [];
      if (rows.length === 0) {
        attempts.push({ date: iso, ok: false, rows: 0, reason: raw?.stat || "no_data" });
        await recordSourceHealth(supa, "twse_t86", false, latency, "no_data");
      } else {
        // 直接使用主流程相同的欄位解析邏輯（複製自下方主分支，維持單一實作）
        const fields: string[] = raw?.fields || [];
        const idxOf = (kw: string) => fields.findIndex((f) => f && f.includes(kw));
        const iStock = idxOf("證券代號");
        const iForeignMain = idxOf("外陸資買賣超股數");
        const iForeignDealer = idxOf("外資自營商買賣超股數");
        const iTrust = idxOf("投信買賣超");
        const iDealer = fields.findIndex((f) => f === "自營商買賣超股數");
        const iDealerSelf = idxOf("自營商買賣超股數(自行買賣)");
        const iDealerHedge = idxOf("自營商買賣超股數(避險)");
        const iTotal = idxOf("三大法人買賣超");
        if (iStock < 0 || iForeignMain < 0 || iTrust < 0 || (iDealer < 0 && iDealerSelf < 0)) {
          attempts.push({ date: iso, ok: false, rows: rows.length, reason: "schema_drift" });
          await recordSourceHealth(supa, "twse_t86", false, latency, "schema_drift");
        } else {
          const BATCH = 500;
          let inserted = 0;
          for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH).map((r) => {
              const stock_id = String(r[iStock] || "").trim();
              const foreign_net = parseNum(r[iForeignMain]) + (iForeignDealer >= 0 ? parseNum(r[iForeignDealer]) : 0);
              const trust_net = parseNum(r[iTrust]);
              const dealer_net = iDealer >= 0
                ? parseNum(r[iDealer])
                : parseNum(r[iDealerSelf]) + (iDealerHedge >= 0 ? parseNum(r[iDealerHedge]) : 0);
              const total_net = iTotal >= 0 ? parseNum(r[iTotal]) : foreign_net + trust_net + dealer_net;
              return {
                stock_id, trade_date: iso, foreign_net, trust_net, dealer_net, total_net,
                raw: { source: "twse_t86_cold_start" },
              };
            }).filter((x) => x.stock_id);
            const { error } = await supa
              .from("tw_institutional_daily")
              .upsert(chunk, { onConflict: "stock_id,trade_date" });
            if (error) throw new Error(`upsert_failed:${error.message}`);
            inserted += chunk.length;
          }
          attempts.push({ date: iso, ok: true, rows: inserted });
          done += 1;
          await recordSourceHealth(supa, "twse_t86", true, latency);
        }
      }
    } catch (err) {
      const latency = Date.now() - t0;
      attempts.push({ date: iso, ok: false, rows: 0, reason: (err as Error).message.slice(0, 120) });
      await recordSourceHealth(supa, "twse_t86", false, latency, "fetch_error");
    }
    await writeColdStartStatus(supa, {
      days_done: done,
      cursor_date: iso,
      attempts: attempts.slice(-20),
      // heartbeat：refresh started_at 讓長跑期間不會被誤判卡死
      started_at: new Date().toISOString(),
    });
    await sleep(COLD_START_SLEEP_MS);
  }

  const finishedAt = new Date().toISOString();
  const finalState: ColdStartStatus["state"] = stoppedReason ? "running" : "done";
  await writeColdStartStatus(supa, {
    state: finalState,
    days_done: done,
    finished_at: stoppedReason ? null : finishedAt,
    // running 保留 started_at 心跳；done 才清空
    started_at: finalState === "done" ? startedAt : new Date().toISOString(),
    last_error: null,
  });

  return {
    ok: true,
    mode: "cold_start",
    dry_run: false,
    planned: plan.length,
    done,
    stopped_reason: stoppedReason,
    elapsed_ms: Date.now() - startWall,
    attempts: attempts.slice(-20),
  };
}

// ============================================================================
// PR-3: 三波 keep-warm — 交易日 15:30 / 17:30 / 19:30（台北）由 pg_cron 觸發
// 讀 flag → 若當日已有 T86 全市場（>100 筆）→ 短路；否則走 T86 bulk lookback。
// ============================================================================

const KEEP_WARM_CONFIG_KEY = "keep_warm_schedule";

type KeepWarmConfig = { enabled?: boolean; waves?: string[] };

async function runKeepWarm(
  supa: any,
  opts: { wave: string; force: boolean; lookback: number },
): Promise<Record<string, unknown>> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  // 讀 flag
  const { data: cfgRow } = await supa
    .from("tw_bsr_sync_config")
    .select("config")
    .eq("key", KEEP_WARM_CONFIG_KEY)
    .maybeSingle();
  const cfg = (cfgRow?.config ?? {}) as KeepWarmConfig;
  const enabled = cfg.enabled === true || opts.force;

  const today = taipeiToday();
  const iso = toISODate(today);
  const weekend = isWeekend(today);

  // flag 關閉或週末 → 短路（仍留 log 便於觀測）
  if (!enabled || weekend) {
    const reason = weekend ? "weekend" : "flag_disabled";
    await supa.from("data_source_refresh_logs").insert({
      source_key: "tw_keep_warm",
      status: "skipped",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: 0,
      row_count: 0,
      metadata: { run_id: runId, wave: opts.wave, reason, date: iso },
    });
    return { ok: true, mode: "keep_warm", skipped: true, reason, wave: opts.wave, date: iso };
  }

  // 短路：若當日已寫過 >100 筆，代表這波不需要再打 TWSE
  const { count: existingCount } = await supa
    .from("tw_institutional_daily")
    .select("stock_id", { count: "exact", head: true })
    .eq("trade_date", iso);
  if ((existingCount ?? 0) > 100 && !opts.force) {
    await supa.from("data_source_refresh_logs").insert({
      source_key: "tw_keep_warm",
      status: "skipped",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: 0,
      row_count: existingCount ?? 0,
      metadata: { run_id: runId, wave: opts.wave, reason: "already_present", date: iso },
    });
    return {
      ok: true, mode: "keep_warm", skipped: true, reason: "already_present",
      wave: opts.wave, date: iso, existing: existingCount,
    };
  }

  // T86 bulk lookback（含週末自動跳過）
  const attempts: Array<{ date: string; ok: boolean; rows: number; reason?: string }> = [];
  let raw: any = null;
  let resolvedYmd = today;
  const t0 = Date.now();
  for (let i = 0; i <= opts.lookback; i++) {
    const tryDate = shiftYmd(today, -i);
    if (isWeekend(tryDate)) {
      attempts.push({ date: tryDate, ok: false, rows: 0, reason: "weekend" });
      continue;
    }
    try {
      const r = await fetchTwseT86(tryDate);
      const rowCount = (r?.data || []).length;
      if (rowCount > 0) {
        raw = r; resolvedYmd = tryDate;
        attempts.push({ date: tryDate, ok: true, rows: rowCount });
        break;
      }
      attempts.push({ date: tryDate, ok: false, rows: 0, reason: r?.stat || "no_data" });
    } catch (err) {
      attempts.push({ date: tryDate, ok: false, rows: 0, reason: (err as Error).message.slice(0, 80) });
    }
  }
  const fetchLatency = Date.now() - t0;

  if (!raw) {
    await recordSourceHealth(supa, "twse_t86", false, fetchLatency, "no_data_in_lookback");
    await supa.from("data_source_refresh_logs").insert({
      source_key: "tw_keep_warm",
      status: "failed",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - Date.parse(startedAt),
      row_count: 0,
      error_message: "no_data_in_lookback",
      metadata: { run_id: runId, wave: opts.wave, date: iso, attempts },
    });
    return { ok: false, mode: "keep_warm", wave: opts.wave, reason: "no_data_in_lookback", attempts };
  }

  const fields: string[] = raw?.fields || [];
  const rows: any[][] = raw?.data || [];
  const idxOf = (kw: string) => fields.findIndex((f) => f && f.includes(kw));
  const iStock = idxOf("證券代號");
  const iForeignMain = idxOf("外陸資買賣超股數");
  const iForeignDealer = idxOf("外資自營商買賣超股數");
  const iTrust = idxOf("投信買賣超");
  const iDealer = fields.findIndex((f) => f === "自營商買賣超股數");
  const iDealerSelf = idxOf("自營商買賣超股數(自行買賣)");
  const iDealerHedge = idxOf("自營商買賣超股數(避險)");
  const iTotal = idxOf("三大法人買賣超");
  if (iStock < 0 || iForeignMain < 0 || iTrust < 0 || (iDealer < 0 && iDealerSelf < 0)) {
    await recordSourceHealth(supa, "twse_t86", false, fetchLatency, "schema_drift");
    await supa.from("data_source_refresh_logs").insert({
      source_key: "tw_keep_warm",
      status: "failed",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - Date.parse(startedAt),
      row_count: 0,
      error_message: "schema_drift",
      metadata: { run_id: runId, wave: opts.wave, date: iso, fields },
    });
    return { ok: false, mode: "keep_warm", wave: opts.wave, reason: "schema_drift" };
  }

  const tradeDate = toISODate(resolvedYmd);
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => {
      const stock_id = String(r[iStock] || "").trim();
      const foreign_net = parseNum(r[iForeignMain]) + (iForeignDealer >= 0 ? parseNum(r[iForeignDealer]) : 0);
      const trust_net = parseNum(r[iTrust]);
      const dealer_net = iDealer >= 0
        ? parseNum(r[iDealer])
        : parseNum(r[iDealerSelf]) + (iDealerHedge >= 0 ? parseNum(r[iDealerHedge]) : 0);
      const total_net = iTotal >= 0 ? parseNum(r[iTotal]) : foreign_net + trust_net + dealer_net;
      return {
        stock_id, trade_date: tradeDate, foreign_net, trust_net, dealer_net, total_net,
        raw: { source: `keep_warm:${opts.wave}` },
      };
    }).filter((x) => x.stock_id);
    const { error } = await supa
      .from("tw_institutional_daily")
      .upsert(chunk, { onConflict: "stock_id,trade_date" });
    if (error) {
      await recordSourceHealth(supa, "twse_t86", false, fetchLatency, "db_error");
      await supa.from("data_source_refresh_logs").insert({
        source_key: "tw_keep_warm",
        status: "failed",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - Date.parse(startedAt),
        row_count: inserted,
        error_message: `upsert_failed:${error.message}`,
        metadata: { run_id: runId, wave: opts.wave, date: tradeDate },
      });
      return { ok: false, mode: "keep_warm", wave: opts.wave, reason: `upsert_failed:${error.message}` };
    }
    inserted += chunk.length;
  }

  await recordSourceHealth(supa, "twse_t86", true, fetchLatency);
  await supa.from("data_source_refresh_logs").insert({
    source_key: "tw_keep_warm",
    status: "success",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - Date.parse(startedAt),
    row_count: inserted,
    metadata: { run_id: runId, wave: opts.wave, requested_date: iso, resolved_date: tradeDate, attempts },
  });

  return {
    ok: true, mode: "keep_warm", wave: opts.wave,
    requested_date: iso, resolved_date: tradeDate, inserted, attempts,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  try {
    const url = new URL(req.url);

    if (req.method === "POST") {
      let body: any = null;
      try { body = await req.json(); } catch { /* ignore */ }

      // === Mode: cold_start ===
      if (body?.mode === "cold_start") {
        const admin = await isAdminCaller(req);
        if (!admin.ok) {
          return errorResponse(`admin required: ${admin.reason ?? "unauthorized"}`, 403, { code: "FORBIDDEN" });
        }
        const days = Math.min(Math.max(Number(body.days) || 60, 1), COLD_START_MAX_DAYS);
        const dryRun = body.dry_run === true;
        const resume = body.resume === true;
        const timeBudgetMs = Math.min(Math.max(Number(body.time_budget_ms) || 240000, 30000), 300000);
        const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
        const result = await runColdStart(supa, { days, dryRun, resume, timeBudgetMs });
        return jsonResponse(result);
      }

      // === Mode: cold_start_status ===（純讀取，供 UI 輪詢）
      if (body?.mode === "cold_start_status") {
        const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
        const status = await readColdStartStatus(supa);
        return jsonResponse({ ok: true, status });
      }

      // === Mode: keep_warm ===（PR-3 三波 cron 觸發；service_role 或管理員）
      if (body?.mode === "keep_warm") {
        const admin = await isAdminCaller(req);
        if (!admin.ok) {
          return errorResponse(`admin required: ${admin.reason ?? "unauthorized"}`, 403, { code: "FORBIDDEN" });
        }
        const wave = String(body.wave || "manual").slice(0, 32);
        const force = body.force === true;
        const lookback = Math.min(Math.max(Number(body.lookback) || 3, 0), 7);
        const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
        const result = await runKeepWarm(supa, { wave, force, lookback });
        return jsonResponse(result);
      }

      // === Mode: backfill_stock ===（per-stock 60 天歷史回補）
      if (body?.mode === "backfill_stock") {
        const stockId = String(body.stock_id || "").trim();
        const days = Math.min(Math.max(Number(body.days) || 60, 1), 120);
        if (!/^[1-9]\d{3}$/.test(stockId)) {
          return errorResponse("stock_id must be 4-digit code starting 1-9", 400, { code: "BAD_REQUEST" });
        }
        const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
        try {
          const result = await backfillStockViaFinmind(supa, stockId, days);
          return jsonResponse({ mode: "backfill_stock", stock_id: stockId, ...result });
        } catch (err) {
          return errorResponse((err as Error).message, 502, { code: "FINMIND_ERROR" });
        }
      }
    }

    const requestedDate = url.searchParams.get("date") || taipeiToday();
    const lookback = Math.min(Math.max(Number(url.searchParams.get("lookback")) || 7, 0), 14);
    if (!/^\d{8}$/.test(requestedDate)) {
      return errorResponse("date must be YYYYMMDD", 400, { code: "BAD_REQUEST" });
    }

    // 逐日回退（含週末自動跳過），直到抓到資料或用盡 lookback
    const attempts: Array<{ date: string; ok: boolean; rows: number; reason?: string }> = [];
    let resolvedDate = requestedDate;
    let raw: any = null;
    for (let i = 0; i <= lookback; i++) {
      const tryDate = shiftYmd(requestedDate, -i);
      if (isWeekend(tryDate)) {
        attempts.push({ date: tryDate, ok: false, rows: 0, reason: "weekend" });
        continue;
      }
      try {
        const r = await fetchTwseT86(tryDate);
        const rowCount = (r?.data || []).length;
        if (rowCount > 0) {
          raw = r;
          resolvedDate = tryDate;
          attempts.push({ date: tryDate, ok: true, rows: rowCount });
          break;
        }
        attempts.push({ date: tryDate, ok: false, rows: 0, reason: r?.stat || "no_data" });
      } catch (err) {
        attempts.push({ date: tryDate, ok: false, rows: 0, reason: (err as Error).message.slice(0, 80) });
      }
    }

    if (!raw) {
      return jsonResponse({
        requested_date: requestedDate,
        resolved_date: null,
        inserted: 0,
        skipped: true,
        reason: "no_data_in_lookback",
        attempts,
      });
    }

    const fields: string[] = raw?.fields || [];
    const rows: any[][] = raw?.data || [];

    // 依 fields 動態找欄位 index（TWSE 偶爾調整名稱）
    const idxOf = (kw: string) => fields.findIndex((f) => f && f.includes(kw));
    const iStock = idxOf("證券代號");
    // 外資 = 外陸資買賣超（不含外資自營商） + 外資自營商買賣超
    const iForeignMain = idxOf("外陸資買賣超股數");
    const iForeignDealer = idxOf("外資自營商買賣超股數");
    const iTrust = idxOf("投信買賣超");
    // 自營商合計欄位（不含「自行買賣」「避險」細分）
    const iDealer = fields.findIndex((f) => f === "自營商買賣超股數");
    const iDealerSelf = idxOf("自營商買賣超股數(自行買賣)");
    const iDealerHedge = idxOf("自營商買賣超股數(避險)");
    const iTotal = idxOf("三大法人買賣超");

    if (iStock < 0 || iForeignMain < 0 || iTrust < 0 || (iDealer < 0 && iDealerSelf < 0)) {
      return errorResponse("fields layout unrecognized", 502, {
        code: "SCHEMA_DRIFT",
        fields,
      });
    }


    const tradeDate = toISODate(resolvedDate);
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => {
        const stock_id = String(r[iStock] || "").trim();
        const foreign_net = parseNum(r[iForeignMain]) + (iForeignDealer >= 0 ? parseNum(r[iForeignDealer]) : 0);
        const trust_net = parseNum(r[iTrust]);
        const dealer_net = iDealer >= 0
          ? parseNum(r[iDealer])
          : parseNum(r[iDealerSelf]) + (iDealerHedge >= 0 ? parseNum(r[iDealerHedge]) : 0);
        const total_net = iTotal >= 0 ? parseNum(r[iTotal]) : foreign_net + trust_net + dealer_net;
        return {
          stock_id,
          trade_date: tradeDate,
          foreign_net,
          trust_net,
          dealer_net,
          total_net,
          raw: { fields, row: r },
        };
      }).filter((x) => x.stock_id);


      const { error } = await supa
        .from("tw_institutional_daily")
        .upsert(chunk, { onConflict: "stock_id,trade_date" });
      if (error) {
        return errorResponse(`upsert failed: ${error.message}`, 500, { code: "DB_ERROR" });
      }
      inserted += chunk.length;
    }

    return jsonResponse({
      requested_date: toISODate(requestedDate),
      resolved_date: tradeDate,
      inserted,
      attempts,
      source: "TWSE_T86",
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500, { code: "INTERNAL_ERROR" });
  }
});

