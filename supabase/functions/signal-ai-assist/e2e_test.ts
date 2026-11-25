// E2E contract: signal-ai-assist is cron-key only. Callers without X-Cron-Key are
// rejected with 403 before input validation, and withLogging still sets CORS + cid.
import { authHeaders, drain, fnUrl, assertCorsAndCorrelation } from "../_shared/test_utils.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN = "signal-ai-assist";

for (const body of [{ content: "hi" }, { mode: "translate", content: "hi" }, { mode: "rewrite", content: "" }]) {
  Deno.test(`${FN} e2e — no cron key ${JSON.stringify(body)} → 403 FORBIDDEN_CRON + cid`, async () => {
    const cid = `e2e-${crypto.randomUUID()}`;
    const res = await fetch(fnUrl(FN), {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
      body: JSON.stringify(body),
    });
    const parsed = JSON.parse(await drain(res));
    assertCorsAndCorrelation(res, cid);
    assertEquals(res.status, 403);
    assertEquals(parsed.code, "FORBIDDEN_CRON");
  });
}

Deno.test(`${FN} e2e — withLogging auto-cid when client omits`, async () => {
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({}),
  });
  await drain(res);
  assert(res.headers.get("x-correlation-id"));
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});
