import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authHeaders, drain, fnUrl, runPreflightTest, assertCorsAndCorrelation,
} from "../_shared/test_utils.ts";

const FN = "checkup-telemetry";

Deno.test(`${FN} — OPTIONS preflight returns CORS`, async () => {
  await runPreflightTest(FN);
});

Deno.test(`${FN} — GET returns entries with CORS + correlation id`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "GET",
    headers: authHeaders({ "x-correlation-id": cid }),
  });
  await drain(res);
  assertEquals(res.status, 200);
  assertCorsAndCorrelation(res, cid);
});

Deno.test(`${FN} — POST with invalid body returns validation error with CORS`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
    body: JSON.stringify({ wrong: "shape" }),
  });
  await drain(res);
  if (res.status < 400 || res.status >= 500) {
    throw new Error(`expected 4xx for invalid body, got ${res.status}`);
  }
  assertCorsAndCorrelation(res, cid);
});

Deno.test(`${FN} — unsupported method returns 405 with CORS`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "DELETE",
    headers: authHeaders({ "x-correlation-id": cid }),
  });
  await drain(res);
  assertEquals(res.status, 405);
  assertCorsAndCorrelation(res, cid);
});

Deno.test(`${FN} — auto-assigns correlation id when client omits it`, async () => {
  const res = await fetch(fnUrl(FN), { method: "GET", headers: authHeaders() });
  await drain(res);
  assertEquals(res.status, 200);
  const cid = assertCorsAndCorrelation(res);
  if (!cid || cid.length < 8) throw new Error(`auto cid looks invalid: ${cid}`);
});

Deno.test(`${FN} — POST invalid body exposes code INVALID_INPUT`, async () => {
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({}),
  });
  const body = JSON.parse(await drain(res));
  if (body.code !== "INVALID_INPUT") throw new Error(`expected code=INVALID_INPUT, got ${body.code}`);
});

Deno.test(`${FN} — DELETE exposes code METHOD_NOT_ALLOWED`, async () => {
  const res = await fetch(fnUrl(FN), { method: "DELETE", headers: authHeaders() });
  const body = JSON.parse(await drain(res));
  if (body.code !== "METHOD_NOT_ALLOWED") throw new Error(`expected code=METHOD_NOT_ALLOWED, got ${body.code}`);
});
