// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TWSE_DAY = "https://www.twse.com.tw/exchangeReport/STOCK_DAY";
const TPEX_DAY = "https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php";

function ymd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function ymdSlash(d: Date) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchWithTimeout(url: string, ms = 4000): Promise<Response | null> {
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

// Fetch last ~5 trading day closes for a TWSE listed stock
async function twseRecent(code: string): Promise<number[]> {
  const d = new Date();
  const date = ymd(d);
  const url = `${TWSE_DAY}?response=json&date=${date}&stockNo=${encodeURIComponent(code)}`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return [];
  let json: any;
  try { json = await res.json(); } catch { return []; }
  const rows: any[] = json?.data || [];
  if (!rows.length) return [];
  // close column index = 6 ("收盤價")
  const closes = rows
    .map((r) => Number(String(r[6]).replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  return closes.slice(-5);
}

// TPEX daily history (上櫃) — falls back gracefully if format changes
async function tpexRecent(code: string): Promise<number[]> {
  const d = new Date();
  const roc = `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const url = `${TPEX_DAY}?l=zh-tw&d=${encodeURIComponent(roc)}&stkno=${encodeURIComponent(code)}&_=${Date.now()}`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return [];
  let json: any;
  try { json = await res.json(); } catch { return []; }
  const rows: any[] = json?.aaData || [];
  if (!rows.length) return [];
  // tpex st43 layout: [date, qty, amt, open, high, low, close, change, txn]
  const closes = rows
    .map((r) => Number(String(r[6]).replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  return closes.slice(-5);
}

async function fetchSparkline(code: string): Promise<number[]> {
  const c = String(code).trim();
  if (!c) return [];
  // try TWSE first, then TPEX
  const a = await twseRecent(c);
  if (a.length >= 2) return a;
  const b = await tpexRecent(c);
  return b;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const codesRaw: unknown = body?.codes;
    if (!Array.isArray(codesRaw)) {
      return new Response(JSON.stringify({ error: "codes must be array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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

    // Try cache batch
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
        map.set(row.key, arr);
      });
      for (const c of codes) {
        const k = `sparkline_${c}_${day}`;
        if (map.has(k)) result[c] = map.get(k)!;
        else toFetch.push(c);
      }
    }

    // Fetch missing in parallel (limited concurrency by batching)
    const batchSize = 6;
    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((c) => fetchSparkline(c)));
      const upserts: any[] = [];
      batch.forEach((c, idx) => {
        const closes = results[idx] || [];
        result[c] = closes;
        upserts.push({
          user_id: "00000000-0000-0000-0000-000000000000",
          key: `sparkline_${c}_${day}`,
          data: { closes, fetched_at: new Date().toISOString() },
        });
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
