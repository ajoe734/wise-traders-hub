
# AI 訓練台深掃報告與修復計畫

已掃過本輪改動的所有檔案：`supabase/functions/expert-ai-studio/index.ts`、`expert-ai-training/index.ts`、`expert-ai-index/index.ts`、`src/pages/_aiStudio/*.tsx`、`src/pages/admin/AiStudio.tsx`、以及 migration `20260712114507_*.sql`。以下依「嚴重度」排序。

---

## 🔴 P0 — 會直接壞流程的 bug

### 1. `expert_ai_training_sessions.status` CHECK constraint 與程式碼對不上
- Migration L65：`CHECK (status IN ('open','in_progress','completed','discarded'))`
- 但 `expert-ai-training/generate_suggestions`（L332）寫入 `status: 'reviewing'`
- 前端 `WeeklyTrainerTab`、`TrainingHistoryTab` 也都用 `'reviewing'` 顯示「待採納」
- **後果**：`generate_suggestions` 的 UPDATE 會被 CHECK 拒絕，且因為沒 `error` 檢查（`.select().maybeSingle()` 無 error handling），前端會收到 `ok:true, session:null`，使用者以為成功但實際 session 沒更新，`suggested_knowledge` 也沒存進 DB。
- **修法**：新增 migration 把 CHECK 改成 `('open','reviewing','completed','discarded')`（或雙寫容忍），並在 `generate_suggestions` 補上 `if (error) throw error`。

### 2. `accept_knowledge` 對 owner 自動核可，繞過待審流程
- `expert-ai-training/accept_knowledge` L359：`status: isAdmin || isOwner ? 'approved' : 'pending'`
- owner 在週五訓練「加入勾選的條目」→ 直接 `approved`，永遠不會出現在 `ReviewTab`
- 這與本輪新加的「候選 → pending → 核准觸發 embedding」設計互相矛盾（`ReviewTab` 對 owner 恆空）
- **修法**：`accept_knowledge` 一律寫 `status='pending'`（不論 owner/admin），讓所有訓練產物走一次審核。若要保留「快速核可」入口，另做 `body.auto_approve` 參數並在 UI 顯式勾選。

### 3. `accept_knowledge` 錯誤靜默吞掉、沒回傳失敗清單
- L344–369：`try/catch` 只記 log，不寫進 `failed[]`；`inserted` push 的是 `data`（可能為 null 也 push）
- **後果**：UI 顯示「已加入 N 條」但實際可能少於 N；使用者無法知道哪條 embed 失敗。
- **修法**：對齊 `bulk_review_chunks`，回傳 `{ inserted_count, failed:[{title,error}] }`，UI 顯示失敗提示。

---

## 🟠 P1 — 資料/一致性 bug

### 4. 週界線用 UTC，台灣週五發文可能落在錯的 week bucket
- `expert-ai-training/isoMonday`（L12–17）以 UTC 計算週一
- 台灣 (UTC+8) 週日晚上發文，UTC 仍是週日 → 被算進「上週」；週一凌晨發文可能被算進「上上週」
- `list_weeks` 分桶與 `start_session` / `generate_suggestions` 撈 signals 都用同一組 UTC 邊界，所以**同 session 內是一致的**，但使用者從介面看「本週」會與後端不一致（尤其週五當天）
- **修法**：`isoMonday` 改以 Asia/Taipei 週界線計算（把 `d` 轉成 Taipei local 再取週一），撈 signals 的 `.gte/.lt` 改成 Taipei local 起訖轉回 UTC ISO。

### 5. `list_sessions` / `list_weeks` / `save_answers` / `complete_session` / `discard_session` 沒檢查 error
- 全部只解構 `{ data }`，DB 錯誤直接吞掉回 `ok:true`，前端會顯示成功但實際沒寫入
- **修法**：全部補 `if (error) throw error`，交由外層 `catch` 統一回 500。

### 6. `ReviewTab` 儲存並核可失敗判斷有 bug
- L72–74：`res.failed?.length` 若非 0 顯示錯誤但 **仍然關閉 dialog 並 refetch**
- **後果**：使用者以為改動生效實際核可失敗
- **修法**：失敗時保留 dialog、不 refetch（或改成明確要求使用者重試）。

### 7. `bulk_review_chunks` 對已有 embedding 的 chunk 也仍會被視為 pending 才能改
- 只匹配 `.eq('status','pending')`。若條目已被別的動作核可，會靜默 skip；`approved += 1` 不會增加但 UI 顯示「已核可 0」
- **修法**：回應加 `skipped` 欄位或在拿不到 rows 時清楚提示。

### 8. 更新 chunk 內容後不重置狀態
- `expert-ai-studio/update_chunk`（L162–191）：若 chunk 是 `approved`，管理員/owner 改內容後仍是 `approved`，但這條已重新 embed → 內容變了卻沒再審核
- **修法**：若 `patch.content` 有變且原狀態非 `pending`，強制降為 `pending` 或顯示提示；至少後端要記 `reviewed_by/at` 為新的 reviewer。

---

## 🟡 P2 — UI/UX 與相容性瑕疵

### 9. `KnowledgeTab` 對 owner 的按鈕顯示邏輯多餘
- `canReview = canEdit || isCompanyAdmin`：`canEdit` 已包含 `isCompanyAdmin || isOwner`，`|| isCompanyAdmin` 純冗餘。功能不影響，但誤導閱讀。

