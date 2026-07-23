## 問題根因

目前 `ChipsSection.tsx` L153 在使用者「打開持倉抽屜」的當下才呼叫 `ensure_bsr_queued(stock_id)`，把單檔股票塞進 FinMind queue。這是把「排程」跟「渲染」耦合的初階做法，導致：

- 使用者要看到分點，得先等 queue → worker → FinMind → rollup 一整條跑完
- 沒打開抽屜的股票永遠不會被同步
- 每次抽屜開關都在多打 RPC / edge function

雖然已經有 `tw-bsr-enqueue-post-close`（每日 15:30）與 `tw-bsr-worker-trading`（14:00–20:59 每 10 分鐘），但排程覆蓋不完整、且不會反應「新加入的持倉」，所以使用者實際體感就是「打開抽屜才開始跑」。

## 目標

**BSR 對前端而言必須是唯讀的**。使用者打開抽屜只讀 `tw-chips-detail`（純查詢），任何 enqueue 動作全部搬到後端排程與寫入事件觸發。

## 修改範圍

### 1. 前端徹底去除 lazy enqueue
- `src/checkup/components/freecheckup/ChipsSection.tsx`
  - 移除 L153 `supabase.rpc('ensure_bsr_queued', ...)` 的所有呼叫路徑
  - `bsr_freshness_status = 'not_queued'` 時 UI 直接顯示「等待每日同步」，不再自動觸發
  - 保留手動「立即同步」按鈕（走 `mode=manual`），維持使用者主動 override 的能力
- `src/checkup/hooks/useTwChipsDetail.ts`：移除 not_queued 相關的自動重試 / 補排程副作用，只做讀取

### 2. 後端 `tw-chips-detail` 改為純唯讀
- `supabase/functions/tw-chips-detail/index.ts`
  - 移除任何隱含的 `ensure_bsr_queued` 呼叫（若有）
  - 只做資料查詢與 freshness 判斷，不做寫入

### 3. 補齊主動排程覆蓋率
- 新增 `tw-bsr-enqueue-holdings-delta` edge function（或擴充現有 enqueue mode）：
  - 每 15 分鐘（14:00–20:59 台北時間）掃描 `trade_records` 內 `exit_date IS NULL` 的台股，比對 `tw_bsr_sync_queue` 今日 pending/running/done 名單，把新加入且尚未排程的持倉補入 tier1
  - 這樣使用者今天新開的倉，最多 15 分鐘內會自動排入，不需要打開抽屜
- 對應 cron：`*/15 6-12 * * 1-5`

### 4. 開倉即排程（事件驅動補強）
- 新增 DB trigger `on_trade_record_insert_enqueue_bsr`：
  - `AFTER INSERT ON trade_records`，若 `market IN ('TW','TWSE','TPEX')` 且 stock_id 符合白名單，直接呼叫 `ensure_bsr_queued(stock_id)`
  - 使用 `SECURITY DEFINER` 走 service role，繞過 RLS
  - 讓「新增持倉」的當下就把 FinMind 排入，不用等下一輪 cron 也不用等使用者打開抽屜

### 5. 回歸測試
- `e2e/chips-section.spec.ts`：新增斷言「開啟抽屜時不得發出 `ensure_bsr_queued` 的 RPC 請求」（透過 `page.on('request')` 白名單）
- 新增 `supabase/tests/enqueue_on_trade_insert_test.sql`：驗證新增台股 trade_record 後，`tw_bsr_sync_queue` 立刻有對應 pending 記錄
- 擴充 `supabase/functions/tw-bsr-finmind-sync/manual_and_source_test.ts`：驗證 delta enqueue 不會重複排入已 done 的股票

### 6. 驗收口徑

修完後回報：
1. 打開抽屜的網路請求清單，不再出現 `ensure_bsr_queued`
2. 新增一筆台股 trade_record，10 秒內 `tw_bsr_sync_queue` 出現對應 pending 記錄
3. Delta cron 執行一次後，所有 open 持倉都有今日 queue 記錄（pending/running/done 三態擇一）
4. `bsr_freshness_status = 'not_queued'` 的股票數為 0（在盤後時段）

## 不做的事

- 不改抽屜 UI 版型
- 不動 rollup 演算法與 5-row 門檻
- 不動已完成的 fake-done 修復與降級狀態機
