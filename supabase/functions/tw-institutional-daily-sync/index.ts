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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date") || taipeiToday();
    if (!/^\d{8}$/.test(date)) {
      return errorResponse("date must be YYYYMMDD", 400, { code: "BAD_REQUEST" });
    }

    const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALL&response=json`;
    const resp = await fetch(twseUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LegendflowBot/1.0)",
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      return errorResponse(`TWSE ${resp.status}`, 502, { code: "UPSTREAM_ERROR" });
    }
    const raw = await resp.json();
    const fields: string[] = raw?.fields || [];
    const rows: any[][] = raw?.data || [];
    if (!rows.length) {
      return jsonResponse({ date, inserted: 0, skipped: true, reason: "no_data" });
    }

    // 依 fields 動態找欄位 index（TWSE 偶爾調整名稱）
    const idxOf = (kw: string) => fields.findIndex((f) => f && f.includes(kw));
    const iStock = idxOf("證券代號");
    const iForeign = fields.findIndex((f) => f.includes("外陸資買賣超股數") && !f.includes("不含"));
    const iForeignAlt = idxOf("外資買賣超");
    const iTrust = idxOf("投信買賣超");
    const iDealer = fields.findIndex((f) => f.includes("自營商買賣超股數") && !f.includes("避險") && !f.includes("自行"));
    const iDealerAlt = idxOf("自營商買賣超");
    const iTotal = idxOf("三大法人買賣超");

    const foreignIdx = iForeign >= 0 ? iForeign : iForeignAlt;
    const dealerIdx = iDealer >= 0 ? iDealer : iDealerAlt;

    if (iStock < 0 || foreignIdx < 0 || iTrust < 0 || dealerIdx < 0) {
      return errorResponse("fields layout unrecognized", 502, {
        code: "SCHEMA_DRIFT",
        fields,
      });
    }

    const tradeDate = toISODate(date);
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 分批 upsert（避免單次 payload 過大；TWSE 一天約 1800 檔）
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => {
        const stock_id = String(r[iStock] || "").trim();
        const foreign_net = parseNum(r[foreignIdx]);
        const trust_net = parseNum(r[iTrust]);
        const dealer_net = parseNum(r[dealerIdx]);
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

    return jsonResponse({ date: tradeDate, inserted, source: "TWSE_T86" });
  } catch (err) {
    return errorResponse((err as Error).message, 500, { code: "INTERNAL_ERROR" });
  }
});
