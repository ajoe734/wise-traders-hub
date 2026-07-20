## 目標
使用者看到「網路異常／尚未同步」的根因有兩層，一併修：

1. **`tw-chips-detail` 根本沒部署**：`supabase/config.toml` 沒登記 `tw-chips-detail`、`tw-institutional-daily-sync`、`tw-bsr-daily-sync` 三支函式；前端 fetch 直接 `Failed to fetch`。
2. **資料表全空**（`tw_institutional_daily` 0 列、`tw_bsr_daily` 0 列）：同步從未成功跑過，且同步器只認「今天」，遇到假日／夜間／盤前就抓空、回 `no_data` 收工，不會回補前一交易日。使用者要求：**「沒有最新就抓前一天最新的」**。

## 修改範圍

### A. 註冊 & 部署三支函式
- `supabase/config.toml`：新增
  ```
  [functions.tw-chips-detail]         verify_jwt = true
  [functions.tw-institutional-daily-sync] verify_jwt = false
  [functions.tw-bsr-daily-sync]           verify_jwt = false
  ```
  （後兩支給 pg_cron 呼叫，走 service role header，不驗 JWT。）

### B. 同步器加入「回溯最近 N 個交易日」語意
`tw-institutional-daily-sync/index.ts`：
- 新增 `lookback`（預設 7）參數；當請求日 TWSE 回 `no_data` 或 `stat != OK`，`date = date - 1`，最多回溯 `lookback` 天，直到抓到資料或用盡。
- 週六日直接跳過（TWSE 不開盤，省 request）。
- 回傳 `{ requested_date, resolved_date, inserted, attempts }`。

`tw-bsr-daily-sync/index.ts`：同樣加 `lookback`（預設 5，BSR 較慢），逐日回退 + 週末跳過。

### C. `tw-chips-detail` 明確標示資料日
- 現有查詢已用 `order trade_date desc limit 65`，自然吃到「最新可得」那天，這部分無需改。
- 但要把 `as_of` 的語意講清楚回前端：新增 `as_of_lag_days`（今日 vs 最新一筆 trade_date 的日曆差），前端可決定要不要提示「顯示前 X 個交易日資料」。
- 完全沒資料時，`as_of = null` 保留；前端已有「尚未同步」文案。

### D. 前端 `ChipsSection` 降級文案調整
- 當 `data.as_of` 存在且 `as_of_lag_days ≥ 1`：在標題右側顯示 `AS OF YYYY/MM/DD（前 N 個交易日）`，不再一律叫「尚未同步」。
- 當 `as_of = null` 才維持現在的空狀態文案。
- 錯誤橫幅維持既有邏輯，但把 `Failed to fetch` 分類 reason 從「網路連線失敗」細分：若 function 4xx/5xx 顯示「服務尚未就緒」，避免誤導使用者是自己網路壞掉。

### E. 首次資料回補
- 部署後手動打一次 `tw-institutional-daily-sync?lookback=7`、`tw-bsr-daily-sync?lookback=5`，把最近一個交易日的資料塞進來，讓使用者立刻看到內容。
- pg_cron 排程沿用（17:45 / 18:15），但 cron body 帶 `lookback=3`，允許前一天補抓。

### F. E2E / 驗證
- `e2e/chips-section.spec.ts` 新增 case：mock `as_of_lag_days=2`，assert 標題顯示「AS OF … (前 2 個交易日)」。
- Deno smoke：對兩支 sync 用假日日期呼叫，assert 回傳 `resolved_date` 為前一交易日。

## 不動的東西
- DB schema、rollup 表結構、視覺回歸 baseline。
- BSR OCR pipeline 本體邏輯（只在外層加日期回退迴圈）。

## 技術細節（給工程確認用）
- 「交易日」判定：目前無 `market_calendar` 表；先用「週一到週五 + 排除同步器已知回傳 `no_data` 的日」啟發式。國定假日仍會空跑一次然後 `date--`，可接受（每次多 1 個 request，`lookback ≤ 7` 上限 7 次）。
- 前端 `useTwChipsDetail` 型別新增 `as_of_lag_days?: number`；不破壞既有欄位。
