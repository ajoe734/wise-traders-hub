// Contract: checkup-telemetry requires a signed-in caller (Phase M-2). Anonymous
// requests (anon key only) must be rejected before any read/write, with CORS.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authHeaders, drain, fnUrl, runPreflightTest } from "../_shared/test_utils.ts";

const FN = "checkup-telemetry";

Deno.test(`${FN} — OPTIONS preflight returns CORS`, async () => {
  await runPreflightTest(FN);
});

for (const method of ["GET", "POST", "DELETE"] as const) {
  Deno.test(`${FN} — anonymous ${method} rejected with 401 UNAUTHENTICATED + CORS`, async () => {
    const res = await fetch(fnUrl(FN), {
      method,
      headers: authHeaders({ "content-type": "application/json" }),
      body: method === "POST" ? JSON.stringify({}) : undefined,
    });
    const body = JSON.parse(await drain(res));
    assertEquals(res.status, 401);
    assertEquals(body.code, "UNAUTHENTICATED");
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
  });
}
