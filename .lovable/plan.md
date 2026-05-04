
# 週記/訊號發布改版

把舊「彈窗發訊號」三個痛點一次解掉：(1) 開窗 → 改獨立路由頁；(2) 一篇週記只能 1 檔 → 支援 N 檔股票，每檔有自己的 datetime；(3) 四個說明欄是純 textarea → 改 TipTap 富文字 + AI 助寫。

## 1. 路由與頁面結構

新增兩條路由（沿用 `AdminLayout`）：

- `/admin/:expertSlug/signals/new` — 新發布頁（取代 Dialog）
- `/admin/:expertSlug/signals/:signalId/edit` — 編輯（補一個原本沒有的能力，幾乎免費送）

`Signals.tsx` 列表頁的「發布新週記/訊號」按鈕改成 `<Link>` 導去 `/new`。原本的 Dialog/Preview Dialog 全部砍掉。原 `useFormDraft` 草稿暫存邏輯整段搬到新頁面，key 不變。

頁面骨架：

```text
┌─ 發布新週記 ──────────────[取消] [預覽] [儲存草稿] [發布]─┐
│ 教學主題（mentor）                                        │
│ 整體摘要（mentor，TipTap）                                │
│                                                           │
│ ── 操作 #1 ──────────────────────────[↑][↓][刪除] ──     │
│  時間 [2026/05/06 09:32]  代碼 [2330]  名稱 [台積電]      │
│  方向 [買進▼]  數量 [1] [張▼]  參考價 [890]              │
│  訊號模板 [強勢突破] [跌破支撐]…                          │
│  為什麼這樣操作？  [✨ AI ▼]                              │
│   └ TipTap 編輯區                                        │
│  部位控管想法     [✨ AI ▼]                              │
│  風險提醒         [✨ AI ▼]                              │
│                                                           │
│ [+ 新增另一檔股票]                                        │
│                                                           │
│ 教學重點（mentor，TipTap）  [✨ AI ▼]                    │
└───────────────────────────────────────────────────────────┘
```

## 2. 多檔股票 + 各自時間（DB 變更）

在 `expert_signals` 加：

- `executed_at timestamptz` — 老師填的「操作執行時間」
- `batch_id uuid` — 同一篇週記/同一次發布的多檔共用一個 id（mentor 一篇週記 N 檔，advisor 一次也可一次貼 N 檔）

寫入時：每按一次發布 → 在前端產一個 batch_id，N 檔股票 = N 筆 `expert_signals`，共享 batch_id、teaching_topic、overall_summary、learning_points（這三個 mentor 欄位只寫到「該批第一筆」，前端讀取也以 batch_id 聚合）。

`published_at` 維持現狀（系統時間，排序與訂閱權限用）；`executed_at` 是老師標註的操作時刻，前端 UI 與訂閱者頁面顯示用。

列表頁時間欄改顯示 `executed_at ?? published_at`，並在同一 `batch_id` 折疊成一張卡（點開展示多筆）。

新增 RLS：沿用 `expert_signals` 既有 policies，新欄位不需要新 policy。

## 3. TipTap 富文字（4 個欄位）

升級的欄位：`reason_summary`、`reason_detail`、`risk_notes`、`learning_points`、`overall_summary`（共 5 個）。

DB：欄位型別仍為 `text`，但內容存 **HTML 字串**（TipTap `editor.getHTML()`）。新增遷移：把現有純文字內容包一層 `<p>…</p>`（或保持原樣，TipTap 會自行解析）→ 不做也可，因為 TipTap 對 plain text 容錯。

依賴：`@tiptap/react` `@tiptap/starter-kit` `@tiptap/extension-link` `@tiptap/extension-placeholder`。不要 image extension（避免老師亂貼大圖）。

新元件 `src/components/admin/RichTextEditor.tsx`：
- 工具列：粗體 / 斜體 / H3 / 無序清單 / 有序清單 / 引用 / 連結 / 還原
- props：`value, onChange, placeholder, onAIAssist?: (mode, selection) => void`
- 工具列右側固定一顆「✨ AI」下拉

訂閱者端（`JournalDetail` / `SignalDetail` 等）改用 `dangerouslySetInnerHTML` + `prose prose-sm` 渲染。先寫一個 `sanitizeHtml` util（白名單 tag/attr）防止存進去的東西亂跑。

## 4. AI 助寫（兩種互動都做）

### 4-a 一鍵按鈕（每個富文字欄位旁的下拉）

