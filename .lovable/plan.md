
# 五日回放為何蓋不起來 — 根因診斷與根治計劃

## 現場證據（不是猜測）

以圖中 3443 為例，DB 現況：

```
tw_bsr_daily where stock_id='3443'
  2026/07/23  680 brokers  ✓
  （其它 0 筆）

tw_bsr_sync_queue where stock_id='3443'
  2026/07/23  priority=1  status=done   ← 只有這一筆
  （沒有 7/22、7/21、7/20、7/17 的任何 pending 或 done）

tw_bsr_daily 市場總量
  7/23 41k、7/22 40k、7/21 39k、7/20 86k、7/17 20k … 上游都有資料

converge_bsr_windows 過去 48h enqueued_by 累積：818 筆
worker 過去 15 分鐘：finmind call_count ≈ 30/min，rate_limited=0，degrade 正常
```

**結論**：上游有貨、worker 有在跑、限流沒卡 — **但 3443 的 4 個歷史日根本沒被排進 queue**。三天蓋不完的原因不是「爬得慢」，是**排程器根本沒排到這檔**。

## 根因（五個，並列，全部要修）

### R1 — Convergence 是「機率性抽樣」，不是「決定性補齊」
`converge_bsr_windows` 每次跑最多 40 檔，來源是 `array_agg(DISTINCT sid)` **沒有 ORDER BY**，Postgres 對 array 順序不保證。等於每小時擲骰子挑 40 檔。持倉超過 40 檔就有股票永遠抽不到。**3443 就是被抽落單的那一檔。**

### R2 — 排程只認「今天缺 → 補今天」，沒有「回補視窗」的一次性收斂路徑
converge 每次每檔最多加 `chunk_dates=15` 天，但入列後要靠 worker `*/10` 慢慢消耗；priority=2 又排在 tier1 後面。使用者打開圖表當下，**沒有任何路徑會把 5 日視窗一次補齊**。

### R3 — 前端打開抽屜是「純讀」，不觸發補齊、也看不到補齊進度
之前為了避免「lazy enqueue 初階工程做法」把 `ChipsSection` 的 `ensure_bsr_queued` 拔了。結果從「太懶」翻車成「完全不作為」。**使用者看到圖上只有兩點，系統既沒排程也沒 UI feedback。**

### R4 — 「有效日」定義卡在 `broker_count >= 5`，靜默淘汰不夠亮的日子
`compute_bsr_series_readiness` 把 broker 數 < 5 的日子直接當作沒有，但 UI 上不會顯示「這天上游只給了 3 家」。使用者看到的是「空」，實際是「規則濾掉了」。這個閾值在冷門股會反覆觸發、永遠 filling。

### R5 — 沒有「per-stock 補齊到 N 日」的 API，也沒對應的整合測試
現在的 unit test 只驗 rollup 數學和 readiness state 分類，**沒有一個測試斷言「呼叫 X 後，某檔在 N 秒內達到 5 日 ready」**。這就是為什麼過了三天你才發現它壞。沒被驗證的合約 = 不存在的合約。

## 修法（決定性、需求驅動、可觀察）

### M1 — 讓 converge 變決定性、優先照顧最缺的
- `converge_bsr_windows` 內部改為：
  - 用 CTE 先算每檔 `valid_days_last_60`，`ORDER BY valid_days ASC, last_valid_date ASC NULLS FIRST`
  - 移除 `p_max_stocks` 上限或提高到 500；改用 `p_budget_ms` 控制執行時間
  - 一個 cron tick 內把每檔要補的日子**一次全排入**（5 日窗最多 5 筆、20 日窗最多 20 筆），不再靠多次 cron 慢慢累加

### M2 — 新增「使用者當下需要」的即時通道 `ensure_bsr_window(stock_id, window_days)`
- 新 RPC + Edge Function `tw-bsr-ensure-window`
  - 輸入：stock_id、window_days（預設 5）
  - 行為：inline 排入所有缺的工作日為 **priority=0**（比 tier1 還高），回傳 { queued_dates, existing_dates, expected_ready_within_sec }
