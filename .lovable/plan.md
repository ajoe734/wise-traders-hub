## 目標
分析師發布訊號／週記後，僅在「台灣自然日同一天」內可收回（rollback）；跨日後一律禁止，避免事後修改真實績效。Mentor 與 Advisor 都套用。

## 變更

### 1. `src/lib/publishingWindow.ts` — 新增 `canRecallSignal(publishedAt)` helper
- 把 `published_at` 與 `now()` 都轉成 Asia/Taipei 自然日（YYYY-MM-DD）做字串比對
- 同一天 → `{ ok: true }`；跨日 → `{ ok: false, reason: '已過發布當日（台灣時間），不可收回' }`
- `published_at` 為 null（mentor pending）→ `ok: true`

### 2. `src/pages/admin/Signals.tsx` — 前端守衛
- `handleRecall` 開頭呼叫 `canRecallSignal(target.published_at)`，不通過 → `toast.error(reason)` 直接 return
- 批次模式：以「批次中最早的 published_at」判斷
- 兩個收回按鈕（行內 Undo2、頂部 recall）的 `disabled` 與 `title` 加入跨日判斷：
  - `disabled`: 既有條件 `||` `!canRecallSignal(signal.published_at).ok`
  - 移除原本「Mentor published 完全不可收回」的特例（改由同日規則統一控管；mentor 發布日當天仍可收回）

### 3. DB 觸發器 — 後端硬限制（最後一道防線）
新增 migration：在 `expert_signals` 上加 `BEFORE UPDATE` trigger `enforce_recall_same_day`
- 當 `OLD.status='published' AND NEW.status='taken_down'`
- 若 caller 是 `company_admin` → 放行
- 否則檢查 `(OLD.published_at AT TIME ZONE 'Asia/Taipei')::date = (now() AT TIME ZONE 'Asia/Taipei')::date`，否則 `RAISE EXCEPTION 'RECALL_EXPIRED: 已過發布當日，不可收回'`
- 同樣覆蓋直接 DELETE：另加 `BEFORE DELETE` trigger 對 `published` 訊號做相同檢查

### 4. 記憶
更新 `mem://logic/trading/publishing-window-restrictions`：補上「rollback 限發布當日台灣時間」規則。

## 不動範圍
- `pending` 狀態（mentor 隔日 cron 才 publish）依然隨時可收回
- Company admin 仍可全時收回（用於人工修正）
- 撤回後的 trade_records / user_performances 清理邏輯不變
