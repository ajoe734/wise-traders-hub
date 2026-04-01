

# 事件預測系統四大優化方案

## 現狀分析

目前 `checkup-predict-events` Edge Function 每次收到請求都即時呼叫 Gemini API + TWSE MIS，沒有快取、沒有知識庫注入、前端阻塞式等待、也沒有歷史準確率追蹤。

---

## 優化 1：預測結果快取（24 小時）

**問題**：同一事件在頁面重整後若 `predictedIdsRef` 被清空，會重複呼叫 API。

**做法**：
- 在 `checkup_storage` 表中新增 key 為 `prediction-cache-{eventId}` 的快取紀錄
- Edge Function 收到請求前，先查 `checkup_storage` 是否有該事件的快取且 `updated_at` < 24 小時
- 有快取 → 直接回傳，不呼叫 Gemini
- 無快取 → 呼叫 Gemini 後寫回 `checkup_storage`
- 前端不需改動，透後端自動處理

**修改檔案**：`supabase/functions/checkup-predict-events/index.ts`

---

## 優化 2：知識庫案例注入 Prompt

**問題**：目前預測 Prompt 只有持倉報價和事件描述，缺乏歷史案例參考。

**做法**：
- Edge Function 在組裝 Prompt 前，從 `checkup_knowledge_items` 表查詢與事件相關的知識條目（依 tags 匹配事件類型，如「法說會」→ `tags @> '{法說會}'`）
- 取 confidence >= 0.75 的前 5 條，加上 `strategy-cases` 分類的成功案例前 3 條
- 將知識摘要注入 Prompt 的 `# 歷史參考知識` 區塊，讓 AI 引用歷史規律來提升判斷品質
- 同步更新 `checkup-analyze`（收盤分析）使用同樣的知識注入邏輯

**修改檔案**：`supabase/functions/checkup-predict-events/index.ts`

---

## 優化 3：前端樂觀 UI（Skeleton 動畫）

**問題**：AI 預測期間畫面會卡住顯示「AI 正在預測中」，體驗不佳。

**做法**：
- 在 `EventsPanel.jsx` 為正在預測中的事件卡片顯示 Skeleton 骨架動畫（預測欄位 shimmer 效果）
- 事件卡片的預測方向 & 理由欄位改為：
  - 狀態 `pending` 且在預測佇列 → 顯示 shimmer skeleton
  - 狀態 `verifying` 且有 `pred` → 顯示正常預測結果
- 不阻塞其他事件卡片的渲染

**修改檔案**：`src/checkup/components/events/EventsPanel.jsx`, `src/pages/FreeCheckup.jsx`

---

## 優化 4：歷史預測準確率追蹤

**問題**：目前事件復盤後的 `actual` vs `pred` 結果沒有被統計，AI 無法從歷史表現自我修正。

**做法**：
- 建立 `checkup_prediction_accuracy` 表：`id, event_id, pred, actual, was_correct, event_type, reviewed_at`
- 在事件復盤提交時（`useEventReviewWorkflow.js` 的 `submitReview`），自動寫入一筆準確率紀錄
- Edge Function 預測時，從該表統計近 90 天的命中率（依事件類型分組），注入 Prompt 讓 AI 知道「我過去法說會事件命中率 72%，營收事件命中率 65%」
- 在事件頁面頂部新增一個小型準確率儀表板：整體命中率、各類型命中率

**新增/修改檔案**：
- 新增 migration：建立 `checkup_prediction_accuracy` 表
- 修改 `supabase/functions/checkup-predict-events/index.ts`
- 修改 `src/checkup/hooks/useEventReviewWorkflow.js`
- 修改 `src/checkup/components/events/EventsPanel.jsx`

---

## 技術實作順序

1. 建立 `checkup_prediction_accuracy` 資料表（含 RLS）
2. 修改 `checkup-predict-events` Edge Function：加入快取 + 知識庫注入 + 準確率注入
3. 修改前端事件復盤流程：提交時寫入準確率紀錄
4. 修改 `EventsPanel.jsx`：Skeleton 動畫 + 準確率儀表板
5. 修改 `FreeCheckup.jsx`：傳遞預測中狀態給事件卡片

## 預期成果

- API 呼叫量大幅降低（24 小時內同事件不重複預測）
- 預測品質提升（注入知識庫歷史案例 + 自身準確率回饋）
- 使用者體驗流暢（骨架動畫取代阻塞式等待）
- 可量化的預測績效追蹤（準確率統計）