- 潤飾（rewrite）：把目前內容改得更口語、更易讀，篇幅相近
- 擴寫（expand）：補成更完整段落
- 摘要（summarize）：壓成 2–3 行
- 改成清單（bulletize）

### 4-b 自訂指令（同下拉裡的「自訂…」）

點開小輸入框：「請把這段加上一個風險警告」→ 跑同一支 edge function，多帶一個 `instruction` 欄位。

### Edge function `signal-ai-assist`

```ts
// 入參
{ mode: 'rewrite'|'expand'|'summarize'|'bulletize'|'custom',
  field: 'reason_summary'|'reason_detail'|'risk_notes'|'learning_points'|'overall_summary',
  content: string,        // 目前 HTML（會在後端先轉純文字）
  instruction?: string,   // mode=custom 才有
  context?: { instrument?, action?, price_hint? } }
```

- 用 Lovable AI Gateway，預設 `google/gemini-3-flash-preview`
- system prompt 依 `field` 組（投資週記 / 風險提醒語氣 / 教學重點⋯）
- 回傳 `{ html: "<p>…</p>" }` 由前端塞回 editor
- 失敗（402 / 429）回對應錯誤碼，前端 toast

非串流（`supabase.functions.invoke`）。回傳是一段重寫後的小段，速度可接受、實作簡單。

## 5. 列表頁顯示調整

- 同 `batch_id` 的多筆訊號：摺疊成一列 `2330 台積電 · 2317 鴻海 · …（3 檔）`，點 ↓ 展開時顯示每筆 `executed_at` + 操作 + 理由
- 時間欄優先顯示 `executed_at`
- 收回（recall）動作：對 batch 整批收回（一次更新 `taken_down_*`、發一次 LINE 收回通知）

## 6. LINE 推播

`line-push-signal` edge function 改造支援 batch：傳入 `batch_id` 或 `signal_ids: string[]`，組成一則 flex carousel（最多 10 bubbles，台股一週 1 檔以上常態）。Mentor 既有「週五 20:00 統一推播」cron 改用 batch 邏輯，每篇週記推一則 carousel。

## 7. 技術細節（給未來的我）

- 表單 state 改成 `{ trades: TradeDraft[], teachingTopic, overallSummary, learningPoints }`，`useFormDraft` 序列化 trades 陣列
- `clearForm` 重置成 `[emptyTrade()]`（永遠至少一檔）
- 驗證移到提交時：每個 trade 都要過原本的 add/trim/sell 持倉檢查（迴圈跑 `validateTrade(t)`）
- `ADD/TRIM/EXIT` 持倉檢查迴圈裡，若同 batch 內前一筆會影響庫存，要用「模擬庫存」而不是讀 DB（例：先賣 5 張再加 3 張）→ 前端建一個 `simulatePositions(openTrades, trades)` 函式
- 富文字寫進 DB 前過 `DOMPurify`（白名單 `p, br, strong, em, h3, ul, ol, li, blockquote, a[href]`）
- 路由守門：`/new` 與 `/edit` 只允許 `isOwner || isCompanyAdmin`，否則 redirect 回列表
- `useFormDraft` 已 enabled 條件改 `enabled: true`（不再依賴 dialog 開關，整頁本來就在編輯狀態）

## 8. 影響檔案

- 改：`src/pages/admin/Signals.tsx`（移除 Dialog、按鈕變 Link、列表 batch 折疊）
- 新：`src/pages/admin/SignalEditor.tsx`（新發布頁，含編輯模式）
- 新：`src/components/admin/RichTextEditor.tsx`
- 新：`src/components/admin/AIAssistMenu.tsx`
- 新：`src/lib/sanitizeHtml.ts`
- 新：`src/lib/simulatePositions.ts`
- 改：`src/App.tsx`（加路由）
- 改：`src/pages/JournalDetail.tsx`、`src/pages/expert/SignalDetail.tsx`（HTML 渲染 + sanitize）
- 改：`supabase/functions/line-push-signal/index.ts`（支援 batch carousel）
- 新：`supabase/functions/signal-ai-assist/index.ts`
- 改：`supabase/functions/mentor-journal-publish/index.ts`（如果有 cron 推播；改成 batch）
- DB migration：`expert_signals` 加 `executed_at`、`batch_id`，加 index `(batch_id)`
- Memory 更新：`mem://features/mentor-publishing-workflow`、`mem://management/form-persistence-rules`

## 9. 範圍管理（不在這次做）

- 圖片上傳到富文字（要先設計 storage policy，下次）
- AI 串流逐字輸出（v1 用一次性回傳，要時再加）
- 多人協作編輯
- 富文字版本歷史
