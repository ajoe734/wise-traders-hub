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

// ---------- 串流可觀察性上報 ----------
// 環境變數：
//   STREAM_METRICS_REPORT_URL — 目標 endpoint（一般指向部署後的 stream-metrics-report edge function）
//   STREAM_METRICS_REPORT_TOKEN — 可選，帶入 Authorization: Bearer
// 未設定 URL 時整條路徑靜默 skip，本地與 CI 都不受影響。
type StreamMetricsPayload = {
  source: string;
  terminatedBy: "finish" | "abort" | "timeout" | "eof";
  eventCount: number;
  elapsedMs: number;
  correlationId?: string | null;
  errorId?: string | null;
  contentType?: string | null;
  extra?: Record<string, string | number | boolean>;
};
const pendingReports = new Set<Promise<unknown>>();
function reportStreamMetrics(payload: StreamMetricsPayload) {
  const url = Deno.env.get("STREAM_METRICS_REPORT_URL");
  if (!url) return;
  const token = Deno.env.get("STREAM_METRICS_REPORT_TOKEN");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const p = fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...payload,
      testName: Deno.env.get("STREAM_METRICS_TEST_NAME") || undefined,
    }),
  })
    .then(async (r) => { try { await r.body?.cancel(); } catch { /* noop */ } })
    .catch((e) => { console.warn(`[stream-metrics-report] 上報失敗：${(e as Error).message}`); })
    .finally(() => { pendingReports.delete(p); });
  pendingReports.add(p);
}
// 讓測試結束前把 fire-and-forget 的上報 drain 掉，避免 Deno.test 抱怨 leaked async ops。
export async function flushStreamMetricsReports() {
  if (!pendingReports.size) return;
  await Promise.allSettled(Array.from(pendingReports));
}


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

/**
 * 解析 UIMessageStream Response，同時驗證 content-type、chunk 結構、type 白名單。
 * SSE 與 text/plain 兩種 pipeline 都走這條，確保：
 *   - live SSE 部署一升版就會被抓到
 *   - text/plain fallback（例如 SDK 降級或 proxy 剝掉 event-stream）解析也不掉
 * 回傳 parsed chunks，方便呼叫端做更多斷言（如 x-error-id 對比）。
 */
