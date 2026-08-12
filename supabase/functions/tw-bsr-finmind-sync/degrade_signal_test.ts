// Build 1b contract: p1_stalled must only consider CLAIMABLE (due) P1 jobs.
// Quota-deferred P1 rows (next_run_at in the future) must never trigger a stall,
// otherwise degrade mode locks at tier3_paused(p1_stalled) and recovery deadlocks.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

// Extract every P1 pending queue probe block
const blocks = [...src.matchAll(/from\('tw_bsr_sync_queue'\)([\s\S]{0,420}?)\.limit\(1\)/g)]
  .map((m) => m[1])
  .filter((b) => b.includes("'priority', 1") && b.includes("'status', 'pending'"));

Deno.test("both P1 stall probes exist", () => {
  assertEquals(blocks.length, 2);
});

Deno.test("P1 stall probes filter on next_run_at due-now", () => {
  for (const b of blocks) {
    assert(b.includes(".not('next_run_at', 'is', null)"), "must exclude NULL next_run_at");
    assert(b.includes(".lte('next_run_at'"), "must exclude future next_run_at");
    assert(b.includes("select('next_run_at')"), "must select next_run_at");
    assert(!b.includes("select('enqueued_at')"), "must not age by enqueued_at");
    assert(b.includes(".order('next_run_at'"), "must order by next_run_at");
  }
});

Deno.test("P1 age is derived from next_run_at, not enqueued_at", () => {
  const ages = [...src.matchAll(/new Date\(oldestP1\[0\]\.(\w+)\)/g)].map((m) => m[1]);
  assertEquals(ages.length, 2);
  for (const f of ages) assertEquals(f, "next_run_at");
});
