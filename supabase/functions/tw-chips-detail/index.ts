// deno-lint-ignore-file no-explicit-any
// tw-chips-detail
// 前端唯一查詢入口：回傳單一 stock_id 的籌碼摘要（三大法人 1/5/20/60 日 + BSR top brokers + 集中度）
// PR-1 只回傳三大法人；BSR 欄位為 null（前端顯示「— 資料尚未更新」）
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { cacheGet, cacheSet } from "../_shared/memoryCache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CACHE_TTL_MS = 5 * 60 * 1000;

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

    // 抓最近 65 個交易日的三大法人資料，再折算 1/5/20/60 日
    const { data: instRows, error: instErr } = await supa
      .from("tw_institutional_daily")
      .select("trade_date, foreign_net, trust_net, dealer_net, total_net")
      .eq("stock_id", stockId)
      .order("trade_date", { ascending: false })
      .limit(65);

    if (instErr) return errorResponse(instErr.message, 500, { code: "DB_ERROR" });

    const windows = [1, 5, 20, 60] as const;
    const institutional: Record<string, any> = {};
    const rows = instRows || [];
    for (const w of windows) {
      const slice = rows.slice(0, w);
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

    // BSR rollup（PR-1 尚未有資料，會回 null）
    const { data: rollupRows } = await supa
      .from("tw_chips_rollup")
      .select("as_of_date, window_days, top_buy_brokers, top_sell_brokers, concentration_ratio, bsr_available")
      .eq("stock_id", stockId)
      .order("as_of_date", { ascending: false })
      .limit(4);

    const bsr: Record<string, any> = { d5: null, d20: null, d60: null };
    const latestAsOf = rollupRows?.[0]?.as_of_date || null;
    if (rollupRows && latestAsOf) {
      for (const r of rollupRows.filter((x) => x.as_of_date === latestAsOf && x.bsr_available)) {
        bsr[`d${r.window_days}`] = {
          top_buy: r.top_buy_brokers,
          top_sell: r.top_sell_brokers,
          concentration_ratio: r.concentration_ratio,
        };
      }
    }

    // ==== 歷史序列（供前端趨勢圖 / 播放）====
    const instAsc = [...rows].reverse().slice(-60).map((r) => ({
      date: r.trade_date,
      foreign_net: Number(r.foreign_net || 0),
      trust_net: Number(r.trust_net || 0),
      dealer_net: Number(r.dealer_net || 0),
      total_net: Number(r.total_net || 0),
    }));

    // BSR 每日集中度（Top15 買超淨額 / 總買量）
    const { data: bsrRows } = await supa
      .from("tw_bsr_daily")
      .select("trade_date, broker_id, buy_shares, net_shares")
      .eq("stock_id", stockId)
      .order("trade_date", { ascending: true })
      .limit(20000);

    const byDate = new Map<string, Array<{ broker_id: string; buy: number; net: number }>>();
    for (const r of bsrRows || []) {
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

    const asOfDate = rows[0]?.trade_date || null;
    const todayTPE = new Date(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    const lagDays = (d: string | null) =>
      d ? Math.max(0, Math.round((todayTPE.getTime() - new Date(d).getTime()) / 86400000)) : null;

    const asOfLagDays = lagDays(asOfDate);
    const bsrAsOfLagDays = lagDays(latestAsOf);

    // ==== Eligibility + Queue status（純讀取，不寫入）====
    const { data: eligData } = await supa.rpc("tw_bsr_eligibility", { p_stock_id: stockId });
    const eligible = !!(eligData && (eligData as any).eligible);
    const ineligibleReason = eligible ? null : ((eligData as any)?.ineligible_reason ?? null);

    const { data: queueRows } = await supa
      .from("tw_bsr_sync_queue")
      .select("status, attempts, max_attempts, next_run_at, last_error, updated_at")
      .eq("stock_id", stockId)
      .order("updated_at", { ascending: false })
      .limit(1);
    const q = (queueRows && queueRows[0]) || null;

    // 錯誤原文映射為對外安全 error_code（白名單）
    const SAFE_REASON_CODES = new Set([
      "captcha_retry_exhausted", "finmind_error", "http_block",
      "no_chip_data", "not_chip_eligible", "rate_limited", "empty_rows",
    ]);
    // 最近一次 BSR 抓取失敗（未 resolved）
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
      if (!latestAsOf || String(f.trade_date) > String(latestAsOf)) {
        const dates = (failRows as any[])
          .map((r) => String(r.trade_date))
          .filter((d) => !latestAsOf || d > String(latestAsOf))
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
          last_successful_as_of: latestAsOf || null,
          lookback_from: lookbackFrom,
          lookback_to: lookbackTo,
          lookback_days: spanDays,
        };
      }
    }

    // 決定對外 status
    type BsrStatus = "pending" | "running" | "failed" | "dead" | "not_queued" | "ineligible";
    let status: BsrStatus;
    if (!eligible) status = "ineligible";
    else if (!q) status = "not_queued";
    else if (q.status === "pending" || q.status === "running") status = q.status;
    else if (q.status === "failed") {
      status = Number(q.attempts || 0) >= Number(q.max_attempts || 5) ? "dead" : "failed";
    } else status = "not_queued"; // done / skipped

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
      bsr_as_of: latestAsOf,
      bsr_as_of_lag_days: bsrAsOfLagDays,
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
