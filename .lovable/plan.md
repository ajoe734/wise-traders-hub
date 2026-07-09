
## 目標

在導師個人頁 (`/expert/:slug`) 新增獨立分頁「與 {老師} 對話」，透過 Lovable AI Gateway（Gemini 2.5 Flash）打造擬人 AI，用 RAG 檢索該導師的週記＋交易紀錄，模仿其口吻與投資邏輯回答用戶提問。對話持久化到資料庫，僅該導師的有效訂閱者可用。

## 一、資料庫（1 個 migration）

三張新表 + pgvector：

**`expert_knowledge_chunks`**（RAG 檢索來源）
- `expert_id`, `source_type`（signal / bio / trade_summary）, `source_id`
- `content`（chunk 原文）, `embedding vector(768)`, `metadata jsonb`
- IVFFlat index on embedding
- 由 edge function 定期／signal 發佈時寫入，用戶不可讀（僅 service_role）

**`expert_ai_conversations`**
- `user_id`, `expert_id`, `title`, `last_message_at`
- UNIQUE(`user_id`, `expert_id`) → 一位用戶對一位老師僅一條 thread
- RLS：`user_id = auth.uid()`

**`expert_ai_messages`**
- `conversation_id`, `role`（user/assistant）, `content`, `created_at`
- RLS：透過 conversation 反查 owner

四步結構：CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY，全部含 `service_role`。

## 二、Edge Functions（3 支）

### 1. `expert-ai-index`（背景建索引）
- 觸發時機：新增／編輯 `expert_signals` 時（DB trigger 呼叫）＋手動 backfill 腳本
- 步驟：拉該導師的 `experts.bio` / `experts.style_description` / 全部已發佈 `expert_signals`（reason_summary、detail、risk_notes、learning_points）／最近 90 天 `trade_records` 摘要
- 切 chunk（~500 字/塊）→ 呼叫 `google/gemini-embedding-001` → 寫入 `expert_knowledge_chunks`（先 delete 舊的再 insert，避免重複）

### 2. `expert-ai-chat`（主對話端點，streaming）
權限檢查（**依序**，任一失敗即 403）：
1. JWT 驗證
2. 查 `member_subscriptions` 是否對該 expert 有 `active` 訂閱（走既有 `active-status-definition` 邏輯）
3. 若失敗回 402（需訂閱）

主流程：
1. 取 user 最新問題 → embed → 在 `expert_knowledge_chunks` 用 cosine similarity 撈 top 6
2. 組 system prompt：
   ```
   你是「{expert.name}」的 AI 分身，投資風格：{bio}。
   請以第一人稱、貼近老師語氣回答用戶提問。
   以下是老師過往週記／交易的原文片段（作為知識依據，不要逐字複讀）：
   {retrieved chunks}
   
   規則：
   - 不得保證收益、不得使用「必漲/穩賺/保證」等字眼
   - 不得給即時買賣建議，要引導用戶自行判斷
   - 若問題超出老師公開內容範圍，誠實說「這部分我還沒公開分享過」
   ```
3. 讀 `expert_ai_messages` 完整歷史 → `streamText`（`google/gemini-2.5-flash`）
4. `toUIMessageStreamResponse` 搭 `onFinish` 把 assistant 訊息寫回 DB

### 3. `expert-ai-conversation`（GET/DELETE）
- `GET` 取或建立 conversation + 回歷史訊息
- `DELETE` 清空歷史（重開對話）

## 三、前端（`src/pages/app/ExpertDetail.tsx` 內新分頁）

**新檔案：**
- `src/pages/_expertAiChat/ExpertAiChatTab.tsx` — 主容器，用 AI Elements：`Conversation` / `Message` / `MessageResponse` / `PromptInput` / `Shimmer`
- `src/pages/_expertAiChat/useExpertAiChat.ts` — 封裝 `useChat` + `DefaultChatTransport` 指向 edge function
- 訊息渲染走 `message.parts` + `react-markdown`
- 空狀態：顯示 3 個建議問題（「你最近怎麼看 AI 族群？」「上次 2330 的想法」「風險控制原則」）

**權限 UI：**
- 非訂閱者 → 顯示鎖定卡片＋「訂閱後可與 AI 分身對話」CTA 導到方案頁
- 訂閱者 → 顯示對話介面

**分頁整合：**
- `ExpertDetail.tsx` 現有 Tabs 加一頁「AI 對話」（icon: `MessageCircle`），tab value = `ai-chat`
- URL query `?tab=ai-chat` 可直達

## 四、免責＆合規

- 對話介面底部固定顯示：「本對話由 AI 根據 {老師} 公開週記生成，不代表老師本人即時觀點，不構成投資建議」
- Prompt 內硬性禁止：保證收益、即時買賣訊號、洩露未公開持倉

## 五、成本控制

- Embedding 僅在 signal 發佈時增量建，一位老師 ~200 篇週記 → 一次性 backfill ~500 chunks × $0.000013/1K token ≈ 幾分錢
- Chat 用 `gemini-2.5-flash`（便宜、夠快），單次對話含 6 chunks + 歷史 ≈ 3K token
- 每位訂閱者每天限 30 則（`checkup_usage` 模式：新增 `expert_ai_usage` 計數或直接查 messages 表）

## 六、上線順序

1. Migration（3 表 + pgvector extension + trigger）
2. `expert-ai-index` + backfill 一位測試導師
3. `expert-ai-chat` + `expert-ai-conversation`
4. 前端 tab + AI Elements 安裝（`bun x ai-elements@latest add conversation message prompt-input shimmer`）
5. 用 Playwright 驗證：未訂閱鎖定 / 訂閱者對話 / 歷史重載 / 清空重開

## 技術細節（給工程師）

- 模型：`google/gemini-2.5-flash`（chat）、`google/gemini-embedding-001`（768 維）
- AI SDK：`streamText` + `toUIMessageStreamResponse({ originalMessages, onFinish })`
- Provider helper：用 `_shared/ai-gateway.ts`（`createLovableAiGatewayProvider`）
- Chat 前端：`useChat({ id: conversationId, transport })`，textarea 保持 focus
- 訊息 ID：DB 自動 UUID，AI SDK 的 `msg_...` 存另欄或不存
- pgvector：`CREATE EXTENSION IF NOT EXISTS vector;` 建立 IVFFlat index (lists=100)
- 檢索 RPC：`match_expert_knowledge(expert_id, query_embedding, match_count)` security definer

---

要我按這個計畫進 build mode 開工嗎？如果 embedding 覺得先不做 RAG（純用 system prompt 塞 bio + 最近 5 篇週記全文）也可以，會更快上線但擬真度較低。
