## 根因

Edge Function 日誌顯示：
```
TypeError: messages.some is not a function
  at standardizePrompt (ai/7.0.19/dist/index.js)
  at streamText
  at expert-ai-chat/index.ts:136
```

版本錯位（`package.json`）：
- 前端 `@ai-sdk/react`: **^4.0.20**（對應 `ai@4` 世代，`useChat` 送出的 `messages` 是 `{ role, content }` 舊格式）
- 前端 & Edge Function 使用的 `ai`: **^7.0.19**（`convertToModelMessages` 期待 v5+ 的 `UIMessage { role, parts:[...] }`）

前端送舊格式 → 後端 `convertToModelMessages` 拿到不是預期的 UIMessage 陣列 → `streamText` 內部 `messages.some(...)` 爆炸 → 前端顯示 "An error occurred"。

（授權 edge function `authorize-pdf-export` 與本問題無關，那是 PDF 匯出用的。）

## 修法：全站對齊 AI SDK v5（最穩、與 Lovable knowledge 一致）

1. **`package.json`**
   - `"ai": "^5.0.0"`
   - `"@ai-sdk/react": "^2.0.0"`
   - `"@ai-sdk/openai-compatible": "^1.0.0"`（v5 對應版）
   - 執行 `bun install` 更新 lockfile

2. **Edge Functions 明確 pin 版本**（避免下次自動跳版又炸）
   - `supabase/functions/expert-ai-chat/index.ts`：`import { streamText, convertToModelMessages, type UIMessage } from 'npm:ai@^5.0.0'`
   - `supabase/functions/_shared/ai-gateway.ts`：`import { createOpenAICompatible } from 'npm:@ai-sdk/openai-compatible@^1.0.0'`
   - 全站 grep 其他 `npm:ai` / `npm:@ai-sdk/*` 匯入，一起補上 pin

3. **無需改邏輯**：`convertToModelMessages`、`UIMessage.parts`、`DefaultChatTransport`、`useChat` API 在 v5 皆一致。

## 驗證（窮舉，不偷懶）

- `bunx tsgo --noEmit` 通過
- 部署後用 `supabase--curl_edge_functions` 對 `expert-ai-chat` 打一發帶 `messages:[{role:'user',parts:[{type:'text',text:'hi'}]}]` 的 POST，確認 200 且回傳 SSE
- 讀 `expert-ai-chat` logs，確認無 `standardizePrompt` 錯誤
- Grep 所有 edge functions 找出全部 `npm:ai` / `npm:@ai-sdk/*` 匯入清單，逐一確認 pin 到 v5 相容版本（不只改 `expert-ai-chat` 一個）
- 前端在 preview 用 sharkgu 訂閱者身分實際發訊，確認串流回覆正常、`onFinish` 觸發、配額刷新
