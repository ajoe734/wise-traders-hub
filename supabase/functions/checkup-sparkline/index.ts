// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { applyCoercion } from "../_shared/inputCoerce.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TWSE_DAY = "https://www.twse.com.tw/exchangeReport/STOCK_DAY";
// TPEX 新版 API（2024 改版後）：回 JSON，欄位 tables[0].data
// 舊路徑 st43_result.php 已停用，造成上櫃股 sparkline 全空。
const TPEX_DAY = "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock";

function ymd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchWithTimeout(url: string, ms = 7000): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
}

// TWSE 一個月的收盤；月初若無資料退回上一個月
async function twseMonth(code: string, d: Date): Promise<number[]> {
  const date = ymd(d);
  const url = `${TWSE_DAY}?response=json&date=${date}&stockNo=${encodeURIComponent(code)}`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return [];
  let json: any;
  try { json = await res.json(); } catch { return []; }
  const rows: any[] = json?.data || [];
  if (!rows.length) return [];
  return rows
    .map((r) => Number(String(r[6]).replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function twseRecent(code: string): Promise<number[]> {
  const now = new Date();
  let closes = await twseMonth(code, now);
  // 月初不足 2 筆 → 退回上一個月補
  if (closes.length < 2) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevCloses = await twseMonth(code, prev);
    closes = [...prevCloses, ...closes];
  }
  return closes.slice(-5);
}

// TPEX 新版：tradingStock?date=YYYY/MM&code=XXXX&response=json
async function tpexMonth(code: string, d: Date): Promise<number[]> {
  const ym = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const url = `${TPEX_DAY}?date=${encodeURIComponent(ym)}&code=${encodeURIComponent(code)}&response=json&_=${Date.now()}`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return [];
  let json: any;
  try { json = await res.json(); } catch { return []; }
  // 新版 schema: { tables: [{ data: [[date, qty, amt, open, high, low, close, ...]] }] }
  const tables = json?.tables;
  let rows: any[] = [];
  if (Array.isArray(tables) && tables.length > 0 && Array.isArray(tables[0]?.data)) {
    rows = tables[0].data;
  } else if (Array.isArray(json?.data)) {
    rows = json.data;
  } else if (Array.isArray(json?.aaData)) {
    rows = json.aaData; // 舊版相容
  }
  if (!rows.length) return [];
  return rows
    .map((r) => Number(String(r[6]).replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function tpexRecent(code: string): Promise<number[]> {
  const now = new Date();
  let closes = await tpexMonth(code, now);
  if (closes.length < 2) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevCloses = await tpexMonth(code, prev);
    closes = [...prevCloses, ...closes];
  }
  return closes.slice(-5);
}

async function fetchSparkline(code: string): Promise<number[]> {
  const c = String(code).trim();
  if (!c) return [];
  const a = await twseRecent(c);
  if (a.length >= 2) return a;
  const b = await tpexRecent(c);
  return b;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    const codes = (codesRaw as unknown[])
      .map((v) => String(v).trim())
      .filter((v) => /^\d{4,6}[A-Z]?$/i.test(v))
      .slice(0, 30);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const day = todayKey();
    const result: Record<string, number[]> = {};
    const toFetch: string[] = [];

    // Cache lookup — 只把「有資料（length >= 2）」的視為有效快取
    const cacheKeys = codes.map((c) => `sparkline_${c}_${day}`);
    if (cacheKeys.length > 0) {
      const { data: cached } = await sb
        .from("checkup_storage")
        .select("key,data")
        .eq("user_id", "00000000-0000-0000-0000-000000000000")
        .in("key", cacheKeys);
      const map = new Map<string, number[]>();
      (cached || []).forEach((row: any) => {
        const arr = Array.isArray(row?.data?.closes) ? row.data.closes : [];
        if (arr.length >= 2) map.set(row.key, arr); // 空/不足結果視同未快取，避免「壞掉一整天」
      });
      for (const c of codes) {
        const k = `sparkline_${c}_${day}`;
        if (map.has(k)) result[c] = map.get(k)!;
        else toFetch.push(c);
      }
    }

    // Fetch missing in parallel (batched concurrency)
    const batchSize = 6;
    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((c) => fetchSparkline(c)));
      const upserts: any[] = [];
      batch.forEach((c, idx) => {
        const closes = results[idx] || [];
        result[c] = closes;
        // 只有抓到實際資料才寫快取，避免空值汙染
        if (closes.length >= 2) {
          upserts.push({
            user_id: "00000000-0000-0000-0000-000000000000",
            key: `sparkline_${c}_${day}`,
            data: { closes, fetched_at: new Date().toISOString() },
          });
        }
      });
      if (upserts.length > 0) {
        await sb.from("checkup_storage").upsert(upserts, { onConflict: "user_id,key" });
      }
    }

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
