// expert-ai-chat 串流中途拋錯測試
//
// 覆蓋兩層契約：
//   1. 錯誤訊息格式（formatStreamErrorMessage）必須包含 errorId，
//      且能被前端 `errorIdParser.ts` 的 regex 解析。
//   2. 以 MockLanguageModelV2 模擬 streamText 在串流中途拋錯，
//      驗證 toUIMessageStreamResponse.onError 產出的字串同樣可被解析。
//
// 執行：
//   deno test --allow-net --allow-env --no-check supabase/functions/expert-ai-chat/stream_error_test.ts

import { streamText, convertToModelMessages, type UIMessage } from "npm:ai@^5.0.0";
import { MockLanguageModelV2, simulateReadableStream } from "npm:ai@^5.0.0/test";
import { formatStreamErrorMessage, ERROR_ID_PATTERN } from "../_shared/stream-error.ts";
import { generateErrorId } from "../_shared/cors.ts";

const FN = "expert-ai-chat";

// ---------- 1. 純格式契約 ----------
Deno.test(`${FN} — formatStreamErrorMessage 產出可被前端 regex 解析的 errorId`, () => {
  const errorId = generateErrorId();
  const msg = formatStreamErrorMessage(errorId, "AI_GatewayError: 502 bad gateway");

  if (!msg.includes(errorId)) {
    throw new Error(`錯誤訊息缺 errorId: ${msg}`);
  }
  const m = msg.match(ERROR_ID_PATTERN);
  if (!m || m[1] !== errorId) {
    throw new Error(`前端 regex 無法從 "${msg}" 抽出 errorId=${errorId}, got=${m?.[1]}`);
  }
});

Deno.test(`${FN} — generateErrorId 格式符合 err_<base36>_<6> 供前端 regex`, () => {
  for (let i = 0; i < 20; i++) {
    const id = generateErrorId();
    if (!/^err_[a-z0-9]+_[a-z0-9]{6}$/.test(id)) {
      throw new Error(`errorId 不符預期格式: ${id}`);
    }
    if (!ERROR_ID_PATTERN.test(`errorId: ${id}`)) {
      throw new Error(`errorId 不能被前端 regex 抽出: ${id}`);
    }
  }
});

// ---------- 2. 模擬 streamText 中途拋錯 → onError 回傳含 errorId ----------
Deno.test(`${FN} — streamText 中途拋錯時，toUIMessageStreamResponse.onError 回傳含 errorId 字串`, async () => {
  // Mock 一顆會先吐兩個 text-delta、然後在 stream 中拋錯的 language model
  const throwingModel = new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "嗨" },
          { type: "text-delta", id: "t1", delta: "，我是" },
          // 這一顆會被 streamText 視為串流失敗
          { type: "error", error: new Error("upstream rate limit exceeded") },
        ],
      }),
    }),
  });

  const uiMessages: UIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
  ];

  let capturedOnErrorPayload = "";
  const result = streamText({
    model: throwingModel,
    messages: convertToModelMessages(uiMessages),
    // 忽略內部 error log，避免測試輸出被 noise 淹沒
    onError: () => {},
  });

  const response = result.toUIMessageStreamResponse({
    originalMessages: uiMessages,
    onError: (error) => {
      const errorId = generateErrorId();
      const msg = error instanceof Error ? error.message : String(error);
      const out = formatStreamErrorMessage(errorId, msg);
      capturedOnErrorPayload = out;
      return out;
    },
  });

  if (!response.body) throw new Error("no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }

  // 2-a. onError callback 應被觸發並回傳含 errorId 的字串
  if (!capturedOnErrorPayload) {
    throw new Error(`onError 未被觸發，received stream: ${received}`);
  }
  const idMatch = capturedOnErrorPayload.match(ERROR_ID_PATTERN);
  if (!idMatch) {
    throw new Error(`onError 回傳的字串未含可解析 errorId: ${capturedOnErrorPayload}`);
  }
  const errorId = idMatch[1];

  // 2-b. UIMessageStream 輸出中應該找得到同一個 errorId
  //      （AI SDK 會把 onError 回傳字串包在 error chunk 送到前端）
  if (!received.includes(errorId)) {
    throw new Error(
      `串流輸出未包含 errorId=${errorId}，代表 onError 產物沒送到前端。stream=\n${received}`,
    );
  }

  // 2-c. 前後端共用 regex 也能從 UIMessage stream 原文中抽出 errorId
  const streamMatch = received.match(ERROR_ID_PATTERN);
  if (!streamMatch || streamMatch[1] !== errorId) {
    throw new Error(
      `前端 regex 無法從串流輸出抽出正確 errorId: expected=${errorId}, got=${streamMatch?.[1]}`,
    );
  }
});
