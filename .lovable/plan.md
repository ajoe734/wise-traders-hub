## 目標邏輯（用你的話重述確認）

- **首抓（immediate）**：任一老師的持倉出現一檔「`tw_bsr_daily` 從未有資料」的個股時，立刻進 P1 排 FinMind 一次，把歷史/最新資料灌進來。
- **後續（post-close only）**：只要那檔已經有資料，就完全不在交易時段動它；每天等收盤後（14:00 之後）補當日一筆即可。
- **交易時段（09:00–13:30）**：不對「已有資料」的個股做任何 FinMind 呼叫，省 rate limit。

---

## 現況（已確認）

- Worker 目前有兩個 cron：
  - `tw-bsr-worker-trading` 14:00–20:59 每 X 分鐘跑（收盤後）
  - `tw-bsr-worker-tier1-catchup` 定時補 P1 缺口 — **這隻不分時段**，會在盤中也打 FinMind
- 排程 enqueue 來源（`enqueueTier1Holdings` 等）在盤中被觸發時，會把「已有資料的個股」也重排進 pending，worker 就會照打。
- 結果：盤中額度被「重抓已有資料」吃掉，新持倉首抓反而被排隊卡住。

---

## 變更計畫

### 1. Enqueue 端加「首抓 vs 補資料」分流
`enqueueTier1Holdings`（`supabase/functions/_shared/bsrQueue.ts` 或同名 helper）改為：
- 對每個 symbol 先查 `tw_bsr_daily` 是否已有任何一筆。
- **無資料** → priority = 1（P1 immediate）、允許任何時段。
- **有資料** → priority = 3（post-close only）、標記 `post_close_only = true`。

需要在 `tw_bsr_sync_queue` 新增欄位 `post_close_only boolean default false`（migration）。

### 2. Worker 端加時段守門
- `tw-bsr-worker-tier1-catchup` 與 `tw-bsr-worker-trading` 在取任務時：
  - 若目前是台北時間 09:00–13:29（盤中），`WHERE post_close_only = false`。
  - 收盤後（≥14:00）或盤前（<09:00）不限制。
- 首抓（無歷史）永遠可跑，因為它 `post_close_only = false`。

### 3. 觸發首抓的即時鉤子
新持倉寫入時（`trade_records` insert 或 `expert_signals` published）→ 呼叫既有的 enqueue helper，讓「無資料的新標的」立刻進 P1，不用等下一輪 cron。

（目前 enqueue 只在 cron 內跑，等於首抓最壞要等 10 分鐘。）

### 4. 前端提示語校準
`ChipsSection.tsx` 對「已有資料、盤中」的個股顯示「盤後更新（14:00 後）」而不是「排程等待中」，避免又被誤解為卡住。

---

## 技術細節

- **不會動到**：FinMind rate limiter、reservation lease、degrade 邏輯。
- **Migration**：`ALTER TABLE tw_bsr_sync_queue ADD COLUMN post_close_only boolean NOT NULL DEFAULT false;` + 索引 `(status, post_close_only, priority)`。
- **時段判斷**：直接用 `Asia/Taipei` 的 hour，週末照樣可跑（週末不是盤中）。
- **回填舊 queue**：現有 pending 項目一次性標記 `post_close_only = true`（除了 `tw_bsr_daily` 沒資料的）。

---

## 不做的事

- 不改 FinMind API 呼叫方式、不改 rate limit 額度。
- 不動白名單（ETF 等）邏輯，那是另一個議題。
- 不改 UI 主要版面，只調文案。

---

## 驗證

1. 找一檔沒進過持倉的個股，模擬老師加入 → 應該幾秒內開始跑 FinMind、資料進 `tw_bsr_daily`。
2. 已有資料的個股在盤中觀察 `tw_bsr_api_usage`，應該 0 次呼叫；14:00 後開始跑。
3. `/company/bsr-rate-limit` 每檔個股的 next-run 標示正確（首抓即時 / 已有資料等收盤）。
