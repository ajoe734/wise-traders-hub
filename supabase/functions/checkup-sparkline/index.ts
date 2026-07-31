// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { validateInput, validationResponse } from "../_shared/inputValidator.ts";
import { applyCoercion } from "../_shared/inputCoerce.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

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
      headers: {
        // 模擬真實瀏覽器；TPEX 對裸 fetch 會回 403/redirect，加 Referer + 完整 UA 即可通過
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "Referer": "https://www.tpex.org.tw/",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
}

type OHLC = { date?: string; open: number; high: number; low: number; close: number };

/** 民國日期 "115/07/30" → ISO "2026-07-30"；西元格式直接正規化 */
function rocToIso(raw: unknown): string | undefined {
  const s = String(raw ?? "").trim().replace(/\s+/g, "");
  const m = s.match(/^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return undefined;
  let y = Number(m[1]);
  if (y < 1911) y += 1911;
  return `${y}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
}

function parseOhlcRow(r: any[]): OHLC | null {
  const o = Number(String(r[3]).replace(/,/g, ""));
  const h = Number(String(r[4]).replace(/,/g, ""));
  const l = Number(String(r[5]).replace(/,/g, ""));
  const c = Number(String(r[6]).replace(/,/g, ""));
  if (![o, h, l, c].every((n) => Number.isFinite(n) && n > 0)) return null;
  return { date: rocToIso(r[0]), open: o, high: h, low: l, close: c };
}


// TWSE 一個月的 OHLC；月初若無資料退回上一個月
async function twseMonth(code: string, d: Date): Promise<OHLC[]> {
  const date = ymd(d);
  const url = `${TWSE_DAY}?response=json&date=${date}&stockNo=${encodeURIComponent(code)}`;
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return [];
  let json: any;
  try { json = await res.json(); } catch { return []; }
  const rows: any[] = json?.data || [];
  if (!rows.length) return [];
  return rows.map(parseOhlcRow).filter((x): x is OHLC => !!x);
}

async function twseRecent(code: string): Promise<OHLC[]> {
  const now = new Date();
  let bars = await twseMonth(code, now);
  // 月初不足 2 筆 → 退回上一個月補
  if (bars.length < 2) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevBars = await twseMonth(code, prev);
    bars = [...prevBars, ...bars];
  }
  return bars.slice(-30);
}

// TPEX 新版 (2024 改版後)：tradingStock?monthDate=ROC/MM&code=XXXX&response=json
// 注意：是 monthDate（民國年/月），不是 date；date 會回「參數輸入錯誤」
async function tpexMonth(code: string, d: Date): Promise<OHLC[]> {
  const roc = `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const url = `${TPEX_DAY}?monthDate=${encodeURIComponent(roc)}&code=${encodeURIComponent(code)}&id=&response=json&_=${Date.now()}`;
  const res = await fetchWithTimeout(url);
  if (!res) { console.log(`[tpex] ${code} ${roc} fetch null`); return []; }
  if (!res.ok) { console.log(`[tpex] ${code} ${roc} status=${res.status}`); return []; }
  let json: any;
  try { json = await res.json(); } catch (e) { console.log(`[tpex] ${code} json parse err`, e); return []; }
  // 新版 schema: { tables: [{ data: [[ROC日期, 量, 額, 開, 高, 低, 收, 漲跌, 筆數]] }] }
  const tables = json?.tables;
  let rows: any[] = [];
  if (Array.isArray(tables) && tables.length > 0 && Array.isArray(tables[0]?.data)) {
    rows = tables[0].data;
  } else if (Array.isArray(json?.data)) {
    rows = json.data;
  } else if (Array.isArray(json?.aaData)) {
    rows = json.aaData; // 舊版相容
  }
  if (!rows.length) {
    console.log(`[tpex] ${code} ${roc} no rows; keys=`, Object.keys(json || {}), 'stat=', json?.stat);
    return [];
  }
  const bars = rows.map(parseOhlcRow).filter((x): x is OHLC => !!x);
  console.log(`[tpex] ${code} ${roc} got ${bars.length} bars`);
  return bars;
}

async function tpexRecent(code: string): Promise<OHLC[]> {
  const now = new Date();
  let bars = await tpexMonth(code, now);
  if (bars.length < 2) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevBars = await tpexMonth(code, prev);
    bars = [...prevBars, ...bars];
  }
  return bars.slice(-30);
}

async function fetchSparkline(code: string): Promise<OHLC[]> {
  const c = String(code).trim();
  if (!c) return [];
  const a = await twseRecent(c);
  if (a.length >= 2) return a;
  const b = await tpexRecent(c);
  return b;
}

const handler = withLogging('checkup-sparkline', async (req, log) => {
  // Diagnostic probe — GET /?probe=1 returns raw status from TPEX endpoints
  const u = new URL(req.url);
  if (u.searchParams.get("probe") === "1") {
    const targets = [
      "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?monthDate=115/04&code=6274&id=&response=json",
      "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    ];
    const out: any[] = [];
    for (const url of targets) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://www.tpex.org.tw/",
          },
        });
        const text = await res.text();
        out.push({ url, status: res.status, len: text.length, head: text.slice(0, 250) });
      } catch (e) {
        out.push({ url, err: String(e) });
      }
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

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

    const sb = serviceClient();

    const day = todayKey();
    const result: Record<string, { ohlc: OHLC[]; closes: number[] }> = {};
    const toFetch: string[] = [];

    const cacheKeys = codes.map((c) => `sparkline_${c}_${day}`);
    if (cacheKeys.length > 0) {
      const { data: cached } = await sb
        .from("checkup_storage")
        .select("key,data")
        .eq("user_id", "00000000-0000-0000-0000-000000000000")
        .in("key", cacheKeys);
      const map = new Map<string, { ohlc: OHLC[]; closes: number[] }>();
      (cached || []).forEach((row: any) => {
        const d = row?.data || {};
        // 新快取：ohlc + closes；舊快取：僅 closes
        const ohlc = Array.isArray(d.ohlc) ? d.ohlc : [];
        const closes = Array.isArray(d.closes) ? d.closes : (Array.isArray(d) ? d : []);
        if (ohlc.length >= 2 || closes.length >= 2) {
          map.set(row.key, { ohlc: ohlc.length >= 2 ? ohlc : [], closes });
        }
      });
      for (const c of codes) {
        const k = `sparkline_${c}_${day}`;
        if (map.has(k)) result[c] = map.get(k)!;
        else toFetch.push(c);
      }
    }
    log.info('cache_lookup', { total: codes.length, hits: codes.length - toFetch.length, toFetch: toFetch.length });

    const batchSize = 6;
    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((c) => fetchSparkline(c)));
      const upserts: any[] = [];
      batch.forEach((c, idx) => {
        const ohlc = results[idx] || [];
        const closes = ohlc.map((b) => b.close);
        result[c] = { ohlc, closes };
        if (ohlc.length >= 2) {
          upserts.push({
            user_id: "00000000-0000-0000-0000-000000000000",
            key: `sparkline_${c}_${day}`,
            data: { ohlc, closes, fetched_at: new Date().toISOString() },
          });
        }
      });
      if (upserts.length > 0) {
        await sb.from("checkup_storage").upsert(upserts, { onConflict: "user_id,key" });
      }
    }

    return jsonResponse({ result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    log.error('handler_error', { msg });
    return jsonResponse({ error: msg }, { status: 500 });
  }
});

Deno.serve(handler);