### 10. `TrainingHistoryTab` chunk 對照用 title 做 key
- L170–172：以 `title` 對照 `suggested_knowledge` 與 `expert_knowledge_chunks`
- 若 AI 產出兩條同 title，或使用者在編輯 dialog 改了 title，會判定「未納入」
- **修法**：在 `accept_knowledge` 時把 `metadata.candidate_id = suggested[i].id` 一併寫入 chunk，前端依 `metadata.candidate_id` 對照。

### 11. `expert-ai-training/get_session_detail` 沒把 embedding 過濾掉
- L175–179 `select('id, title, content, status, source_type, metadata, created_at, reviewed_at')` — 未含 embedding，OK。
- 但同函式 `list_pending_chunks` 已示範避免傳 3072 維向量的 pattern，這裡雖沒抓 embedding 但 metadata 可能夾雜大欄位，值得統一維持精簡投影。（低風險，可延後）

### 12. `start_session` 對「已有 open session」直接 reused，無法強制重問
- 使用者若對第一批補完題不滿意，沒有 UI 觸發「重生成」（要先 discard 才能重來）
- **修法**：`start_session` 加 `body.force_regenerate` 參數，允許覆寫 `ai_questions`。UI 加「重新產題」按鈕。

### 13. `save_answers` / `generate_suggestions` 沒鎖 `status`
- 若 session 已 `completed`，仍可 UPDATE 覆蓋（後端無檢查，只有前端 disable Textarea）
- **修法**：後端擋 `session.status === 'completed'`。

### 14. Tabs 在窄螢幕會擠爆
- `TabsList className="grid grid-cols-7"` — 7 欄無 responsive，手機/863px 視窗會嚴重擁擠
- **修法**：`grid-cols-3 md:grid-cols-4 lg:grid-cols-7` 或改成 horizontal scroll。

### 15. `PersonaTab`、`FewshotTab` 未在本輪改動內，但依賴同一支 edge function
- 沒改到就不動；但 review 時發現 `upsert_fewshot`（L78–100）對 owner 直接標 `approved`（`isOwner ? 'approved' : 'pending'`），與這輪「都要走審核」的方向不一致 — 需與 P0-#2 一起決策。

---

## 🔧 Debug / 驗證計畫（依序執行）

**A. 立即修 P0，再驗證**
1. 新 migration：修 `expert_ai_training_sessions.status` CHECK → `('open','reviewing','completed','discarded')`。
2. `expert-ai-training`：所有 `.select().maybeSingle()` 補 `if (error) throw error`；`accept_knowledge` 改寫 pending 並回 `failed[]`。
3. `expert-ai-studio/update_chunk`：內容有變時強制 `status='pending'`（或加參數）。

**B. Playwright 手動走查一輪完整迴圈**
1. 造 3 篇本週 published signals（用 Cloud DB 手插測試資料）。
2. 進 `AI 訓練台 → 週五訓練 → 開始訓練` → 檢查 `ai_questions` 有存進 DB。
3. 逐題填答 → `產出候選條目` → 檢查 session 更新為 `reviewing`（不再吃 CHECK 錯誤）、`suggested_knowledge` 落地。
4. 勾選 2 條 → `加入到知識庫` → 檢查落入 `expert_knowledge_chunks` 且 `status='pending'`、`training_session_id` 有值。
5. 進 `待審核` tab → 應看到剛剛 2 條 → 全選 → `核可並啟用` → 檢查 `status='approved'` 且 `embedding` 非空。
6. 進 `訓練歷史 → 該 session` → 確認 3 個候選條目每條顯示「已納入 / 已退回」正確。

**C. 資料庫層自動驗證（可寫在 `supabase/functions/expert-ai-training/index.test.ts`）**
- test1: `generate_suggestions` 對合法 session 回 `session.status === 'reviewing'`
- test2: `accept_knowledge` 插入的 chunks `status === 'pending'`
- test3: `bulk_review_chunks(approve)` 後所有 chunk `status === 'approved'` 且 `embedding IS NOT NULL`
- test4: `list_sessions` 對有 3 個 pending chunk 的 session 回 `accepted_pending_count === 3`
- test5: 台北時間週五 21:00 UTC 發布的 signal，`list_weeks` 應與 `start_session` 撈到同一週的相同 signals（P1-#4 修完後驗）

**D. Log/追蹤**
- 打開 Supabase edge function logs 觀察 `training_failed` / `studio_failed` 是否還有 CHECK constraint 錯誤
- 開一個小型 dashboard query：`SELECT status, count(*) FROM expert_knowledge_chunks GROUP BY status;` 確認 pending 有正常流動不會卡

---

## 執行順序建議

1. 先修 **P0 #1（CHECK constraint）** — 沒修這條，`generate_suggestions` 全爛。
2. 決策 **P0 #2（是否對 owner 也強制 pending）** — 這是產品決策，需要你確認。
3. 修 P0 #3、P1 #5/#6/#8，並補 test。
4. 排下一輪處理 P2（週界線、UI 響應式、重新產題按鈕）。

第 2 條需要你的一句決策：**owner 加入知識庫是否也要走「pending → 待審核」？** 若否，我就只修其他項目。
