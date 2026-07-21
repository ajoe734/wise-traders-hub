## 根因（已用 DB 讀取交叉驗證）

我用 `tw_bsr_sync_queue` / `tw_bsr_attempt_logs` / `tw_bsr_fetch_failures` / `tw_bsr_daily` / `cron.job_run_details` 對這條卡住的紀錄拉了完整快照。事實如下：

- 目標代號 `00631`（是 ETF，元大寶滬深；同族 00631L 也是 ETF），佇列狀態：`status=pending, priority=1, attempts=5, last_error=NULL`，`next_run_at=2026-07-21 03:15Z（11:15 Taipei）`。
- `tw-bsr-worker-tier1-catchup` cron 這 2 小時內每 15 分鐘都跑成功（`cron.job_run_details` 顯示 succeeded）。
- 但 `tw_bsr_daily` 對 `00631` **一筆都沒有**、`tw_bsr_attempt_logs` 和 `tw_bsr_fetch_failures` 也**完全沒有 00631 的紀錄** → worker 有跑，只是**靜默什麼都沒寫**。
- 佇列裡還有一大堆 `0052 / 0055 / 0056 / 00636 / 006203…` 全是 ETF（`priority=2, attempts=0`），未來只會複製一樣的失敗。

結論：**FinMind 的分點（BSR）資料只覆蓋一般個股，ETF 本來就沒有分點**。這種代號打去 FinMind 會拿到空陣列，worker 因為「非錯誤、但無資料」的分支沒寫 log、沒寫 failure、只把 `attempts++` 就把 row 放回 pending，於是永遠回推、永遠失敗、UI 永遠停在「首次同步中」。

其次還有兩個違反既定原則的問題：

1. `tw-bsr-worker-tier1-catchup` 排程是 `*/15 * * * *`（全天），違反您先前定下的「**收盤後才處理，交易時段不跑**」。
2. `ChipsSection` 文案仍寫「持倉每 15 分鐘自動抓取一輪」，跟收盤後才跑的規則對不上。

## 要做的修正

### 1. 前端 — ETF / 非個股直接不顯示分點區塊
在 `ChipsSection.tsx` 判斷資產分類：只要是 ETF（代號 `00` 開頭且長度=4，或 `006` 開頭，或 `009` 開頭；或 `holdings` metadata 已標示 `asset_class='etf'`）就直接渲染「ETF 無分點資料（FinMind 未提供）」，**不再送 enqueue、不再輪詢**。

### 2. 後端 — enqueue 前擋掉 ETF / 權證 / 非個股
在 `supabase/functions/_shared/twStockId.ts`（或現有 whitelist 檔）加 `isChipEligible(stockId)`：
- 排除 4 碼 `00xx` / `006xxx` / `00xxx` ETF 前綴。
- 排除 6 碼權證（已存在的 `invalid_stock_id_format` 分支）。
`enqueueTier1Holdings` 與 post-close enqueue 都套用；並一次性把佇列裡既有的 ETF pending 標成 `status='skipped', last_error='not_chip_eligible'`。

### 3. 後端 — Worker 空資料要落 log 並轉 skipped
`tw-bsr-finmind-sync`（或 tier1-catchup 內的抓取分支）在 FinMind 回空陣列時：
- 寫入 `tw_bsr_fetch_failures`：`reason='no_chip_data'`。
- 若同一 `stock_id` 連續 3 次 `no_chip_data`（跨 3 個交易日回推都空），將 queue row 直接 `status='skipped', last_error='no_chip_data'`，不再重試。
- `last_error` 一律要有內容（目前 `sync_failed` / `NULL` 都無法診斷）。

### 4. 修正 cron 排程 — 收盤後才跑 tier1-catchup
`tw-bsr-worker-tier1-catchup` 從 `*/15 * * * *` 改成 `*/15 6-12 * * 1-5`（06:00–12:59 UTC ＝ 14:00–20:59 Taipei，週一~週五），與 `tw-bsr-worker-trading` 對齊「收盤後才有價值」的原則。

### 5. UI 文案 & 錯誤訊息
- `ChipsSection.tsx` 把「持倉每 15 分鐘自動抓取一輪」改成「**收盤後 14:00–21:00 每 15 分鐘一輪**」。
- 「失敗原因：sync_failed」改用真實 label：`no_chip_data` → 「FinMind 尚無此代號分點」、`not_chip_eligible` → 「ETF／權證無分點」、`rate_limited` → 「API 額度已用完，將於下輪重試」。

### 6. 資料清理（一次性 migration）
- 把佇列中所有 ETF prefix 的 `pending` 標為 `skipped / not_chip_eligible`。
- 把 `00631 / 00631L` 標為 `skipped / not_chip_eligible`。
- `tw_bsr_sync_queue` 加索引 `(status, priority, next_run_at)` 若尚未存在（觀察 pending 掃描頻繁）。

### 7. 驗證
- `/company/bsr-rate-limit` 的 `PerStockStatusCard` 應立即看到 00631 從「排程等待中」轉為「ETF／權證無分點」。
- 個股（例如 2330 / 4576 / 6285）不受影響，`tw_bsr_daily` 仍持續更新。

---

## 摘要
根因是 FinMind 分點資料不涵蓋 ETF，00631 這類代號被無條件塞進佇列、worker 空資料靜默返回，佇列永遠回推。修法為前端＋後端雙側過濾 ETF、worker 空資料要落 log 並轉 skipped、cron 改為收盤後才跑、文案與錯誤訊息對齊。
