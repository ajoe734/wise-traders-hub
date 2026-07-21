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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  try {
    const url = new URL(req.url);

    // === Mode: backfill_stock ===（per-stock 60 天歷史回補）
    if (req.method === "POST") {
      let body: any = null;
      try { body = await req.json(); } catch { /* ignore */ }
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