async function parseAndValidateUiStream(res: Response, opts: {
  maxChunks?: number;
  timeoutMs?: number;
  /** true → 出現 finish/abort 之後若還有非 [DONE] chunk 直接視為違約 */
  strictTerminal?: boolean;
  /** false → 允許串流不含任何 text 類 chunk（例如立刻 abort 的情境） */
  requireTextish?: boolean;
  /** 觀察用：可拿到終止事件的實際發生時間，方便斷言 timeout 可重現 */
  onDone?: (info: { elapsedMs: number; terminatedBy: "finish" | "abort" | "timeout" | "eof"; eventCount: number }) => void;
  /** 上報用：識別本次解析的來源（測試名稱 / synthetic case）；會落到 stream-metrics-report log。 */
  source?: string;
  /** 額外欄位一起上報（純觀察，值只接受 string/number/boolean）。 */
  reportExtra?: Record<string, string | number | boolean>;
} = {}): Promise<Array<any>> {
  const maxChunks = opts.maxChunks ?? 20;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const requireTextish = opts.requireTextish ?? true;
  const strictTerminal = opts.strictTerminal ?? false;

  // ---- content-type ----
  const ctRaw = res.headers.get("content-type") || "";
  const ct = ctRaw.toLowerCase();
  const isSse = ct.includes("text/event-stream");
  const isPlain = ct.includes("text/plain");
  if (!isSse && !isPlain) {
    await drain(res);
    throw new Error(`content-type 非串流格式：${ctRaw}`);
  }
  if (!ct.includes("charset=utf-8")) {
    await drain(res);
    throw new Error(`content-type 缺 charset=utf-8：${ctRaw}`);
  }
  if (isSse) {
    const streamHeader = res.headers.get("x-vercel-ai-ui-message-stream");
    if (streamHeader && streamHeader !== "v1") {
      await drain(res);
      throw new Error(`未預期的 UIMessageStream 版本：${streamHeader}`);
    }
  }

  // ---- 讀 + 切事件 ----
  if (!res.body) throw new Error("missing response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = "";
  const events: Array<{ raw: string; payload: string }> = [];
  const started = Date.now();
  let terminatedBy: "finish" | "abort" | "timeout" | "eof" | null = null;

  const flushBuffer = () => {
    const sep = isSse ? "\n\n" : "\n";
    let idx: number;
    while ((idx = buffer.indexOf(sep)) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + sep.length);
      if (!raw.trim()) continue;
      let payload: string;
      if (isSse) {
        const dataLines = raw.split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("data:"));
        payload = dataLines.map((l) => l.slice(5).trim()).join("\n");
      } else {
        payload = raw.trim();
      }
      if (!payload) continue;
      events.push({ raw, payload });
      if (payload === "[DONE]") {
        if (!terminatedBy) terminatedBy = "finish";
      } else {
        try {
          const obj = JSON.parse(payload);
          if (obj?.type === "finish" && !terminatedBy) terminatedBy = "finish";
          if (obj?.type === "abort" && !terminatedBy) terminatedBy = "abort";
        } catch { /* 下面統一驗證 */ }
      }
    }
  };

  // 用 Promise.race 讓 timeoutMs 成為硬上限，即使上游 stream 永遠不 close
  // 也不會卡住整個測試 —— 這條契約是可重現超時的關鍵。
  while (true) {
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) { terminatedBy = terminatedBy ?? "timeout"; break; }
    const remaining = timeoutMs - elapsed;
    let step: { done: boolean; value?: Uint8Array } | "timeout";
    let timeoutHandle: number | undefined;
    try {
      step = await Promise.race([
        reader.read().then((r) => r as { done: boolean; value?: Uint8Array }),
        new Promise<"timeout">((resolve) => {
          timeoutHandle = setTimeout(() => resolve("timeout"), remaining);
        }),
      ]);
    } catch (e) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      throw new Error(`stream read 失敗：${(e as Error).message}`);
    }
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

    if (step === "timeout") { terminatedBy = terminatedBy ?? "timeout"; break; }
    if (step.done) { terminatedBy = terminatedBy ?? "eof"; break; }
    const chunk = decoder.decode(step.value!, { stream: true });
    received += chunk;
    buffer += chunk;
    flushBuffer();
    if (terminatedBy && events.length >= 3) break;
    if (events.length >= maxChunks) break;
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  if (buffer.trim().length > 0) {
    buffer += isSse ? "\n\n" : "\n";
    flushBuffer();
  }

  const finalInfo = {
    elapsedMs: Date.now() - started,
    terminatedBy: (terminatedBy ?? "eof") as "finish" | "abort" | "timeout" | "eof",
    eventCount: events.length,
  };
  opts.onDone?.(finalInfo);
  // 非同步上報到 stream-metrics-report（設定 STREAM_METRICS_REPORT_URL 才啟用），
  // 讓 chunk 洩漏 / 協議漂移 / eventCount 突增 / elapsedMs 尾巴變長之類的問題
  // 在 Edge Function Logs 就能直接查，不用等下次 CI。
  reportStreamMetrics({
    ...finalInfo,
    source: opts.source ?? "parseAndValidateUiStream",
    correlationId: res.headers.get("x-correlation-id"),
    errorId: res.headers.get("x-error-id"),
    contentType: ctRaw,
    extra: opts.reportExtra,
  });

  // ---- 結構驗證 ----
  if (events.length === 0) {
    throw new Error(`串流為空 (ct=${ctRaw})。raw=${JSON.stringify(received).slice(0, 500)}`);
  }
  if (requireTextish && events.length < 2) {
    throw new Error(
      `串流事件過少 (${events.length}, ct=${ctRaw})，預期至少 start + 一筆 text/finish。raw=${received.slice(0, 500)}`,
    );
  }

  const parsed: Array<any> = [];
  let terminalIdx = -1;
  for (const ev of events) {
    if (ev.payload === "[DONE]") continue;
    let obj: any;
    try {
      obj = JSON.parse(ev.payload);
    } catch (e) {
      throw new Error(
        `chunk 不是合法 JSON (ct=${ctRaw})：${ev.payload.slice(0, 200)} (${(e as Error).message})`,
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
    if (strictTerminal && terminalIdx >= 0) {
      throw new Error(
        `終止事件 (${parsed[terminalIdx].type}) 之後仍出現 chunk type=${obj.type}；` +
        `UIMessageStream 契約要求 finish/abort 為最後一筆。payload=${ev.payload.slice(0, 200)}`,
      );
    }
    if (obj.type === "finish" || obj.type === "abort") {
      terminalIdx = parsed.length;
    }
    parsed.push(obj);
  }

  if (parsed[0]?.type !== "start") {
    throw new Error(
      `第一個 chunk 應為 type=start，實際=${parsed[0]?.type} (ct=${ctRaw})。events=${JSON.stringify(parsed.slice(0, 5))}`,
    );
  }

  if (requireTextish) {
    const hasTextish = parsed.some((p) =>
      p.type === "text-delta" || p.type === "text" || p.type === "text-start"
    );
    if (!hasTextish) {
      throw new Error(
        `串流未包含任何 text 類 chunk (ct=${ctRaw})。events=${JSON.stringify(parsed.slice(0, 10))}`,
      );
    }
  }

  for (const p of parsed) {
    if (p.type === "text-delta") {
      if (typeof p.id !== "string" || typeof p.delta !== "string") {
        throw new Error(`text-delta 結構錯誤 (ct=${ctRaw})：${JSON.stringify(p)}`);
      }
    }
    if (p.type === "text" && typeof p.text !== "string") {
      throw new Error(`text 結構錯誤 (ct=${ctRaw})：${JSON.stringify(p)}`);
    }
  }

  return parsed;
}





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

    // 走共用 helper，SSE / text-plain 兩條路徑用同一份斷言
    const parsed = await parseAndValidateUiStream(res);

    // 若真的收到 error chunk，額外驗 x-error-id header 對齊
    for (const p of parsed) {
      if (p.type === "error") {
        const msg = typeof p.errorText === "string" ? p.errorText : JSON.stringify(p);
        const m = msg.match(/errorId[:：]\s*(err_[a-z0-9_]+)/i);
        if (!m) throw new Error(`error chunk 未帶 errorId：${msg}`);
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

// ---------- B'. 合成串流測試（非 gated，永遠會跑） ----------
// 目的：即使沒有 live 訂閱環境，也要保證 parseAndValidateUiStream 在
//   (a) text/event-stream          — SDK 預設輸出
//   (b) text/plain; charset=utf-8  — SDK 降級 / proxy 剝掉 event-stream 時的 fallback
// 兩條 pipeline 上都能正確切事件、對齊白名單、抓出結構缺失。
//
// 這也守護了 useExpertAiChat.ts 前端解析行為 — 前端目前只依賴
// `data:` 前綴 + JSON 每行的合約，兩條分支只要有一條壞了，這裡會先炸。

function makeStreamResponse(body: string, contentType: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType, ...extraHeaders },
  });
}

