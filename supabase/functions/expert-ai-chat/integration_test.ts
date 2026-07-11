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
import { fnUrl, drain, assertCorsAndCorrelation, authHeaders } from "../_shared/test_utils.ts";

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

// UIMessageStream v5 官方 chunk `type` 白名單（節錄自 @ai-sdk/ui-utils）；
// 若模型或 SDK 版本改動導致新增 type，先讓測試失敗、再決定是否加入白名單。
const KNOWN_UI_STREAM_TYPES = new Set([
  "start",
  "start-step",
  "text-start",
  "text-delta",
  "text",
  "text-end",
  "reasoning",
  "reasoning-start",
  "reasoning-delta",
  "reasoning-end",
  "tool-input-start",
  "tool-input-delta",
  "tool-input-available",
  "tool-output-available",
  "source-url",
  "source-document",
  "file",
  "message-metadata",
  "finish-step",
  "finish",
  "error",
  "abort",
]);

Deno.test({
  name: `${FN} — [live] streamText SSE chunk 結構 / content-type / 錯誤傳遞`,
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

    // 1) 回傳的 x-correlation-id 必須等於送出的 cid
    const echoedCid = assertCorsAndCorrelation(res, cid);
    if (echoedCid !== cid) {
      await drain(res);
      throw new Error(`x-correlation-id 未回傳 (expected=${cid}, got=${echoedCid})`);
    }

    if (res.status !== 200) {
      const text = await drain(res);
      throw new Error(`expected 200 streaming response, got ${res.status}: ${text}`);
    }

    // 2) 200 串流時通常不會帶 x-error-id；若有代表 pipeline 誤放
    const headerErrIdOn200 = res.headers.get("x-error-id");
    if (headerErrIdOn200) {
      await drain(res);
      throw new Error(`200 串流不應帶 x-error-id，實際=${headerErrIdOn200}`);
    }

    // ---------- content-type 嚴格檢查 ----------
    const ctRaw = res.headers.get("content-type") || "";
    const ct = ctRaw.toLowerCase();
    const isSse = ct.includes("text/event-stream");
    const isPlain = ct.includes("text/plain");
    if (!isSse && !isPlain) {
      await drain(res);
      throw new Error(`content-type 非串流格式：${ctRaw}`);
    }
    if (!ct.includes("charset=utf-8")) {
      // charset 缺失可能導致中文亂碼；SDK 預設會加，這裡當回歸警戒
      await drain(res);
      throw new Error(`content-type 缺 charset=utf-8：${ctRaw}`);
    }

    // AI SDK v5 會加這顆 header 表明是 UIMessageStream；缺了代表 pipeline 被改過
    if (isSse) {
      const streamHeader = res.headers.get("x-vercel-ai-ui-message-stream");
      if (streamHeader && streamHeader !== "v1") {
        await drain(res);
        throw new Error(`未預期的 UIMessageStream 版本：${streamHeader}`);
      }
    }

    // ---------- 讀取足夠多的 chunk：最少 3 個或直到 finish / 10 秒 ----------
    if (!res.body) throw new Error("missing response body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let received = "";
    const events: Array<{ raw: string; payload: string }> = [];
    const started = Date.now();
    let sawFinish = false;

    const flushBuffer = () => {
      // SSE 以 \n\n 分隔一筆事件；非 SSE 走 line-by-line
      const sep = isSse ? "\n\n" : "\n";
      let idx: number;
      while ((idx = buffer.indexOf(sep)) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + sep.length);
        if (!raw.trim()) continue;
        // SSE 允許多行；取所有 `data:` 行
        const dataLines = raw.split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("data:"));
        const payload = isSse
          ? dataLines.map((l) => l.slice(5).trim()).join("\n")
          : raw.trim();
        if (!payload) continue;
        events.push({ raw, payload });
        if (payload === "[DONE]") sawFinish = true;
        else {
          try {
            const obj = JSON.parse(payload);
            if (obj?.type === "finish") sawFinish = true;
          } catch { /* 下面統一驗證 */ }
        }
      }
    };

    while (Date.now() - started < 10_000) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      received += chunk;
      buffer += chunk;
      flushBuffer();
      if (sawFinish && events.length >= 3) break;
      if (events.length >= 20) break; // 已經夠驗證了，別無限吃 token
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    // 處理最後殘留（可能沒有 trailing separator）
    if (buffer.trim().length > 0) {
      buffer += isSse ? "\n\n" : "\n";
      flushBuffer();
    }

    // ---------- 結構驗證 ----------
    if (events.length === 0) {
      throw new Error(`串流為空。raw=${JSON.stringify(received).slice(0, 500)}`);
    }
    if (events.length < 2) {
      throw new Error(
        `串流事件過少 (${events.length})，預期至少 start + 一筆 text/finish。raw=${received.slice(0, 500)}`,
      );
    }

    // 逐筆解析、驗證 type 在白名單內
    const parsed: Array<any> = [];
    for (const ev of events) {
      if (ev.payload === "[DONE]") continue;
      let obj: any;
      try {
        obj = JSON.parse(ev.payload);
      } catch (e) {
        throw new Error(
          `chunk 不是合法 JSON：${ev.payload.slice(0, 200)} (${(e as Error).message})`,
        );
      }
      if (!obj || typeof obj !== "object") {
        throw new Error(`chunk 非 object：${ev.payload.slice(0, 200)}`);
      }
      if (typeof obj.type !== "string") {
        throw new Error(`chunk 缺 type 欄位：${ev.payload.slice(0, 200)}`);
      }
      if (!KNOWN_UI_STREAM_TYPES.has(obj.type)) {
        throw new Error(
          `未知 UIMessageStream chunk type=${obj.type}；若 SDK 升版請更新 KNOWN_UI_STREAM_TYPES。payload=${ev.payload.slice(0, 200)}`,
        );
      }
      parsed.push(obj);
    }

    // 第一個事件必須是 start（AI SDK v5 契約）
    if (parsed[0]?.type !== "start") {
      throw new Error(
        `第一個 chunk 應為 type=start，實際=${parsed[0]?.type}。events=${JSON.stringify(parsed.slice(0, 5))}`,
      );
    }

    // 必須至少出現一個文字類 chunk（text-delta / text / text-start）——這是使用者實際看到的內容
    const hasTextish = parsed.some((p) =>
      p.type === "text-delta" || p.type === "text" || p.type === "text-start"
    );
    if (!hasTextish) {
      throw new Error(
        `串流未包含任何 text 類 chunk，模型可能回空。events=${JSON.stringify(parsed.slice(0, 10))}`,
      );
    }

    // text-delta 必須有 id + delta:string；text 必須有 text:string
    for (const p of parsed) {
      if (p.type === "text-delta") {
        if (typeof p.id !== "string" || typeof p.delta !== "string") {
          throw new Error(`text-delta 結構錯誤：${JSON.stringify(p)}`);
        }
      }
      if (p.type === "text" && typeof p.text !== "string") {
        throw new Error(`text 結構錯誤：${JSON.stringify(p)}`);
      }
      if (p.type === "error") {
        // 若真的收到 error，訊息必須含 errorId（本專案 onError 合約）
        const msg = typeof p.errorText === "string" ? p.errorText : JSON.stringify(p);
        const m = msg.match(/errorId[:：]\s*(err_[a-z0-9_]+)/i);
        if (!m) {
          throw new Error(`error chunk 未帶 errorId，違反前端解析合約：${msg}`);
        }
        // x-error-id header 若存在，必須與 payload 內 errorId 一致
        const headerErrId = res.headers.get("x-error-id");
        if (headerErrId && headerErrId !== m[1]) {
          throw new Error(
            `x-error-id (${headerErrId}) 與 error chunk 內 errorId (${m[1]}) 不一致`,
          );
        }
      }
    }
  },
});

