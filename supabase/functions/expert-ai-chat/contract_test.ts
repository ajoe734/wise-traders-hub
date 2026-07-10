// expert-ai-chat 契約 / 錯誤路徑測試
//
// 涵蓋：
//  1. OPTIONS preflight → CORS
//  2. 缺 Authorization → 401 + CORS + errorId
//  3. 缺 body 欄位 (expert_id / messages) → 401 或 400（先擋 auth）
//  4. 錯誤 JSON body 仍保留 CORS 與 x-correlation-id
//
// 真正的串流測試 (need real user JWT + expert_id) 見 integration_test.ts。

import {
  runPreflightTest,
  runInvalidBodyContract,
  fnUrl,
  authHeaders,
  drain,
  assertCorsAndCorrelation,
} from "../_shared/test_utils.ts";

const FN = "expert-ai-chat";

Deno.test(`${FN} — OPTIONS preflight returns CORS`, async () => {
  await runPreflightTest(FN);
});

Deno.test(`${FN} — invalid POST 保留 CORS + x-correlation-id + errorId`, async () => {
  await runInvalidBodyContract(FN, { method: "POST" });
});

Deno.test(`${FN} — POST without Authorization → 401 + errorId`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": cid },
    body: JSON.stringify({ expert_id: "x", messages: [] }),
  });
  const text = await drain(res);
  assertCorsAndCorrelation(res, cid);
  if (res.status !== 401) {
    throw new Error(`expected 401, got ${res.status}: ${text}`);
  }
  const body = JSON.parse(text);
  if (typeof body.errorId !== "string" || !body.errorId.startsWith("err_")) {
    throw new Error(`missing/invalid errorId: ${JSON.stringify(body)}`);
  }
  const headerErrId = res.headers.get("x-error-id");
  if (headerErrId !== body.errorId) {
    throw new Error(`x-error-id header mismatch: header=${headerErrId} body=${body.errorId}`);
  }
});

Deno.test(`${FN} — POST with anon key (無 user session) → 401`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
    body: JSON.stringify({
      expert_id: "00000000-0000-0000-0000-000000000000",
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    }),
  });
  const text = await drain(res);
  assertCorsAndCorrelation(res, cid);
  // anon token → getUser() 回 null → 401 unauthorized
  if (res.status !== 401) {
    throw new Error(`expected 401 for anon-only auth, got ${res.status}: ${text}`);
  }
});

Deno.test(`${FN} — 空 body 依然回 CORS + errorId (不 crash)`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
    body: "",
  });
  const text = await drain(res);
  assertCorsAndCorrelation(res, cid);
  if (res.status < 400) {
    throw new Error(`expected error status, got ${res.status}: ${text}`);
  }
});
