## 目標
當今天分點資料還沒同步完，`ChipsSection` 顯示前一交易日已完成的資料；只有在 raw fallback 日期本身已確認 complete 且比 rollup 更新時才切換到 raw fallback。

## 已驗證的 completion 訊號
專案內既有兩個判定 raw 日資料完成的權威來源，本次沿用、不新增：
- **主判定**：`tw_bsr_sync_queue` 內 `(stock_id, trade_date)` 存在 `status='done'` 且 `finished_at is not null` 的紀錄 — sync worker 完成後才 mark done（`index.ts` L485）
- **輔助判定**：`isDoneAlready` 語意 = `count(tw_bsr_daily WHERE stock_id AND trade_date) >= 5`（`index.ts` L155–160、L179 already_done short-circuit 亦用同一門檻）
- **complete 定義**：主判定命中即 complete；主判定沒紀錄但 raw rows ≥5（極少見的 legacy／手動匯入路徑）也視為 complete。任一未滿足即視為 pending／partial。

## 關鍵前置決策

### A. 交易日 helper 共用 → `_shared/tradingDate.ts`
從 `tw-bsr-finmind-sync/lib.ts` 遷出 `taipeiNowFrom`／`toIsoDate`／`addDays`／`isWeekday`／`rollBackToWeekday`／`isAfterCloseAt`／`decideEffectiveDate`；`lib.ts` re-export 保相容。`tw-chips-detail` 從此檔匯入。新增 `expectedLatestBsrDate(nowMs)` 薄包裝。已知限制：只涵蓋週末，不含國定假日 → lag 欄位命名為 `bsr_lag_weekdays`。

### B. rollup 與 raw fallback 共用計算 → `_shared/bsrRollup.ts`
`computeBsrWindow(rows, windowDays)` 完全等同現行 `rebuildRollup`（依 broker_id 累加、top_buy/top_sell 各前 3、集中度 = top15 buy_shares 和 ÷ 全體 buy_shares 和 × 100、days_covered = 不同 trade_date 數）。`pickWindowDates`、`nameOrFallback`（缺名 → `券商分點 {id}`）。`rebuildRollup` 改呼叫共用函式，upsert 欄位／onConflict 不動。

### C. Raw 完整性 helper（新增，本次核心）
在 `_shared/bsrRollup.ts` 加：
```
isRawDateComplete(supa, stockId, tradeDate) → boolean
```
- 先查 `tw_bsr_sync_queue.select('finished_at').eq(stock_id, tradeDate).eq('status','done').limit(1)` → 命中即 true
- 否則 `tw_bsr_daily count(head=true) >= 5` → true
- 否則 false（不完整或未寫入）
- 純函式邏輯抽到 `pickCompleteFallbackDate(rows, doneSet)` 便於單測（不打 DB）

## 修改範圍

### 1. `_shared/tradingDate.ts`（新增）
遷入 helper + `expectedLatestBsrDate`；日期比較一律 ISO `YYYY-MM-DD` 字串比較（在同一時區 slice 出的字串詞典序 = 時間序）。

### 2. `tw-bsr-finmind-sync/lib.ts`（改）
交易日 helper 改為 re-export；FinMind aggregate 保留；`lib_test.ts` 全綠。

### 3. `_shared/bsrRollup.ts`（新增）
`computeBsrWindow` / `pickWindowDates` / `nameOrFallback` / `pickCompleteFallbackDate` / `isRawDateComplete`（後兩者含 DB 查詢版與純函式版）。

### 4. `tw-bsr-finmind-sync/index.ts`（改）
`rebuildRollup` 改呼叫 `computeBsrWindow`+`nameOrFallback`；對外 0 變化。

### 5. `tw-chips-detail/index.ts`（改，關鍵修訂）

**Raw 完整性資料**：
- 對現查得的 `bsrRows`，收集所有出現過的 `trade_date`
- 一次查詢 `tw_bsr_sync_queue.select('trade_date').eq('stock_id', stockId).eq('status','done').in('trade_date', dates)` → 得 `doneDateSet`
- 對每個候選 `trade_date`：`complete = doneDateSet.has(d) || rowCountByDate[d] >= 5`
- `fallbackAsOf` = **候選中最新且 complete 的 trade_date**（不再單純 max）