// 6 個標準 chunk：start / start-step / text-start / text-delta / text-end / finish
const GOLDEN_CHUNKS = [
  { type: "start" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "嗨，我是老師 AI 分身。" },
  { type: "text-end", id: "t1" },
  { type: "finish" },
];

function toSseBody(chunks: any[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}

function toPlainBody(chunks: any[]): string {
  return chunks.map((c) => JSON.stringify(c)).join("\n") + "\n";
}

Deno.test(`${FN} — 合成 SSE 串流：content-type/chunk 結構通過`, async () => {
  const res = makeStreamResponse(
    toSseBody(GOLDEN_CHUNKS),
    "text/event-stream; charset=utf-8",
    { "x-vercel-ai-ui-message-stream": "v1" },
  );
  const parsed = await parseAndValidateUiStream(res);
  if (parsed[0].type !== "start") throw new Error(`first != start: ${parsed[0].type}`);
  if (!parsed.some((p) => p.type === "text-delta" && p.delta.includes("嗨"))) {
    throw new Error("text-delta 內容遺失");
  }
  if (parsed[parsed.length - 1].type !== "finish") {
    throw new Error(`last != finish: ${parsed[parsed.length - 1].type}`);
  }
});

Deno.test(`${FN} — 合成 text/plain 串流：content-type/chunk 結構通過（SSE fallback）`, async () => {
  const res = makeStreamResponse(
    toPlainBody(GOLDEN_CHUNKS),
    "text/plain; charset=utf-8",
  );
  const parsed = await parseAndValidateUiStream(res);
  if (parsed[0].type !== "start") throw new Error(`first != start: ${parsed[0].type}`);
  if (!parsed.some((p) => p.type === "text-delta")) throw new Error("缺 text-delta");
  if (parsed[parsed.length - 1].type !== "finish") throw new Error("缺 finish");
});

Deno.test(`${FN} — 合成 text/plain：缺 charset=utf-8 → 拒收`, async () => {
  const res = makeStreamResponse(toPlainBody(GOLDEN_CHUNKS), "text/plain");
  let threw = false;
  try { await parseAndValidateUiStream(res); } catch (e) {
    if (!/charset=utf-8/.test((e as Error).message)) throw e;
    threw = true;
  }
  if (!threw) throw new Error("缺 charset=utf-8 應該被拒");
});

Deno.test(`${FN} — 合成 SSE：未知 chunk type → 立即失敗，防 SDK 靜默升版`, async () => {
  const bad = [...GOLDEN_CHUNKS.slice(0, 3), { type: "quantum-teleport", foo: 1 }, ...GOLDEN_CHUNKS.slice(3)];
  const res = makeStreamResponse(
    toSseBody(bad),
    "text/event-stream; charset=utf-8",
    { "x-vercel-ai-ui-message-stream": "v1" },
  );
  let threw = false;
  try { await parseAndValidateUiStream(res); } catch (e) {
    if (!/未知 UIMessageStream chunk type=quantum-teleport/.test((e as Error).message)) throw e;
    threw = true;
  }
  if (!threw) throw new Error("未知 chunk type 應該被擋");
});

Deno.test(`${FN} — 合成 SSE：非 start 開頭 → 拒收`, async () => {
  const res = makeStreamResponse(
    toSseBody(GOLDEN_CHUNKS.slice(1)), // 少了 start
    "text/event-stream; charset=utf-8",
    { "x-vercel-ai-ui-message-stream": "v1" },
  );
  let threw = false;
  try { await parseAndValidateUiStream(res); } catch (e) {
    if (!/第一個 chunk 應為 type=start/.test((e as Error).message)) throw e;
    threw = true;
  }
  if (!threw) throw new Error("非 start 開頭應該被擋");
});

Deno.test(`${FN} — 合成 text/plain：text-delta 缺 id/delta → 拒收`, async () => {
  const bad = [
    { type: "start" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1" }, // 缺 delta
    { type: "finish" },
  ];
  const res = makeStreamResponse(toPlainBody(bad), "text/plain; charset=utf-8");
  let threw = false;
  try { await parseAndValidateUiStream(res); } catch (e) {
    if (!/text-delta 結構錯誤/.test((e as Error).message)) throw e;
    threw = true;
  }
  if (!threw) throw new Error("text-delta 缺欄位應該被擋");
});

Deno.test(`${FN} — 合成非串流 content-type (application/json) → 拒收`, async () => {
  const res = makeStreamResponse(toPlainBody(GOLDEN_CHUNKS), "application/json; charset=utf-8");
  let threw = false;
  try { await parseAndValidateUiStream(res); } catch (e) {
    if (!/非串流格式/.test((e as Error).message)) throw e;
    threw = true;
  }
  if (!threw) throw new Error("非串流 content-type 應該被擋");
});

// ---------- B''. 中文內容解碼（非 gated，永遠會跑） ----------
// 目的：確認在宣告 charset=utf-8 前提下，前幾個 chunk 解碼後仍保留完整中文，
// 且即使 ReadableStream 在 UTF-8 多位元組字元的中間切斷，TextDecoder(stream:true)
// 仍能正確拼回，避免中文亂碼導致偶發失敗。
const CJK_CHUNKS = [
  { type: "start" },
  { type: "start-step" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "你好，我是「老師」的 AI 分身。" },
  { type: "text-delta", id: "t1", delta: "今天想聊點什麼？📈 台股、AI 族群都可以。" },
  { type: "text-delta", id: "t1", delta: "請自行判斷風險，我不會給你買賣訊號。" },
  { type: "text-end", id: "t1" },
  { type: "finish" },
];

function assertCjkDeltasIntact(parsed: any[]) {
  const deltas = parsed.filter((p) => p.type === "text-delta").map((p) => p.delta);
  const joined = deltas.join("");
  for (const kw of ["你好", "老師", "AI 分身", "台股", "買賣訊號", "📈"]) {
    if (!joined.includes(kw)) {
      throw new Error(`中文/emoji 解碼遺失關鍵字「${kw}」，實際=${JSON.stringify(joined)}`);
    }
  }
  // 亂碼常見 sentinel：� (U+FFFD replacement char) 出現即代表 decoder 掉字
  if (joined.includes("\uFFFD")) {
    throw new Error(`偵測到 U+FFFD replacement char，代表 UTF-8 解碼失敗：${JSON.stringify(joined)}`);
  }
}

Deno.test(`${FN} — 合成 SSE：中文內容在 charset=utf-8 下前幾 chunk 完整可讀`, async () => {
  const res = makeStreamResponse(
    toSseBody(CJK_CHUNKS),
    "text/event-stream; charset=utf-8",
    { "x-vercel-ai-ui-message-stream": "v1" },
  );
  const parsed = await parseAndValidateUiStream(res);
  assertCjkDeltasIntact(parsed);
});

Deno.test(`${FN} — 合成 text/plain：中文內容在 charset=utf-8 下前幾 chunk 完整可讀`, async () => {
  const res = makeStreamResponse(
    toPlainBody(CJK_CHUNKS),
    "text/plain; charset=utf-8",
  );
  const parsed = await parseAndValidateUiStream(res);
  assertCjkDeltasIntact(parsed);
});

// 把 body 編碼為 UTF-8 bytes 後，在「隨機」位元組邊界切斷（含多位元組字元中間），
// 用 ReadableStream 分段吐出。若 parseAndValidateUiStream 內部 TextDecoder 沒開
// stream:true，或有人改成一次性 decode，就會出現 U+FFFD 或 JSON.parse 失敗。
function makeChunkedStreamResponse(body: string, contentType: string, chunkSize: number, extraHeaders: Record<string, string> = {}): Response {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
        // 讓出一次 microtask，模擬真實網路分段
        await Promise.resolve();
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": contentType, ...extraHeaders },
  });
}