// ---------- C. 400 錯誤路徑的 id 對齊（非 gated，永遠會跑） ----------
// 打帶有 cid 的無效 body → 應該回：
//   - status 400
//   - x-correlation-id === 送出的 cid
//   - x-error-id 存在
//   - JSON body.errorId === x-error-id
//   - JSON body.code 有值
// 這條測試確保「前端 toast 顯示的 errorId」==「後端 log 印出的 errorId」，
// 是回報追查唯一穩定的關聯鍵。
Deno.test(`${FN} — 400 錯誤路徑：x-correlation-id / x-error-id / body.errorId 三者一致`, async () => {
  const cid = `test-${crypto.randomUUID()}`;
  const res = await fetch(fnUrl(FN), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-correlation-id": cid }),
    // 缺 expert_id / messages → index.ts 走 errorResponse('expert_id and messages required', 400)
    body: JSON.stringify({}),
  });
  const text = await drain(res);

  // cid 回傳一致
  const echoedCid = assertCorsAndCorrelation(res, cid);
  if (echoedCid !== cid) {
    throw new Error(`x-correlation-id mismatch: expected=${cid} got=${echoedCid}`);
  }

  // 未帶 Authorization → 401 也 OK；只驗 4xx 且合約一致
  if (res.status < 400 || res.status >= 500) {
    throw new Error(`expected 4xx, got ${res.status}: ${text}`);
  }

  const headerErrId = res.headers.get("x-error-id");
  if (!headerErrId) throw new Error(`錯誤回應缺 x-error-id header: ${text}`);
  if (!/^err_[a-z0-9]+_[a-z0-9]{6}$/.test(headerErrId)) {
    throw new Error(`x-error-id 格式錯誤：${headerErrId}`);
  }

  let body: any;
  try { body = JSON.parse(text); } catch {
    throw new Error(`錯誤回應不是 JSON：${text.slice(0, 200)}`);
  }
  if (body.errorId !== headerErrId) {
    throw new Error(
      `body.errorId (${body.errorId}) !== x-error-id header (${headerErrId})`,
    );
  }
  if (typeof body.code !== "string" || !body.code) {
    throw new Error(`錯誤 body 缺 code：${JSON.stringify(body)}`);
  }
  if (typeof body.message !== "string" || !body.message) {
    throw new Error(`錯誤 body 缺 message：${JSON.stringify(body)}`);
  }
});