**資料來源選擇（依需求順序）**：
1. `latestAsOf === expectedTradeDate` → 用 rollup（source='rollup', 所有窗口用 rollup）
2. 沒有 rollup，且沒有任何 complete raw date → 不切 raw，`chosenAsOf=null`，UI 依 queue 狀態走 syncing／sync_failed 空狀態
3. 沒有 rollup，但有 complete raw → `source='raw_fallback'`、`chosenAsOf=fallbackAsOf`、`d5=computeBsrWindow(rowsOfLast5CompleteDates, 5)`、`d20=d60=null`
4. 有 rollup，且 `fallbackAsOf > latestAsOf`（詞典序 ISO 比較） → `source='raw_fallback'`、同上；d20/d60 null
5. 有 rollup，且 raw 最新日期較新但**不 complete**（或無 complete raw 較新） → **保留 rollup**（`chosenAsOf=latestAsOf`, `source='rollup'`, 所有窗口用 rollup），配合 queue 狀態顯示 syncing／sync_failed 註記
6. 其他 → 保留 rollup

**日期比較一律 ISO 字串比較**。

**Lag 欄位語意一致**：
- `bsr_lag_weekdays` = expectedTradeDate → chosenAsOf 的 weekday 差
- `bsr_as_of_lag_days` = `bsr_lag_weekdays`（JSDoc `@deprecated`），杜絕雙欄位歧義
- `bsr_is_stale = bsr_lag_weekdays >= 2`

**freshness 優先順序**（fresh 用 `>=` 判定，避免異常時被誤判為 lagging）：
1. `ineligible` — `!eligible`
2. `fresh` — `chosenAsOf != null` 且 `chosenAsOf >= expectedTradeDate`（ISO 詞典序）
3. `syncing` — queue `status ∈ {pending, running}`
4. `sync_failed` — queue `status ∈ {failed, dead}`
5. `lagging` — `chosenAsOf != null`（fresh 沒命中即代表落後）
6. `not_queued` — `chosenAsOf == null` 且 queue `status = not_queued`／done／skipped
7. `no_data` — 其餘

**新增回傳**：`bsr_expected_trade_date`、`bsr_as_of_source`（'rollup'|'raw_fallback'|null）、`bsr_lag_weekdays`、`bsr_is_stale`、`bsr_freshness_status`。
**現有欄位**：`bsr_sync_status`、`bsr_last_failure`、`bsr`、`bsr_as_of` 保留；`bsr_as_of_lag_days` = `bsr_lag_weekdays`。

### 6. `ChipsSection.tsx` + `useTwChipsDetail.ts`（改）
- Types 補新欄位
- **有 `bsr_as_of`** → 正常渲染 `chips-bsr`；AS OF 下方依 `bsr_freshness_status` 加 mute 小字：
  - `fresh` → 不加
  - `syncing` → 「最新分點尚在同步，暫時顯示 MM/DD」
  - `sync_failed` → 「最新分點同步失敗，暫時顯示 MM/DD」
  - `lagging` + `bsr_is_stale` → 「資料日期較預期落後」
  - `lagging` 非 stale → 不加
- **無 `bsr_as_of`** → 空狀態依 `bsr_freshness_status`：
  - `syncing` → 「分點資料首次同步中，稍後自動更新」
  - `sync_failed` → 「分點資料同步失敗，將自動重試」
  - `ineligible` → 沿用 `headerLabel`
  - `not_queued` / `no_data` → 現行文案
- `chips-bsr-status` 加 `data-bsr-freshness` 便於 e2e
- 版面／色票／分組完全不動

### 7. `bsrHeaderLabel.ts` — 不動；`bsrHeaderLabel.test.ts` 全綠。

## 回歸測試

### `_shared/tradingDate_test.ts`（新增）
遷入原 lib_test 相關 case，鎖 re-export 一致；驗證 ISO 詞典序比較。

### `_shared/bsrRollup_test.ts`（新增）
`computeBsrWindow` 空 rows／同 broker 跨日累加／資料不足窗口／全淨買無 top_sell／broker_name null 走 `券商分點 {id}`／集中度公式 snapshot 與 rebuildRollup 拆前一致；`pickCompleteFallbackDate` 依 doneSet + row count 選對日期。