Deno.test(`${FN} — 合成 SSE：中文位元組被切在多位元組邊界仍能正確解碼`, async () => {
  const body = toSseBody(CJK_CHUNKS);
  // chunkSize=7 蓄意會落在中文/emoji 的 UTF-8 中間位元組
  const res = makeChunkedStreamResponse(
    body,
    "text/event-stream; charset=utf-8",
    7,
    { "x-vercel-ai-ui-message-stream": "v1" },
  );
  const parsed = await parseAndValidateUiStream(res);
  assertCjkDeltasIntact(parsed);
});

Deno.test(`${FN} — 合成 text/plain：中文位元組被切在多位元組邊界仍能正確解碼`, async () => {
  const body = toPlainBody(CJK_CHUNKS);
  const res = makeChunkedStreamResponse(body, "text/plain; charset=utf-8", 5);
  const parsed = await parseAndValidateUiStream(res);
  assertCjkDeltasIntact(parsed);
});


// ---------- B'''. finish / abort 終止契約 + 可重現的 timeout（非 gated） ----------
// UIMessageStream v5 契約：finish（或 abort）必須是 stream 的最後一筆事件。
// 前端 useChat 在看到 finish 之後會 flush 訊息並關閉 reader，若上游 SDK 因升版
// 或 pipeline bug 在終止事件後仍多吐 chunk，會導致：
//   - 前端已 flush，多出來的 chunk 被吞掉但埋在 log 裡追不到
//   - onFinish 統計錯亂（例如 token count / message.parts）
// 這條測試把它變成硬合約，SDK 一改就先炸。
//
// 同時驗證：即使 upstream 永遠不 close（模擬 gateway 掛掉），parseAndValidateUiStream
// 也必須在 timeoutMs 內硬中止並回報 terminatedBy=timeout，讓 CI 不會卡住整場。

