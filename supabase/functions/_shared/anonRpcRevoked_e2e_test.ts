// Regression (2026-11): visitors with only the publishable key must not run internal
// SECURITY DEFINER functions, but must still read the public projection status.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const URL_ = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

for (const fn of ["cron_edge_call", "trade_dedupe_sweep", "admin_list_cron_jobs", "get_cron_jobs", "backfill_queue_stats", "finmind_pool_reset", "toggle_kill_switch"]) {
  Deno.test(`anon cannot execute ${fn}`, async () => {
    const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: "{}" });
    const body = await res.json();
    if (!["42501", "PGRST202"].includes(body.code)) throw new Error(`${fn} reachable by anon: ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  });
}

Deno.test("anon can read public_expert_state_active", async () => {
  const res = await fetch(`${URL_}/rest/v1/public_expert_state_active?select=state&limit=1`, { headers: H });
  await res.body?.cancel();
  assertEquals(res.status, 200);
});
