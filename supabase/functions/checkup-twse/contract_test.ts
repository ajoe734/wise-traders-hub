// Contract tests: OPTIONS/CORS, validation error, x-correlation-id propagation.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authHeaders, drain, fnUrl, runPreflightTest, assertCorsAndCorrelation,
} from "../_shared/test_utils.ts";

const FN = "checkup-twse";

Deno.test(`${FN} — OPTIONS preflight returns CORS`, async () => {
  await runPreflightTest(FN);
});

Deno.test(`${FN} — missing ex_ch returns 4xx with CORS + correlation id`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "GET",
    headers: authHeaders({ "x-correlation-id": cid }),
  });
  await drain(res);
  if (res.status < 400 || res.status >= 500) {
    throw new Error(`expected 4xx for missing ex_ch, got ${res.status}`);
  }
  assertCorsAndCorrelation(res, cid);
});

Deno.test(`${FN} — happy path with ex_ch propagates correlation id`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN, { ex_ch: "tse_2330.tw" }), {
    method: "GET",
    headers: authHeaders({ "x-correlation-id": cid }),
  });
  await drain(res);
  assertEquals(res.status, 200);
  assertCorsAndCorrelation(res, cid);
});

Deno.test(`${FN} — missing ex_ch body exposes code INVALID_INPUT`, async () => {
  const res = await fetch(fnUrl(FN), { method: "GET", headers: authHeaders() });
  const body = JSON.parse(await drain(res));
  if (body.code !== "INVALID_INPUT") throw new Error(`expected code=INVALID_INPUT, got ${body.code}`);
  if (typeof body.message !== "string" || !body.message.length) throw new Error("missing message");
});