Deno.test(`${FN} — 合成 SSE：finish 為最後一筆，strictTerminal 通過`, async () => {
  let observed: { terminatedBy: string; eventCount: number } | null = null;
  const res = makeStreamResponse(
    toSseBody(GOLDEN_CHUNKS),
    "text/event-stream; charset=utf-8",
    { "x-vercel-ai-ui-message-stream": "v1" },
  );
  const parsed = await parseAndValidateUiStream(res, {
    strictTerminal: true,
    onDone: (info) => { observed = info; },
  });
  if (parsed[parsed.length - 1].type !== "finish") {
    throw new Error(`最後一筆應為 finish：${parsed[parsed.length - 1].type}`);
  }
  if (!observed || observed!.terminatedBy !== "finish") {
    throw new Error(`terminatedBy 應為 finish，實際=${JSON.stringify(observed)}`);
  }
});

Deno.test(`${FN} — 合成 SSE：finish 之後再吐 chunk → strictTerminal 拒收`, async () => {
  const bad = [
    ...GOLDEN_CHUNKS, // 含 finish
    { type: "text-delta", id: "t1", delta: "多嘴的一段" },
  ];
  const res = makeStreamResponse(
    toSseBody(bad),
    "text/event-stream; charset=utf-8",
    { "x-vercel-ai-ui-message-stream": "v1" },
  );
  let threw = false;
  try {
    await parseAndValidateUiStream(res, { strictTerminal: true });
  } catch (e) {
    if (!/終止事件.*之後仍出現 chunk/.test((e as Error).message)) throw e;
    threw = true;
  }
  if (!threw) throw new Error("finish 之後多出 chunk 應被 strictTerminal 擋下");
});