- worker 新增 priority=0 專屬 batch，每次至少保留 30% quota 給它
- `ChipsSection.tsx` 打開抽屜、切到「分點集中度」tab 時呼叫一次，帶 stock_id
  - 這不是「lazy 初階做法」— 這是**顯性、有限、可觀測**的 on-demand 補齊，跟 R3 之前那個「無腦每次都排 60 天」有本質差別

### M3 — 前端要顯示「還缺哪幾天、預計何時到齊」
- `ChipsTrendChart` 從 readiness metadata 讀 `missing_dates[]` 與 `pending_queue_dates[]`：
  - 圖上把 missing_dates 畫成灰色 placeholder dot（不是完全空白）
  - 圖下方一行 caption：「補齊中 3/5，剩餘 2 日已排程，預計 ≤ 5 分鐘」
  - 每 15s poll 一次 readiness（有 exponential backoff，收斂即停）

### M4 — 放寬 broker_count 閾值＋透明化
- 把 `>=5` 改為 `>=1`（有任何一筆就算有效日），另存 `low_quality: broker_count<5` 布林
- rollup 計算時仍以 broker_count>=5 為主，但 UI 至少顯示「這天上游只給 N 家」而不是「無資料」
- 修 migration + 更新 `_shared/bsrRollup.ts` + `seriesReadiness.ts`

### M5 — 補「合約級」整合測試
新增 `src/test/integration/bsr-window-fulfillment.test.ts`：
- given: 某檔在 tw_bsr_daily 只有 1 天
- when: 呼叫 `ensure_bsr_window(stock,5)`
- then:
  1. queue 立即出現 4 筆 priority=0 pending
  2. mock worker 執行後，`tw_bsr_daily` 累積達 5 天
  3. `compute_bsr_series_readiness` 回傳 `ready5=true`
- 若任一步驟超過門檻時間或缺欄位 → 測試失敗
- 加入 `.github/workflows/finmind-bsr-tests.yml` 每次 PR 必跑

## 立即救火（M1-M5 上線前的止血）

執行一次性 SQL，把當下所有 active 持倉少於 5 個有效日的檔案，強制排入 priority=1 的 backfill（一次性、可追蹤 correlation_id = `manual-firedrill-<timestamp>`）。3443 應在下一輪 worker tick（≤ 10 分鐘）內補完 5 日視窗，供你立刻驗證圖上跳出 5 個點。

## 驗收（不通過就不算完成）

1. 隨機挑 20 檔僅 1-2 日資料的持倉，跑 M2 API，**每一檔** 10 分鐘內達到 ready5
2. `/company/bsr-rate-limit` 加一張卡：per-stock「距離 ready5 還缺幾天」清單，可排序
3. 整合測試 3 個 case（無資料 / 部分資料 / 上游 exhausted）全綠
4. 手動關掉 cron 24 小時後，再打開，用 M1 的決定性順序驗證：**最缺的檔一定最先被補**（用 correlation_id 追）

## 技術細節

### 檔案清單
- `supabase/migrations/<new>_bsr_deterministic_converge.sql`
  - 重寫 `converge_bsr_windows`：CTE 排序、預算控制、一次補滿窗
  - 新增 `ensure_bsr_window(text, int)` RPC
  - 放寬 `compute_bsr_series_readiness` 的 broker 閾值語意
- `supabase/functions/tw-bsr-ensure-window/index.ts`（新）
- `supabase/functions/tw-bsr-finmind-sync/index.ts`
  - worker 支援 priority=0 批次與 quota 保留
- `supabase/functions/tw-chips-detail/index.ts`
  - readiness payload 增加 `missing_dates[]` / `pending_queue_dates[]`
- `src/checkup/components/holdings/ChipsSection.tsx`
  - 抽屜開啟時呼叫 `tw-bsr-ensure-window`
  - readiness poll 15s + backoff
- `src/checkup/components/holdings/ChipsTrendChart.tsx`
  - 缺日 placeholder dot + caption
- `src/pages/company/BsrRateLimit.tsx`
  - per-stock「離 ready5 差幾天」卡片
- `src/test/integration/bsr-window-fulfillment.test.ts`（新）

### 為什麼這次不會再失敗
- **決定性排序**取代抽樣：不再看運氣
- **on-demand 通道**取代純被動 cron：使用者行為 = 補齊訊號
- **合約測試**綁死行為：程式碼要能通過「10 分鐘內達到 ready5」才准 merge
