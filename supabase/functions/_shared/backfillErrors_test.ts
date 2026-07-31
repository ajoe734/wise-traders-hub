import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyBackfillError, createRunLogger } from "./backfillErrors.ts";

Deno.test("admission rejection is retryable", () => {
  const c = classifyBackfillError(new Error("admission_rejected:quota:pool=backfill"));
  assertEquals(c.code, "ADMISSION_REJECTED");
  assertEquals(c.retryable, true);
});

Deno.test("finmind 400 is a non-retryable upstream http error", () => {
  const c = classifyBackfillError(new Error("finmind_http_400:size is too large"));
  assertEquals(c.code, "UPSTREAM_HTTP");
  assertEquals(c.upstreamStatus, 400);
  assertEquals(c.retryable, false);
});

Deno.test("finmind 429/5xx are retryable", () => {
  assertEquals(classifyBackfillError("finmind_http_429:rate").retryable, true);
  assertEquals(classifyBackfillError("finmind_http_502:bad gateway").retryable, true);
});

Deno.test("bad json / api status / timeout", () => {
  assertEquals(classifyBackfillError("finmind_bad_json:<html>").code, "UPSTREAM_BAD_JSON");
  assertEquals(classifyBackfillError("finmind_api_402:limit").code, "UPSTREAM_API");
  assertEquals(classifyBackfillError(new Error("Signal timed out.")).code, "UPSTREAM_TIMEOUT");
});

Deno.test("all-days-failed inherits the nested cause", () => {
  const c = classifyBackfillError("chip_fact_all_days_failed:finmind_http_400:bad");
  assertEquals(c.code, "UPSTREAM_HTTP");
  assertEquals(c.upstreamStatus, 400);
  assertEquals(c.detail.startsWith("chip_fact_all_days_failed"), true);
});

Deno.test("db upsert / unknown dataset / fallback", () => {
  assertEquals(classifyBackfillError("chip_fact_upsert:duplicate key").code, "DB_UPSERT");
  const unknown = classifyBackfillError("unknown_dataset:foo");
  assertEquals(unknown.code, "UNKNOWN_DATASET");
  assertEquals(unknown.retryable, false);
  assertEquals(classifyBackfillError("boom").code, "INTERNAL");
});

Deno.test("run logger buffers and flushes structured rows", async () => {
  let inserted: any[] = [];
  const supa = {
    from: () => ({
      insert: (rows: unknown) => {
        inserted = rows as any[];
        return Promise.resolve({ error: null });
      },
    }),
  };
  const log = createRunLogger(supa, "backfill-worker", "run-1", { trigger_source: "cron" });
  log.log("info", "job_start", "processing", { job_id: 7 });
  log.log("error", "job_failed", "boom", { code: "UPSTREAM_HTTP" });
  assertEquals(log.buffered().length, 2);
  await log.flush();
  assertEquals(inserted.length, 2);
  assertEquals(inserted[0].fn, "backfill-worker");
  assertEquals(inserted[0].run_id, "run-1");
  assertEquals(inserted[0].payload.trigger_source, "cron");
  assertEquals(inserted[1].level, "error");
  assertEquals(log.buffered().length, 0);
});

Deno.test("flush never throws when insert fails", async () => {
  const supa = { from: () => ({ insert: () => Promise.reject(new Error("nope")) }) };
  const log = createRunLogger(supa as never, "backfill-worker", "run-2");
  log.log("info", "x", "y");
  await log.flush();
});

Deno.test('classifyBackfillError: retry_exhausted → UPSTREAM_RETRY_EXHAUSTED（可重跑）', () => {
  const c = classifyBackfillError(
    new Error('finmind_retry_exhausted:retry_exhausted:finmind_bsr:attempts=3:status=502:boom'),
  );
  assertEquals(c.code, 'UPSTREAM_RETRY_EXHAUSTED');
  assertEquals(c.retryable, true);
  assertEquals(c.upstreamStatus, 502);

  const net = classifyBackfillError('twse_retry_exhausted:retry_exhausted:twse_t86:attempts=3:status=network:reset');
  assertEquals(net.code, 'UPSTREAM_RETRY_EXHAUSTED');
  assertEquals(net.upstreamStatus, undefined);
});