Deno.test(`${FN} — 合成 SSE：abort 為終止事件，允許無 text 內容`, async () => {
  const chunks = [
    { type: "start" },
    { type: "start-step" },
    { type: "abort" },
  ];
  let observed: { terminatedBy: string } | null = null;
  const res = makeStreamResponse(
    toSseBody(chunks),
    "text/event-stream; charset=utf-8",
    { "x-vercel-ai-ui-message-stream": "v1" },
  );
  const parsed = await parseAndValidateUiStream(res, {
    strictTerminal: true,
    requireTextish: false,
    onDone: (info) => { observed = info; },
  });
  if (parsed[parsed.length - 1].type !== "abort") {
    throw new Error(`最後一筆應為 abort：${parsed[parsed.length - 1].type}`);
  }
  if (!observed || observed!.terminatedBy !== "abort") {
    throw new Error(`terminatedBy 應為 abort，實際=${JSON.stringify(observed)}`);
  }
});

Deno.test(`${FN} — 合成 SSE：abort 之後再吐 chunk → strictTerminal 拒收`, async () => {
  const bad = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "被中斷前" },
    { type: "abort" },
    { type: "text-delta", id: "t1", delta: "abort 後不該再有" },
  ];
  const res = makeStreamResponse(
    toSseBody(bad),
    "text/event-stream; charset=utf-8",
    { "x-vercel-ai-ui-message-stream": "v1" },
  );
  let threw = false;
  try {
    await parseAndValidateUiStream(res, { strictTerminal: true });
  } catch (e) {
    if (!/終止事件.*abort.*之後仍出現 chunk/.test((e as Error).message)) throw e;
    threw = true;
  }
  if (!threw) throw new Error("abort 之後多出 chunk 應被 strictTerminal 擋下");
});

