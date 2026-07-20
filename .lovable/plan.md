
## 現況觀察（實測）

- `tw_bsr_sync_queue`：`pending 496` / `done 6`
- Tier 1（priority=1）僅 6 筆：其中 3 筆已 done，3 筆 pending 的 `stock_id` 是 `071111 / 068003 / 00631 / 707414 / 069559 / 071745` 等 5–6 碼代號（權證／受益憑證，FinMind 沒有 BSR）
- Tier 2（priority=2）有 490 筆，`next_run_at = 17:24 UTC`（Taipei 01:24），時間已到但仍是 pending
- 現在時間：**UTC 17:49 ≒ Taipei 01:49**
- `tw_bsr_api_usage` 今日累計只有 12 次呼叫，額度完全不是瓶頸
- `tw_bsr_degrade_events` 目前 normal，無自動降級中

## 根因

### 根因 A：現在已離開 worker 執行窗口
你上一輪要求「收盤後 14:00–20:59 每 10 分鐘處理一輪」，`tw-bsr-worker-trading` cron 排程已改成僅在 Taipei 14:00–20:59 觸發。現在 Taipei 01:49，**沒有任何 worker 在跑**，所以所有 pending 都會留在原地直到今天下午 14:00。UI 顯示的「排程等待中」是正確狀態，但沒有告訴使用者「還要等幾小時」。

### 根因 B：Tier 1 佇列被無效代號污染
`enqueueTier1Holdings` 從 `trade_records.instrument` 用 `\d{4,6}` 抓代號，會把權證 `071111`、受益憑證 `068003`、`069559` 等一起塞進佇列。這些代號在 FinMind 沒有 `TaiwanStockInstitutionalInvestorsBuySell` 資料，會反覆 fail、吃掉重試次數與額度，也把 Tier 1 的位置佔滿（真正的 4 碼上市櫃股票反而被排在後面 / 已 done 之後看不到）。

正規台股上市櫃普通股／ETF：
- 上市：`^\d{4}$`
- ETF：`^00\d{2,4}[A-Z]?$`（例 `0050`、`00878`、`00631L`）
- 上櫃：`^\d{4}$`（同格式）

要排除的：權證（05/07/08/09 開頭 6 碼）、受益憑證、可轉債、DR 等。

## 修法

### 1. Worker 窗口外顯示「下一次執行時間」而不是含糊的「排程等待中」

修 `src/checkup/components/freecheckup/ChipsSection.tsx`：
- 判斷現在 Taipei 時間是否落在 14:00–20:59；若否，顯示「下一次同步：今天 14:00（或明天 14:00，若已過 20:59）」，並保留現有「僅在收盤後 14:00–20:59 每 10 分鐘處理一輪」文案
- 若在窗口內但仍 pending，顯示目前 pending 排序與預估等待輪數

### 2. 修 `enqueueTier1Holdings` 的代號白名單

修 `supabase/functions/tw-bsr-finmind-sync/index.ts`：
- 抓 `trade_records.instrument` 後，改用「白名單 regex」：`/^(?:\d{4}|00\d{2,4}[A-Z]?)$/`
- 明確排除 5–6 碼權證／受益憑證代號
- 對已存在的 Tier 1 pending 中不合格代號，用一次性 SQL 標成 `skipped`（附 `last_error = 'invalid_stock_id_format'`）

### 3. 一次性清理 + 立即補跑

一次性 migration（或 admin 手動）：
- `UPDATE tw_bsr_sync_queue SET status='skipped', last_error='invalid_stock_id_format' WHERE status='pending' AND stock_id !~ '^(\d{4}|00\d{2,4}[A-Z]?)$'`
- 提供 `/company/bsr-rate-limit` 一顆「立即跑一輪 worker（跳過窗口限制）」的按鈕，內部呼叫 `tw-bsr-finmind-sync` with `{ manual: true, ignore_window: true }`，讓你不用等到下午

### 4. 診斷測試

- `supabase/functions/tw-bsr-finmind-sync/enqueue_filter_test.ts`：驗證白名單 regex，涵蓋 `2330 / 00631L / 00878 / 071111 / 068003 / 069559` 等樣本
- `e2e/chips-section-window-hint.spec.ts`：mock 時間為窗口外，斷言 UI 顯示「下一次同步」文案而非只有「排程等待中」

## 你要決定的一件事

**根因 A 的處置**你想選哪一種？
- (a) 只改 UI 文案（維持 14:00–20:59 窗口，符合你上一輪指示）
- (b) 保留 14:00–20:59 主排程，另加一顆 03:00 Taipei 的 catch-up 跑一次（清當日殘留）
- (c) 允許手動觸發按鈕但不改 cron

我預設是 **(a) + 手動觸發按鈕**，因為你明確說過「收盤後才有使用的價值」。若你要 (b) 或 (c) 請講。
