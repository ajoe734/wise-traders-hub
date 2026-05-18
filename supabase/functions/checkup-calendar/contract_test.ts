import {
  authHeaders, drain, fnUrl, runPreflightTest, assertCorsAndCorrelation,
} from "../_shared/test_utils.ts";

const FN = "checkup-calendar";

Deno.test(`${FN} — OPTIONS preflight returns CORS`, async () => {
  await runPreflightTest(FN);
});

Deno.test(`${FN} — POST with invalid body returns 4xx with CORS + correlation id`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
    body: JSON.stringify({}),
  });
  await drain(res);
  if (res.status < 400 || res.status >= 500) {
    throw new Error(`expected 4xx for empty body, got ${res.status}`);
  }
  assertCorsAndCorrelation(res, cid);
});