// upstream 永遠不 close：驗證 timeoutMs 是硬上限，可重現。
function makeStuckStreamResponse(head: string, contentType: string, extraHeaders: Record<string, string> = {}): Response {
  const bytes = new TextEncoder().encode(head);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      // 之後永遠不 enqueue、也不 close —— 直到 reader.cancel() 才會結束
    },
    cancel() { /* noop */ },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": contentType, ...extraHeaders },
  });
}

Deno.test(`${FN} — 合成 SSE：upstream 永不 close 時 timeoutMs 為硬上限（terminatedBy=timeout）`, async () => {
  // 只塞 start + start-step + 一筆 text-delta，然後就掛住不再送
  const head = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "只有這段就卡住" },
  ].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");

  const res = makeStuckStreamResponse(
    head,
    "text/event-stream; charset=utf-8",
    { "x-vercel-ai-ui-message-stream": "v1" },
  );

  let observed: { terminatedBy: string; elapsedMs: number; eventCount: number } | null = null;
  const t0 = Date.now();
  const parsed = await parseAndValidateUiStream(res, {
    timeoutMs: 400,
    onDone: (info) => { observed = info; },
  });
  const wall = Date.now() - t0;

  if (!observed) throw new Error("onDone 未被呼叫");
  if (observed!.terminatedBy !== "timeout") {
    throw new Error(`預期 terminatedBy=timeout，實際=${observed!.terminatedBy}`);
  }
  // 硬上限：實際耗時應該接近 timeoutMs，且絕不能無限拖（留 3s 上限緩衝給 CI 抖動）
  if (wall > 3000) {
    throw new Error(`timeoutMs 未生效，wall=${wall}ms`);
  }
  if (observed!.elapsedMs > 3000) {
    throw new Error(`parser 內部 elapsedMs 過長=${observed!.elapsedMs}ms`);
  }
  // 已收到的事件仍要能被結構驗證通過
  if (parsed[0].type !== "start") throw new Error("timeout 前收到的事件仍需通過結構驗證");
  if (!parsed.some((p) => p.type === "text-delta")) {
    throw new Error("timeout 前的 text-delta 遺失");
  }
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

