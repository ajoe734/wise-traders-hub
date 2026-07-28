// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

/**
 * checkup-warrant-sync  (ON-DEMAND FALLBACK)
 * -------------------------------------------
 * ⚠ 主排程已改走 GitHub Actions: `.github/workflows/refresh-warrant-basic.yml`
 *   （腳本 `scripts/refresh-warrant-basic.mjs`）。TWSE openapi 對 Supabase edge
 *   function 出口 IP 有節流，25MB JSON 常被中間 gateway 截斷；Actions runner
 *   IP 不在被擋名單，能穩定拿到完整檔。
 *
 * 本 edge function 保留為 on-demand fallback：`reconcile-warrant-quantities`
 * 若發現某檔 exercise_ratio 為 NULL，會呼叫這裡做單檔補抓。邏輯與 Actions
 * 版本相同（regex per-record 抽取、ratio = 官方欄位 / 1000）。
 *
 * 從 TWSE openapi `/v1/opendata/t187ap37_L`（上市權證基本資料彙總表）拉：
 *   - symbol / name / parent_code / expire_date / exercise_ratio /
 *     strike_price / call_put / ratio_source='twse_t187ap37_L'
 */
const TWSE_LISTED = "https://openapi.twse.com.tw/v1/opendata/t187ap37_L";

interface TwseWarrantRow {
  出表日期?: string;
  權證代號?: string;
  權證簡稱?: string;
  權證類型?: string;
  "標的證券/指數"?: string;
  "最後交易日"?: string;
  "履約截止日"?: string;
  "最新標的履約配發數量(每仟單位權證)"?: string;
  "最新履約價格(元)/履約指數"?: string;
}

function rocToIso(s?: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{3,4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const gy = y < 1911 ? y + 1911 : y;
  return `${gy}-${m[2]}-${m[3]}`;
}

function parseRow(r: TwseWarrantRow) {
  const symbol = String(r["權證代號"] ?? "").trim();
  if (!/^\d{6}$/.test(symbol)) return null;

  const name = String(r["權證簡稱"] ?? "").trim();
  const expire_date = rocToIso(r["履約截止日"]);

  const rawRatio = String(r["最新標的履約配發數量(每仟單位權證)"] ?? "").replace(/,/g, "").trim();
  let exercise_ratio: number | null = null;
  if (rawRatio) {
    const n = Number(rawRatio);
    // 這個欄位是「每 1000 單位權證換取的標的股數」，需除以 1000 才是每單位的 ratio。
    if (Number.isFinite(n) && n > 0) exercise_ratio = n / 1000;
  }

  const rawStrike = String(r["最新履約價格(元)/履約指數"] ?? "").replace(/,/g, "").trim();
  const strikeN = Number(rawStrike);
  const strike_price = Number.isFinite(strikeN) && strikeN > 0 ? strikeN : null;

  const typ = String(r["權證類型"] ?? "").trim();
  const call_put: "call" | "put" | null =
    /認購/.test(typ) ? "call" : /認售/.test(typ) ? "put" : null;

  const parentName = String(r["標的證券/指數"] ?? "").trim() || null;

  return {
    symbol,
    name,
    parent_name: parentName,
    expire_date,
    exercise_ratio,
    strike_price,
    call_put,
  };
}

const handler = withLogging("checkup-warrant-sync", async (_req, log) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  let rows: TwseWarrantRow[] = [];
  try {
    // TWSE openapi 這隻回 25MB+，Deno 預設 fetch 常會被中間 Cloudflare/gateway
    // 提早關閉；我們允許最長 55 秒（edge 60s 上限保留餘裕），並改用 regex-per-record
    // 抽取，容忍尾端截斷。
    const res = await fetch(TWSE_LISTED, {
      signal: AbortSignal.timeout(55000),
      headers: {
        "User-Agent": "Mozilla/5.0 legendflow-warrant-sync/2.0",
        Accept: "application/json",
      },
    });
    if (!res.ok) return jsonResponse({ ok: false, error: `TWSE ${res.status}` }, { status: 502 });
    const text = await res.text();
    // 直接走寬容抽取（不 JSON.parse 全檔，避免尾端 unterminated string 全掛）
    const re = /\{[^{}]*"權證代號":"\d{6}"[^{}]*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      try {
        rows.push(JSON.parse(m[0]) as TwseWarrantRow);
      } catch { /* skip malformed record */ }
    }
    log.info("fetched", { bytes: text.length, records: rows.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, { status: 502 });
  }


  const parsed = rows.map(parseRow).filter((x): x is NonNullable<ReturnType<typeof parseRow>> => x !== null);
  if (parsed.length === 0) {
    return jsonResponse({ ok: false, parsed: 0, hint: "TWSE openapi returned 0 warrants — endpoint may have changed" });
  }

  // parent_code：由 stock_names 用 parent_name 反查（best-effort，找不到不擋）
  const supabase = serviceClient();
  const names = [...new Set(parsed.map((p) => p.parent_name).filter(Boolean) as string[])];
  const parentMap = new Map<string, string>();
  if (names.length) {
    // chunk 到 200 避免 URL 過長
    for (let i = 0; i < names.length; i += 200) {
      const chunk = names.slice(i, i + 200);
      const { data } = await supabase
        .from("stock_names")
        .select("symbol,name")
        .in("name", chunk);
      for (const s of data ?? []) {
        if ((s as any).name && (s as any).symbol) parentMap.set((s as any).name, (s as any).symbol);
      }
    }
  }

  const dedup = new Map<string, Record<string, unknown>>();
  for (const p of parsed) {
    const parent_code = p.parent_name ? parentMap.get(p.parent_name) ?? null : null;
    const row: Record<string, unknown> = {
      symbol: p.symbol,
      name: p.name,
      parent_code,
      expire_date: p.expire_date,
      fetched_at: new Date().toISOString(),
    };
    if (p.exercise_ratio !== null) {
      row.exercise_ratio = p.exercise_ratio;
      row.ratio_source = "twse_t187ap37_L";
      row.ratio_updated_at = new Date().toISOString();
    }
    if (p.strike_price !== null) row.strike_price = p.strike_price;
    if (p.call_put !== null) row.call_put = p.call_put;
    dedup.set(p.symbol, row);
  }
  const finalRows = [...dedup.values()];

  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < finalRows.length; i += CHUNK) {
    const slice = finalRows.slice(i, i + CHUNK);
    const { error } = await supabase.from("warrant_expiry").upsert(slice, { onConflict: "symbol" });
    if (error) {
      log.error("upsert_error", { message: error.message });
      return jsonResponse({ ok: false, written, error: error.message }, { status: 500 });
    }
    written += slice.length;
  }

  return jsonResponse({ ok: true, parsed: finalRows.length, written, source: "twse_t187ap37_L" });
});

Deno.serve(handler);
