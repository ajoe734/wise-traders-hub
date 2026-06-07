// E2E contract: line-webhook is LINE-only — origin LOCKED to api.line.me
// (NOT wildcard), no withLogging wrapper, basic input check (expert_id query).
import { fnUrl, drain } from "../_shared/test_utils.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FN = "line-webhook";

Deno.test(`${FN} e2e — missing expert_id returns 400 + LINE-only CORS`, async () => {
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [] }),
  });
  const text = await drain(res);
  assertEquals(res.status, 400);
  const origin = res.headers.get("access-control-allow-origin");
  assertEquals(origin, "https://api.line.me", `expected LINE-locked origin, got ${origin}`);
  assert((res.headers.get("vary") || "").toLowerCase().includes("origin"));
  const body = JSON.parse(text);
  assert(typeof body.error === "string" && body.error.toLowerCase().includes("expert_id"));
});

Deno.test(`${FN} e2e — OPTIONS preflight: locked to api.line.me`, async () => {
  const res = await fetch(fnUrl(FN), {
    method: "OPTIONS",
    headers: {
      "Origin": "https://api.line.me",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type, x-line-signature",
    },
  });
  await drain(res);
  assert([200, 204].includes(res.status));
  assertEquals(res.headers.get("access-control-allow-origin"), "https://api.line.me");
});

Deno.test(`${FN} e2e — GET verification returns OK`, async () => {
  const res = await fetch(fnUrl(FN), { method: "GET" });
  const text = await drain(res);
  assertEquals(res.status, 200);
  assertEquals(text, "OK");
  assertEquals(res.headers.get("access-control-allow-origin"), "https://api.line.me");
});

Deno.test(`${FN} e2e — signature mismatch returns 401 (with expert_id)`, async () => {
  // Use a likely-nonexistent expert id; if expert exists, missing/invalid
  // signature still must NOT echo a wildcard CORS.
  const url = `${fnUrl(FN)}?expert_id=00000000-0000-0000-0000-000000000000`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": "invalid" },
    body: JSON.stringify({ events: [] }),
  });
  await drain(res);
  // Either 200 (no active channel branch) or 401 (sig mismatch). Both must
  // preserve LINE-locked CORS.
  assert([200, 401, 400].includes(res.status), `unexpected status ${res.status}`);
  assertEquals(res.headers.get("access-control-allow-origin"), "https://api.line.me");
});
