import {
  authHeaders, drain, fnUrl, runPreflightTest, assertCorsAndCorrelation,
} from "../_shared/test_utils.ts";

const FN = "checkup-sparkline";

Deno.test(`${FN} — OPTIONS preflight returns CORS`, async () => {
  await runPreflightTest(FN);
});

Deno.test(`${FN} — POST without codes returns 4xx with CORS + correlation id`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
    body: JSON.stringify({}),
  });
  await drain(res);
  if (res.status < 400 || res.status >= 500) {
    throw new Error(`expected 4xx, got ${res.status}`);
  }
  assertCorsAndCorrelation(res, cid);
});

Deno.test(`${FN} — malformed JSON body still produces CORS + correlation id error`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
    body: "{not json",
  });
  await drain(res);
  if (res.status < 400 || res.status >= 500) {
    throw new Error(`expected 4xx for malformed body, got ${res.status}`);
  }
  assertCorsAndCorrelation(res, cid);
});
