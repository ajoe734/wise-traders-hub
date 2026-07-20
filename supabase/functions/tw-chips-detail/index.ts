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
    let asOfLagDays: number | null = null;
    if (asOfDate) {
      const today = new Date(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Taipei",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
      );
      const asOf = new Date(asOfDate);
      asOfLagDays = Math.max(0, Math.round((today.getTime() - asOf.getTime()) / 86400000));
    }

    const payload = {
      stock_id: stockId,
      as_of: asOfDate,
      as_of_lag_days: asOfLagDays,
      institutional,
      bsr,
      bsr_as_of: latestAsOf,
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