// ---------- stream-metrics-report 上報路徑合成測試 ----------
// 起一個本地 Deno.serve 收 POST，模擬部署後的 stream-metrics-report edge function，
// 驗證 parseAndValidateUiStream 會把 eventCount / terminatedBy / elapsedMs
// / correlationId / errorId / contentType 一路帶到 endpoint，欄位不漏。
Deno.test(`${FN} — 合成：parseAndValidateUiStream 會把 metrics 上報到 STREAM_METRICS_REPORT_URL`, async () => {
  const received: any[] = [];
  const ac = new AbortController();
  const server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, async (req) => {
    if (req.method !== "POST") return new Response("nope", { status: 405 });
    if (req.headers.get("authorization") !== "Bearer testtoken") {
      return new Response("no auth", { status: 401 });
    }
    received.push(await req.json());
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const { port } = server.addr as Deno.NetAddr;
  const url = `http://127.0.0.1:${port}/`;

  const prevUrl = Deno.env.get("STREAM_METRICS_REPORT_URL");
  const prevTok = Deno.env.get("STREAM_METRICS_REPORT_TOKEN");
  Deno.env.set("STREAM_METRICS_REPORT_URL", url);
  Deno.env.set("STREAM_METRICS_REPORT_TOKEN", "testtoken");

  try {
    // 用一個乾淨的 SSE finish 串流跑一次
    const body =
      `data: {"type":"start"}\n\n` +
      `data: {"type":"start-step"}\n\n` +
      `data: {"type":"text-delta","id":"t1","delta":"哈囉"}\n\n` +
      `data: {"type":"finish"}\n\n` +
      `data: [DONE]\n\n`;
    const res = new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "x-vercel-ai-ui-message-stream": "v1",
        "x-correlation-id": "corr-abc-123",
      },
    });
    await parseAndValidateUiStream(res, {
      source: "unit:metrics-report",
      reportExtra: { case: "synthetic-sse-finish", chunked: false },
    });
    await flushStreamMetricsReports();
  } finally {
    ac.abort();
    try { await server.finished; } catch { /* noop */ }
    if (prevUrl === undefined) Deno.env.delete("STREAM_METRICS_REPORT_URL");
    else Deno.env.set("STREAM_METRICS_REPORT_URL", prevUrl);
    if (prevTok === undefined) Deno.env.delete("STREAM_METRICS_REPORT_TOKEN");
    else Deno.env.set("STREAM_METRICS_REPORT_TOKEN", prevTok);
  }

  if (received.length !== 1) throw new Error(`預期 1 筆上報，實際=${received.length}`);
  const r = received[0];
  if (r.source !== "unit:metrics-report") throw new Error(`source 錯：${r.source}`);
  if (r.terminatedBy !== "finish") throw new Error(`terminatedBy 錯：${r.terminatedBy}`);
  if (typeof r.eventCount !== "number" || r.eventCount < 3) {
    throw new Error(`eventCount 異常：${r.eventCount}`);
  }
  if (typeof r.elapsedMs !== "number" || r.elapsedMs < 0) {
    throw new Error(`elapsedMs 異常：${r.elapsedMs}`);
  }
  if (r.correlationId !== "corr-abc-123") throw new Error(`correlationId 錯：${r.correlationId}`);
  if (!r.contentType || !String(r.contentType).includes("text/event-stream")) {
    throw new Error(`contentType 沒帶：${r.contentType}`);
  }
  if (!r.extra || r.extra.case !== "synthetic-sse-finish" || r.extra.chunked !== false) {
    throw new Error(`extra 不正確：${JSON.stringify(r.extra)}`);
  }
});

// 未設定 STREAM_METRICS_REPORT_URL 時，reporter 必須完全 no-op（不打任何 fetch）。
Deno.test(`${FN} — 合成：STREAM_METRICS_REPORT_URL 未設時 reporter 為 no-op`, async () => {
  const prev = Deno.env.get("STREAM_METRICS_REPORT_URL");
  Deno.env.delete("STREAM_METRICS_REPORT_URL");
  const origFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = ((..._a: any[]) => { fetched++; return Promise.reject(new Error("should not fetch")); }) as any;
  try {
    const body = `data: {"type":"start"}\n\ndata: {"type":"text-delta","id":"t1","delta":"x"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n`;
    const res = new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
    await parseAndValidateUiStream(res, { source: "unit:noop" });
    await flushStreamMetricsReports();
  } finally {
    globalThis.fetch = origFetch;
    if (prev !== undefined) Deno.env.set("STREAM_METRICS_REPORT_URL", prev);
  }
  if (fetched !== 0) throw new Error(`未設 URL 卻打了 fetch ${fetched} 次`);
});


