// E2E contract: signal-ai-assist validates input + withLogging behavior.
import { authHeaders, drain, fnUrl, assertCorsAndCorrelation } from "../_shared/test_utils.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN = "signal-ai-assist";

async function post(body: unknown, cid: string) {
  return fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
    body: JSON.stringify(body),
  });
}

Deno.test(`${FN} e2e — missing mode → INVALID_INPUT + cid`, async () => {
  const cid = `e2e-${crypto.randomUUID()}`;
  const res = await post({ content: "hi" }, cid);
  const text = await drain(res);
  assertCorsAndCorrelation(res, cid);
  assertEquals(res.status, 400);
  const body = JSON.parse(text);
  assertEquals(body.code, "INVALID_INPUT");
  assert(body.fields.some((f: any) => f.key === "mode"));
});

Deno.test(`${FN} e2e — unknown mode rejected`, async () => {
  const cid = `e2e-${crypto.randomUUID()}`;
  const res = await post({ mode: "translate", content: "hi" }, cid);
  const text = await drain(res);
  assertCorsAndCorrelation(res, cid);
  assertEquals(res.status, 400);
  const body = JSON.parse(text);
  assertEquals(body.code, "INVALID_INPUT");
  assert(body.fields.some((f: any) => f.key === "mode"));
});

Deno.test(`${FN} e2e — empty content rejected`, async () => {
  const cid = `e2e-${crypto.randomUUID()}`;
  const res = await post({ mode: "rewrite", content: "" }, cid);
  const text = await drain(res);
  assertCorsAndCorrelation(res, cid);
  assertEquals(res.status, 400);
  const body = JSON.parse(text);
  assert(body.fields.some((f: any) => f.key === "content"));
});

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