### `tw-chips-detail/rawFallback_test.ts`（新增；fake supa client）
基本情境：
- rollup 空 + tw_bsr_daily 3 天皆 complete → `bsr.d5` 非空、`source='raw_fallback'`、**d20=d60=null**
- rollup 有 `expectedTradeDate` → `source='rollup'`、`fresh`
- rollup=T-1，raw 最新 complete=T-2 → 保留 rollup、d20/d60 沿用 rollup
- rollup=T-1 + queue pending → `source='rollup'`（不覆寫）、`freshness=syncing`、標頭「暫時顯示」
- rollup=T-1 + queue failed → `sync_failed`；queue dead → `sync_failed`
- rollup 落後 3 weekday + not_queued → `lagging` + `is_stale=true`
- 週六 09:00 TPE + rollup=週五 → `fresh`
- 收盤前週三 10:00 + rollup=週二 → `fresh`
- bsr_as_of=null + queue pending → `syncing`；running 同；failed/dead → `sync_failed`
- bsrRows 空 + rollup 空 + not_queued → `not_queued`／`no_data`
- 同 fixture rebuildRollup vs detail fallback → 完全一致

Raw 完整性（本次新增核心）：
- **昨天 complete rollup + 今天 raw 只有 3 rows（不 complete）+ queue running → chosen=昨天 rollup、source='rollup'、freshness='syncing'、標頭「暫時顯示」；不可切到今日 raw**
- **昨天 complete rollup + 今天 raw ≥5 rows 且 queue status='done' → chosen=今日、source='raw_fallback'、d5 用今日、d20=d60=null**
- **無 rollup + 今天 raw 部分寫入（不 complete）+ queue running → chosen=null、freshness='syncing'、UI 走「分點資料首次同步中」，不渲染部分 chips-bsr**
- **raw table 同時有今天未 complete + 昨天 complete → fallbackAsOf=昨天（非今日 max），source='raw_fallback' 且 chosen=昨天**

前次補上的三點：
- raw fallback 較新時 d20/d60 必為 null
- `bsr_as_of_lag_days === bsr_lag_weekdays`（同值）
- `chosenAsOf === expectedTradeDate` 且 queue=pending → `freshness='fresh'`
- 異常 `chosenAsOf > expectedTradeDate`（時差／早排）→ 仍為 `fresh`（`>=` 判定）

### `ChipsSection.fallback.test.tsx`（新增）
- `syncing` + 有 `bsr_as_of` → `chips-bsr` + 標頭「暫時顯示 MM/DD」
- `syncing` + `bsr_as_of=null` → 「分點資料首次同步中」
- `sync_failed` + `bsr_as_of=null` → 「分點資料同步失敗」
- `lagging` + stale → 「資料日期較預期落後」
- `lagging` 非 stale → 只顯示日期
- broker_name 缺 → `券商分點 {id}`
- `source='raw_fallback'` payload → d20/d60 區塊不渲染

### 既有測試
`bsrHeaderLabel.test.ts`、`chips-section*.spec.ts`、`useHoldingsDerivations.grouping.test.js`、`ensure_bsr_queued_test.sql`、`tw-bsr-finmind-sync/lib_test.ts` 維持全綠；視覺 baseline 動到就同步更新。

## 明確不做
- 不改 rollup schema、queue、rate limiter、sync 排程
- 不新增台股假日曆
- 不改 ChipsSection 版面／色票／分組
- fallback 不做 d20/d60；不對長窗外推
- 不保留兩個值不同的 lag 欄位
- 不新增額外 completion marker 表，沿用既有 `tw_bsr_sync_queue.status='done'` + `count(tw_bsr_daily)>=5`

## 對你四點的回答
1. **Raw 完整性**：`fallbackAsOf` 改為候選中「最新且 complete」的 trade_date，complete = queue `status='done'` OR `count(tw_bsr_daily)>=5`。單純 max(trade_date) 不再是採用依據。
2. **來源選擇**：完全按你列的五條分支實作（rollup 為 expected → rollup；raw 較新但未 complete → 保留 rollup；raw 較新且 complete → raw_fallback；無 rollup + raw 未 complete → 空狀態；無 rollup + 有 complete raw → raw_fallback）。
3. **ISO 比較 + fresh `>=`**：所有日期比較皆用 ISO YYYY-MM-DD 詞典序；`fresh` 判定改為 `chosenAsOf >= expectedTradeDate`。
4. **測試**：四個新增情境全部涵蓋於 rawFallback_test.ts。
