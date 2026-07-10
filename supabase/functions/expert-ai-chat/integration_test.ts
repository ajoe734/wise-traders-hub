// expert-ai-chat 串流整合測試
//
// 兩個層次：
//  A. 純函式：驗證 `convertToModelMessages` 能接受本專案送出的 UIMessage 形狀
//     （避免 ai / @ai-sdk/* 版本錯位時 `messages.some is not a function` 這類爆炸）。
//  B. 端到端串流：需要真實 user JWT + 有 active 訂閱的 expert_id。
//     由環境變數 gate，未設定時自動 skip，讓本檔在 CI / 本地都能安全跑。
//
// 相關環境變數（可選）：
//   EXPERT_AI_TEST_USER_JWT    — 有效登入 session access_token
//   EXPERT_AI_TEST_EXPERT_ID   — 該 user 有 active 訂閱的 expert_id
//
// 執行：
//   supabase functions test expert-ai-chat  (或 deno test --allow-net --allow-env)

import { convertToModelMessages, type UIMessage } from "npm:ai@^5.0.0";
import { fnUrl, drain, assertCorsAndCorrelation } from "../_shared/test_utils.ts";

const FN = "expert-ai-chat";

// ---------- A. convertToModelMessages 形狀契約 ----------
Deno.test(`${FN} — convertToModelMessages 接受本專案 UIMessage 形狀`, () => {
  const uiMessages: UIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "你好" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "你好，我可以幫你？" }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "AI 族群怎麼看？" }] },
  ];
  const modelMessages = convertToModelMessages(uiMessages);
  if (!Array.isArray(modelMessages) || modelMessages.length !== 3) {
    throw new Error(`unexpected modelMessages length: ${modelMessages?.length}`);
  }
  const roles = modelMessages.map((m: any) => m.role);
  if (JSON.stringify(roles) !== JSON.stringify(["user", "assistant", "user"])) {
    throw new Error(`role order mismatch: ${roles.join(",")}`);
  }
  for (const m of modelMessages as any[]) {
    if (m.content == null) {
      throw new Error(`converted message missing content: ${JSON.stringify(m)}`);
    }
  }
});

Deno.test(`${FN} — convertToModelMessages 拒絕 (or 忽略) 無 parts 的舊格式`, () => {
  // 若上游改用 role/content 舊格式送過來，convertToModelMessages 會丟例外。
  // 本測試「期望」它爆掉，正是我們前端必須送 parts 的原因。
  const bad = [{ id: "x", role: "user", content: "hi" } as unknown as UIMessage];
  let threw = false;
  try {
    convertToModelMessages(bad);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      "convertToModelMessages 應該對無 parts 的訊息丟例外；若通過代表 AI SDK 語意改變，" +
      "請同步檢查前端 useExpertAiChat.historyToUIMessages 是否仍需要送 parts。",
    );
  }
});

// ---------- B. 端到端串流（gated） ----------
const USER_JWT = Deno.env.get("EXPERT_AI_TEST_USER_JWT");
const EXPERT_ID = Deno.env.get("EXPERT_AI_TEST_EXPERT_ID");

Deno.test({
  name: `${FN} — [live] streamText 回傳可讀 SSE (需 EXPERT_AI_TEST_USER_JWT + EXPERT_ID)`,
  ignore: !USER_JWT || !EXPERT_ID,
  async fn() {
    const cid = `test-${crypto.randomUUID()}`;
    const res = await fetch(fnUrl(FN), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${USER_JWT}`,
        "content-type": "application/json",
        "x-correlation-id": cid,
      },
      body: JSON.stringify({
        expert_id: EXPERT_ID,
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "請用一句話自我介紹。" }] },
        ],
      }),
    });

    assertCorsAndCorrelation(res, cid);

    if (res.status !== 200) {
      const text = await drain(res);
      throw new Error(`expected 200 streaming response, got ${res.status}: ${text}`);
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    // UIMessageStream 走 SSE
    if (!ct.includes("event-stream") && !ct.includes("text/plain")) {
      await drain(res);
      throw new Error(`expected event-stream / text response, got content-type=${ct}`);
    }

    if (!res.body) throw new Error("missing response body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const started = Date.now();
    // 至少讀到 1 個非空 chunk 或 10 秒 timeout
    while (Date.now() - started < 10_000) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      received += chunk;
      if (received.trim().length > 0) break;
    }
    try { await reader.cancel(); } catch { /* ignore */ }

    if (received.trim().length === 0) {
      throw new Error("串流回傳為空，streamText 可能未輸出任何內容");
    }
    // UIMessageStream 每筆 chunk 是 JSON line；驗證能被解析（至少一行）
    const firstLine = received.split("\n").map((s) => s.trim()).find((s) => s.length > 0);
    if (!firstLine) throw new Error("no parsable first chunk");
    try {
      // 允許 `data: {...}` (SSE) 或直接 JSON line
      const jsonText = firstLine.startsWith("data:") ? firstLine.slice(5).trim() : firstLine;
      if (jsonText && jsonText !== "[DONE]") JSON.parse(jsonText);
    } catch (e) {
      throw new Error(`first chunk 非合法 JSON/SSE：${firstLine} (${(e as Error).message})`);
    }
  },
});
