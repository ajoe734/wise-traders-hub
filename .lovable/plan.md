## 背景

目前三個地方切換頁籤就會 **前功盡棄**：

1. **`/admin/:expertSlug/signals`** — 發布訊號的表單（mentor 還包含周記三欄：本週教學重點 `teaching_topic`、整體心得 `overall_summary`、學習筆記 `learning_points`）。檔案 `src/pages/admin/Signals.tsx` 第 96–144 行刻意只記住 dialog 開關，**不存內容**。
2. **`/admin/:expertSlug/signal-templates`** — 訊號模板新增/編輯 Dialog（`src/pages/admin/SignalTemplates.tsx`）。
3. **`/admin/:expertSlug/reason-templates`** — 理由模板新增/編輯 Dialog（`src/pages/admin/ReasonTemplates.tsx`）。

## 目標

打字到一半切走（看持倉、看訂閱者、不小心 Cmd+W）回來資料還在，並有清楚的「未送出草稿」提示與一鍵清除。

## 設計原則

- **存 localStorage**（不是 sessionStorage）— 跨 tab、跨關瀏覽器都還在；草稿不算機密。
- **每個 expertSlug 獨立 key**，避免切換不同分析師時撞稿。
- **debounce 300ms** 寫入，避免每次 keystroke 都打 storage。
- **送出成功 / 主動取消 / 點「清除草稿」時清除** key。
- **載入時若有草稿，顯示頂部 banner**：「偵測到未送出的草稿（X 分鐘前）— 還原 / 捨棄」，避免靜默蓋掉，給講師選擇權。
- **Dialog 已開啟自動還原**；Dialog 關閉時保留草稿（直到送出/明確捨棄）。

## 實作

### 1. 新增 `src/hooks/useFormDraft.ts`（共用 hook）

```ts
useFormDraft<T>(key: string, value: T, setValue: (v: T) => void, options?: {
  debounceMs?: number;     // 預設 300
  enabled?: boolean;        // 預設 true
})
// 回傳 { hasDraft, draftAge, restore(), discard() }
```

- 內部用 `localStorage` + `JSON.stringify`，存 `{ data, savedAt }`。
- mount 時偵測既有草稿但 **不自動覆蓋** — 由 caller 決定何時呼叫 `restore()`。
- value 變動時 debounce 寫入。
- 提供 `discard()` 清 key。

### 2. `admin/Signals.tsx` 改動

- 把 11 個欄位（stockCode、stockName、action、priceHint、quantity、quantityUnit、reasonSummary、reasonDetail、riskNotes、learningPoints、teachingTopic、overallSummary）打包成一個 object，餵給 `useFormDraft`，key = `signal-draft-${expertSlug}`。
- Dialog 上方加一條輕量 banner：偵測到草稿時顯示「您有未送出的草稿（X 分鐘前），點此還原 ／ 捨棄」。
- `clearForm()` 同步呼叫 `discard()`。
- `handlePublish()` 成功後呼叫 `discard()`。
- 移除原第 96–135 行只存 `_open` 的舊邏輯（保留 dialog 開關仍記在 sessionStorage，但跟草稿 key 拆開）。

### 3. `admin/SignalTemplates.tsx` 改動

- 把 `form` state 餵給 `useFormDraft`，key = `signal-template-draft-${expertSlug}-${editingId ?? 'new'}`。
- Dialog 開啟時若有草稿且不是正在編輯既有資料，自動還原（編輯舊模板的草稿則顯示 banner 詢問）。
- `handleSave` 成功後 `discard()`。
- Dialog 取消時 **不**自動清除（避免誤點），但提供「清除草稿」按鈕。

### 4. `admin/ReasonTemplates.tsx` 改動

- 同上，把 `title` + `content` 打包，key = `reason-template-draft-${expertSlug}-${editingId ?? 'new'}`。

## 不做的事

- 不做雲端草稿（DB 表）— 草稿性質低、單機足夠；要做雲端再開新需求。
- 不做多版本歷史 — 只保留最新一份草稿。
- 不改寫「dialog 開關記憶」邏輯（Signals.tsx 那段獨立行為，保留）。

## 驗收

1. 在 Signals 頁打開發布 Dialog、輸入半張訊號（含 mentor 的 teaching_topic）→ 切到 Subscribers → 切回 → 點還原 → 內容回來。
2. 送出訊號成功後重新進頁面，banner **不應**出現。
3. 切到別的分析師（不同 slug）→ 不會看到上一位的草稿。
4. SignalTemplates / ReasonTemplates 開新增 Dialog 打字 → 關 Dialog → 重開 → 草稿還在。
5. 編輯既有模板時，不會被「新增草稿」蓋掉。
