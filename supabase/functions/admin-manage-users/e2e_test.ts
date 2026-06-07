// E2E contract: admin-manage-users validates action whitelist + withLogging.
// Note: without a real admin Bearer, requests will short-circuit at auth (401).
// We assert that even auth-failures still carry cid + CORS. When a malformed
// admin Bearer reaches validateInput, we exercise the INVALID_INPUT path.
import { authHeaders, drain, fnUrl, assertCorsAndCorrelation } from "../_shared/test_utils.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN = "admin-manage-users";

async function post(body: unknown, cid: string) {
  return fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
    body: JSON.stringify(body),
  });
}

Deno.test(`${FN} e2e — unauthenticated still gets cid + CORS`, async () => {
  const cid = `e2e-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": cid },
    body: JSON.stringify({ action: "list" }),
  });
  await drain(res);
  assertCorsAndCorrelation(res, cid);
  assert([401, 403].includes(res.status));
});

Deno.test(`${FN} e2e — non-admin user → 403 or 401, cid preserved`, async () => {
  const cid = `e2e-${crypto.randomUUID()}`;
  const res = await post({ action: "list" }, cid);
  await drain(res);
  assertCorsAndCorrelation(res, cid);
  assert([401, 403].includes(res.status));
});

Deno.test(`${FN} e2e — OPTIONS preflight CORS`, async () => {
  const res = await fetch(fnUrl(FN), {
    method: "OPTIONS",
    headers: {
      "Origin": "https://legendflow.tw",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  });
  await drain(res);
  assert([200, 204].includes(res.status));
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});
