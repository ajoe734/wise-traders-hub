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
  const records: Array<{ symbol: string; name: string; parent_code: string | null; expire_date: string | null }> = [];

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

    records.push({ symbol, name, parent_code, expire_date });
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
    const slice = finalRows.slice(i, i + CHUNK).map((r) => ({ ...r, fetched_at: new Date().toISOString() }));
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
