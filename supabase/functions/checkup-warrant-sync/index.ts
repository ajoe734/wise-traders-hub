// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

/**
 * Pulls TWSE listed warrants daily-results CSV, parses out
 * (symbol, name, parent_code, expire_date), and upserts into
 * public.warrant_expiry. Idempotent — safe to call multiple times.
 */
const handler = withLogging("checkup-warrant-sync", async (_req, log) => {
  const url = "https://www.twse.com.tw/rwd/zh/warrant/dailyResult?response=csv";
  let csv = "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 portfolio-dashboard/1.0", "Accept": "text/csv,*/*" },
    });
    if (!res.ok) return jsonResponse({ ok: false, error: `TWSE ${res.status}` }, { status: 502 });
    csv = await res.text();
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, { status: 502 });
  }

  const rows: string[][] = [];
  for (const rawLine of csv.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (!line) continue;
    const cells = line.split('","').map((c) => c.replace(/^"|"$/g, "").trim());
    if (cells.length < 4) continue;
    rows.push(cells);
  }

  let header: string[] | null = null;
  const records: Array<{
    symbol: string;
    name: string;
    parent_code: string | null;
    expire_date: string | null;
    exercise_ratio: number | null;
    strike_price: number | null;
    call_put: 'call' | 'put' | null;
    ratio_source: string | null;
    ratio_updated_at: string | null;
  }> = [];

  for (const row of rows) {
    if (row.some((c) => c.includes("代號")) && row.some((c) => c.includes("到期"))) {
      header = row;
      continue;
    }
    if (!header) continue;

    const get = (...keys: string[]) => {
      for (const k of keys) {
        const idx = header!.findIndex((h) => h.includes(k));
        if (idx >= 0 && row[idx] != null) return String(row[idx]).trim();
      }
      return "";
    };

    const symbol = get("權證代號", "證券代號").replace(/[^0-9A-Z]/gi, "");
    if (!/^\d{6}$/.test(symbol)) continue;

    const name = get("權證名稱", "證券名稱");
    const parent = get("標的證券代號", "標的代號").toUpperCase();
    const parent_code = /^\d{4,6}[A-Z]?$/.test(parent) ? parent : null;

    const rawDate = get("到期日");
    let expire_date: string | null = null;
    const m = rawDate.match(/^(\d{4})\/?(\d{2})\/?(\d{2})$/) || rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) expire_date = `${m[1]}-${m[2]}-${m[3]}`;

    // 行使比例：TWSE 欄位常見「行使比例」「行使比率」，值形如 "0.025" 或 "2.500"（單位不一：股/單位）
    const rawRatio = get("行使比例", "行使比率", "履約比率");
    let exercise_ratio: number | null = null;
    if (rawRatio) {
      const n = Number(rawRatio.replace(/[,%]/g, ''));
      if (Number.isFinite(n) && n > 0) exercise_ratio = n;
    }

    const rawStrike = get("履約價", "履約價格");
    let strike_price: number | null = null;
    if (rawStrike) {
      const n = Number(rawStrike.replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) strike_price = n;
    }

    const rawType = get("認購/認售", "型態", "類別");
    let call_put: 'call' | 'put' | null = null;
    if (/認購|購|call|C$/i.test(rawType)) call_put = 'call';
    else if (/認售|售|put|P$/i.test(rawType)) call_put = 'put';
    // 名稱結尾判斷（fallback）
    if (!call_put) {
      if (/購\d*$/.test(name)) call_put = 'call';
      else if (/售\d*$/.test(name)) call_put = 'put';
    }

    records.push({
      symbol,
      name,
      parent_code,
      expire_date,
      exercise_ratio,
      strike_price,
      call_put,
      ratio_source: exercise_ratio !== null ? 'twse_daily' : null,
      ratio_updated_at: exercise_ratio !== null ? new Date().toISOString() : null,
    });
  }


  const dedup = new Map<string, typeof records[number]>();
  for (const r of records) dedup.set(r.symbol, r);
  const finalRows = [...dedup.values()];

  if (finalRows.length === 0) {
    return jsonResponse({ ok: false, parsed: 0, hint: "No warrant rows parsed — TWSE format may have changed" });
  }

  const supabase = serviceClient();
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < finalRows.length; i += CHUNK) {
    const slice = finalRows.slice(i, i + CHUNK).map((r) => {
      const row: Record<string, unknown> = {
        symbol: r.symbol,
        name: r.name,
        parent_code: r.parent_code,
        expire_date: r.expire_date,
        fetched_at: new Date().toISOString(),
      };
      // 只有抓到值時才寫入 ratio 相關欄位，避免抹掉 twse_single fallback 補上的資料
      if (r.exercise_ratio !== null) {
        row.exercise_ratio = r.exercise_ratio;
        row.ratio_source = r.ratio_source;
        row.ratio_updated_at = r.ratio_updated_at;
      }
      if (r.strike_price !== null) row.strike_price = r.strike_price;
      if (r.call_put !== null) row.call_put = r.call_put;
      return row;
    });
    const { error } = await supabase.from("warrant_expiry").upsert(slice, { onConflict: "symbol" });
    if (error) {
      log.error("upsert_error", { message: error.message });
      return jsonResponse({ ok: false, written, error: error.message }, { status: 500 });
    }
    written += slice.length;
  }

  return jsonResponse({ ok: true, parsed: finalRows.length, written });
});

Deno.serve(handler);
