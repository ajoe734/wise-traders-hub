// PR-1 契約測試：cold-start dry_run 純規劃、admin guard、狀態讀取。
// 執行：deno test --allow-net --allow-env supabase/functions/tw-institutional-daily-sync/cold_start_test.ts
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const FN = `${SUPABASE_URL}/functions/v1/tw-institutional-daily-sync`;

async function post(body: unknown, auth = ANON) {
  const res = await fetch(FN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${auth}`,
      "apikey": ANON,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: res.status, json, text };
}

Deno.test("cold_start_status 對 anon 也可讀，回傳結構包含 state/days_done/days_total", async () => {
  const r = await post({ mode: "cold_start_status" });
  assertEquals(r.status, 200);
  assert(r.json?.ok === true, `expected ok, got ${r.text}`);
  const s = r.json.status;
  assert(typeof s.state === "string");
  assert(typeof s.days_done === "number");
  assert(typeof s.days_total === "number");
});

Deno.test("cold_start 未帶 admin token 應被 403 拒絕", async () => {
  const r = await post({ mode: "cold_start", dry_run: true, days: 5 });
  assertEquals(r.status, 403);
  assertEquals(r.json?.code, "FORBIDDEN");
});
