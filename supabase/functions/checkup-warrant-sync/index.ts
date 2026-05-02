// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/checkupCors.ts";

/**
 * Pulls TWSE listed warrants daily-results CSV, parses out
 * (symbol, name, parent_code, expire_date), and upserts into
 * public.warrant_expiry. Idempotent — safe to call multiple times.
 *
 * The TWSE endpoint returns several stacked CSV tables; we only keep
 * data rows whose first column is a 6-digit warrant code.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = "https://www.twse.com.tw/rwd/zh/warrant/dailyResult?response=csv";
  let csv = "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 portfolio-dashboard/1.0", "Accept": "text/csv,*/*" },
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: `TWSE ${res.status}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    csv = await res.text();
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse CSV: split lines, strip BOM/quotes, naive comma split (TWSE format is consistent).
  const rows: string[][] = [];
  for (const rawLine of csv.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (!line) continue;
    // Naive CSV split — TWSE doesn't escape commas inside numbers, but does wrap with quotes
    const cells = line.split('","').map((c) => c.replace(/^"|"$/g, "").trim());
    if (cells.length < 4) continue;
    rows.push(cells);
  }

  // TWSE 上市權證每日結算 columns vary slightly; resolve by header row.
  // Common columns we care about:
  //   "權證代號" / "證券代號"  -> symbol
  //   "權證名稱" / "證券名稱"  -> name
  //   "標的證券代號"           -> parent_code
  //   "到期日"                 -> expire_date (YYYYMMDD or YYYY/MM/DD)
  let header: string[] | null = null;
  const records: Array<{ symbol: string; name: string; parent_code: string | null; expire_date: string | null }> = [];

  for (const row of rows) {
    // header detection
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
    const parent = get("標的證券代號", "標的代號");
    const parent_code = /^\d{4,6}$/.test(parent) ? parent : null;

    const rawDate = get("到期日");
    let expire_date: string | null = null;
    const m1 = rawDate.match(/^(\d{4})\/?(\d{2})\/?(\d{2})$/);
    const m2 = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const m = m1 || m2;
    if (m) expire_date = `${m[1]}-${m[2]}-${m[3]}`;

    records.push({ symbol, name, parent_code, expire_date });
  }

  // De-dup by symbol (TWSE may list a warrant in multiple sub-tables)
  const dedup = new Map<string, typeof records[number]>();
  for (const r of records) dedup.set(r.symbol, r);
  const finalRows = [...dedup.values()];

  if (finalRows.length === 0) {
    return new Response(JSON.stringify({ ok: false, parsed: 0, hint: "No warrant rows parsed — TWSE format may have changed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Upsert in chunks
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < finalRows.length; i += CHUNK) {
    const slice = finalRows.slice(i, i + CHUNK).map((r) => ({
      ...r,
      fetched_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("warrant_expiry").upsert(slice, { onConflict: "symbol" });
    if (error) {
      console.error("[warrant-sync] upsert error:", error.message);
      return new Response(JSON.stringify({ ok: false, written, error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    written += slice.length;
  }

  return new Response(JSON.stringify({ ok: true, parsed: finalRows.length, written }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
