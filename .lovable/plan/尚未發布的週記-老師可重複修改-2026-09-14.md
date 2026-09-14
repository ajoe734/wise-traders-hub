# 尚未發布的週記：老師可重複修改

目標：週記在「正式公開時間」到來前，老師可以隨時回去改、改幾次都行，而且入口一眼看得到、不會誤以為內容已自動存檔。

## 目前狀況（已查證）

- 待發布（pending）的週記在資料層本來就允許重複覆寫，重存不會被擋。
- 但列表上的「編輯」按鈕混在「重推 / 收回」那排小按鈕裡，沒有任何「這篇還沒公開、可以繼續改」的區塊，所以老師找不到入口。
- 編輯模式下目前沒有暫存：中途離開頁面，未按儲存的修改會全部消失，也沒有任何提醒。
- 每次重存會把該篇的發布時間重設為當下，跨日／跨週再改時，週記歸屬的時間點會漂移。

## 要做的事

### 1. 待發布區塊（主要入口）

週記列表最上方新增「本週待發布」卡片（僅週記老師顯示，沒有待發布時不出現）：

- 以「一篇週記」為單位顯示（同批次合併），列出教學主題或檔數摘要、最後修改時間。
- 主要按鈕「繼續編輯」，直接進入該篇編輯頁。
- 說明公開規則：台股週五 20:00、美股週六 08:00 統一公開；公開前都可以修改。
- 沿用既有「立即發布」入口，不改變發布行為。

### 2. 列表上的待發布列更明確

pending 的列把「編輯」改成明顯的主要按鈕，文字為「繼續編輯」，並保留「待發布」標記。已公開的週記維持現行規則（只有當日可收回），不放寬。

### 3. 編輯中暫存 + 必須按儲存

- 編輯既有週記時啟用暫存（依該篇獨立保存），中途切走再回來內容還在。
- 頁面顯示狀態列：「有尚未儲存的修改 — 按『更新週記』才會正式寫入」，並提供「還原成已儲存版本」。
- 直接關閉分頁或離開頁面時跳出未儲存提醒。
- 按下儲存成功後清掉暫存。

### 4. 時間不再漂移

重存待發布週記時沿用該篇原本的建立／發布時間，不用當下時間覆寫，避免改一次就換一週。

### 5. 公開後不可再改

已公開的週記不進入這套重複修改流程，維持既有收回規範，避免訂閱者看到的內容被事後偷改。

## 技術細節

- `src/pages/admin/Signals.tsx`：新增 pending 批次彙總與待發布卡片元件（放在 `src/pages/_adminSignals/`），純前端彙總現有 signals 資料，不新增查詢。
- `src/pages/_adminSignals/SignalRow.tsx`、`SignalListItem.tsx`：pending 時編輯按鈕改 primary 樣式與文案。
- `src/pages/admin/SignalEditor.tsx`：`useFormDraft` 在 `isEditing` 時以 `signal-editor-${expertSlug}-${batchId}` 為 key 啟用，於 `onBatchLoaded` 之後才開始比對／寫入；加未儲存狀態列、`beforeunload` 與離開確認。
- `src/hooks/admin/useSignalEditorData.ts`：載入批次時一併回傳原 `published_at` / `created_at`。
- `src/pages/_signalEditor/derive.ts` 的 `buildPublishRows` / `buildTeachingOnlyRow` 增加可選 `publishedAt` / `createdAt`，編輯模式帶入原值（`save_signal_batch` 已 `COALESCE` 採用傳入值，不需要資料庫變更）。
- 測試：pending 彙總與卡片顯示／隱藏、編輯暫存還原與 discard、重存後時間不變、published 不出現在待發布區塊；跑 focused vitest、typecheck、module boundaries、build。

不做：資料庫遷移、排程／Edge Function 變更、發布時間規則變更、既有資料修補。
