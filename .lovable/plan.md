# 週記老師「AI 訓練台」完整規劃

## 目標
給週記老師一個後台頁面，讓他們能：
1. 設定 AI 的**人設 / 觀點 / 口吻**（Persona）
2. 自動或手動把**自己過往週記**灌進 AI 的記憶（RAG 知識庫）
3. 用**範例 Q&A（Few-shot）** 校正 AI 對特定問題的回答方式
4. **每週五完稿後**觸發一次「訓練對話」：AI 讀完新週記→反問老師以補完觀點→產出「本週觀點差異／建議補充」讓老師選擇性納入
5. 所有新增的知識條目走**審核 gate**（老師本人或平台管理員 approve 後才生效）

Lovable AI Gateway 不支援真正 fine-tune，本方案採 **Persona Prompt + RAG + Few-shot + 對話回饋** 四層堆疊，效果等同「越用越像老師」。

---

## 使用者路徑

### 老師端：`/app/expert/ai-studio`（新頁，需 expert role）
Tab 結構：
1. **人設 (Persona)**：口吻、專長、禁區、免責聲明、預設模型（沿用 `openai/gpt-5`）
2. **知識庫 (Knowledge)**：列表 + 三種來源新增
   - 自動抓自己已發佈週記（一鍵「同步全部週記」，可設定日期區間）
   - 手動貼上文字 / Q&A pair
   - 手動貼網址（fetch → 抽文 → 切 chunk）
   - 每一條顯示：來源、狀態（`pending` / `approved` / `rejected`）、embed 狀態、被引用次數
3. **範例問答 (Few-shot)**：Q/A 對，直接注入 system prompt
4. **週五訓練對話 (Weekly Trainer)**：
   - 頁面偵測「本週已發佈但尚未訓練」的週記→顯示「開始本週訓練」按鈕
   - 進入後 AI 讀完該週記，主動對老師提出 3–5 個補完問題（觀點空白、風險未提、標的邏輯不清等）
   - 老師逐題回覆
   - AI 產出「觀點差異摘要」與「週記建議補充清單」→ 老師勾選要納入知識庫的條目 + 是否回頭改週記
5. **對話回饋 (Review)**：檢視真實會員 × AI 對話紀錄，對不滿意的訊息「標記→提示修正→自動生成新的 Q&A 送審」

### 平台管理員端：`/company/expert-ai-studio`
- 全站老師 AI 訓練總覽
- 待審核知識條目佇列（老師無法自審時代理）
- Persona / Few-shot 內容審核（防止老師寫入不當保證收益字眼）
- 索引/embedding 失敗重試

---

## 資料庫變更

### 新表
```
public.expert_ai_personas
  expert_id (pk, fk experts.id)
  system_prompt text
  tone text[]
  forbidden_topics text[]
  disclaimer text
  model text default 'openai/gpt-5'
  updated_at, updated_by
```

```
public.expert_ai_fewshots
  id, expert_id, question text, answer text,
  status ('pending'|'approved'|'rejected'),
  created_by, reviewed_by, reviewed_at, created_at
```

```
public.expert_ai_training_sessions          -- 週五訓練對話
  id, expert_id, journal_id (fk),
  status ('open'|'completed'|'discarded'),
  ai_questions jsonb,        -- AI 提出的補完題
  answers jsonb,             -- 老師逐題回覆
  suggested_knowledge jsonb, -- AI 產出的候選知識條目
  suggested_journal_edits jsonb,
  started_at, completed_at
```

### 擴充現有表
`expert_knowledge_chunks`：新增
- `status text default 'approved'`（新條目預設 `pending`；auto sync 週記可設 `approved`）
- `title text`（給後台列表顯示）
- `created_by uuid`
- `training_session_id uuid nullable`
- `reviewed_by`, `reviewed_at`

RLS：
- 老師只能 CRUD `expert_id = 自己 experts.id`
- 管理員（`has_role(uid,'admin')`）可全部
- Grant 給 authenticated + service_role

---

## Edge Functions（新增）

1. **`expert-ai-persona`** GET/PUT — 讀寫 persona
2. **`expert-ai-knowledge`** — CRUD + 三種來源（text / url / journal-sync）
   - 每筆 insert 後 enqueue embedding
3. **`expert-ai-embed-worker`** — 批次跑 embedding（Lovable AI `openai/text-embedding-3-small`，寫 `expert_knowledge_chunks.embedding vector(1536)`）
4. **`expert-ai-training-start`** — 讀入指定週記→呼叫 GPT-5 產出補完題→建立 training session
5. **`expert-ai-training-reply`** — 老師回覆題目→AI 產出候選 knowledge + 週記修訂建議
6. **`expert-ai-fewshot`** — CRUD + 審核

**修改 `expert-ai-chat/index.ts`**：
- 讀取 `expert_ai_personas` → 合併到 system prompt
- 讀取 `expert_ai_fewshots (status=approved)` → 插入 messages 前綴
- 對使用者問題做 embedding → `match_expert_chunks(expert_id, query_embedding, 6)` → 塞入 system 的「參考資料」段落
- 記錄本次使用了哪些 chunk id（`ai_gateway_usage_logs.metadata` 或另設 `expert_ai_retrieval_logs`）

---

## 前端

新增：
- `src/pages/app/expert/AiStudio.tsx`（Tab 容器）
- `src/pages/app/expert/_aiStudio/PersonaTab.tsx`
- `src/pages/app/expert/_aiStudio/KnowledgeTab.tsx`
- `src/pages/app/expert/_aiStudio/FewshotTab.tsx`
- `src/pages/app/expert/_aiStudio/WeeklyTrainerTab.tsx`
- `src/pages/app/expert/_aiStudio/ReviewTab.tsx`
- `src/pages/company/ExpertAiStudio.tsx`（管理員總覽）
- Sidebar 加項目：老師端 App 選單「AI 訓練台」、Company 選單「老師 AI 訓練」

路由：`/app/expert/ai-studio`、`/company/expert-ai-studio`（沿用既有 ProtectedRoute + role guard）。

---

## 週五自動化
`publish-weekly-journals` cron 完成後，於 `expert_ai_training_sessions` insert 一筆 `status='open'` 佔位，老師登入後 `WeeklyTrainerTab` 會亮紅點。**AI 呼叫仍由老師點擊觸發**（避免自動消耗 credits）。

---

## 成本與監控
- 每次 embedding / chat 走既有 `ai_gateway_usage_logs`
- Knowledge 條目上限：每老師 2000 chunk（軟上限，超過提示先整理）
- 訓練對話單次 token 上限（system + 週記 + 對話）估 ~15k tokens，`openai/gpt-5` ≈ 每次 US$0.05–0.15

---

## 分階段交付
- **P1**（本次）：資料表 + Persona/Knowledge/Fewshot 三 tab + `expert-ai-chat` 整合 RAG + 老師手動同步週記
- **P2**：Weekly Trainer + AI 提問 + 候選知識審核
- **P3**：Review tab（對話回饋 → 反向修正）+ 管理員儀表板
