## 問題
關鍵分點區塊仍顯示「BSR 未同步 / 分點資料尚未同步」，原因是 `tw_bsr_daily` 與 `tw_chips_rollup` 從未成功寫入過任何一天 —— 沒有「前次成功資料」可退，昨天加的降級提示因此不會顯示。

上一輪 `tw-institutional-daily-sync` 已加入 `lookback` 逐日回退，但 `tw-bsr-daily-sync` 只做了「週末 → 週五」的 `rollBackToWeekday`，仍是單日抓取；今天 OCR 三次失敗就整檔記 `captcha_retry_exhausted`，不會嘗試昨天／前天。這就是使用者現在看到「未同步」的直接原因。

## 修改範圍

### A. `supabase/functions/tw-bsr-daily-sync/index.ts`
1. 新增 `lookback`（預設 5，可由 body 覆寫；BSR 較慢，上限 7）。
2. 對每檔股票改為「逐日回退迴圈」：
   - 從 `tradeDate` 起往前試，遇週末自動跳過。
   - 先查 `tw_bsr_daily` 該檔 + 該日是否已有 ≥1 列 → 有就視同該日 OK，直接跳出（避免重覆抓）。
   - 呼叫 `fetchBsrForStock`：成功且 `rows.length > 0` → 落地 + `rebuildRollup(stockId, resolvedDate)` + 清失敗紀錄 + break。
   - 失敗（含 `captcha_retry_exhausted` / `empty_rows`）→ 寫入 `tw_bsr_fetch_failures`（該日的失敗紀錄仍保留，reason 已在上一輪細分），`date--` 繼續下一天。
   - 全部 `lookback` 天用盡仍無資料 → 該檔記為 failed 回傳；不覆蓋 rollup。
3. 回傳結構每檔補上 `resolved_date`（實際成功那天），讓呼叫端與日誌看得出跳了幾天。
4. 排程 body 建議帶 `lookback=3`（不動 cron 排程本身，但把 body payload 註釋更新）。

### B. `supabase/functions/tw-chips-detail/index.ts`
- 不動查詢邏輯（已按 `as_of_date desc` 取最新 rollup，天然支援前一天資料）。
- 沿用既有 `bsr_as_of_lag_days` + `bsr_last_failure`：現在真的會有值。

### C. `src/checkup/components/freecheckup/ChipsSection.tsx`
- 沿用上一輪加好的「BSR YYYY/MM/DD（前 N 個交易日）」與失敗提示條，無需再動。

### D. 首次資料回補
- 部署後手動打一次 `tw-bsr-daily-sync` 帶 `{ lookback: 7, limit: 20 }`，把最近一個成功交易日的 BSR 塞進 rollup，讓前端立刻不再顯示「未同步」。
- 若使用者當下看的股票（例：2330）不在自動挑選的 20 檔內，補一次帶 `{ stock_ids: ["2330"], lookback: 7 }` 針對性回補。

### E. 驗證
- Deno smoke：mock `fetchBsrForStock` 前 2 天 throw `captcha_retry_exhausted`、第 3 天回 3 列 → assert `resolved_date === tradeDate - 3` 且 rollup 有寫入。
- `e2e/chips-section.spec.ts` 新增 case：mock payload `bsr_as_of = 前 2 個交易日` + `bsr_last_failure.reason='captcha_retry_exhausted'` → assert 標題顯示「BSR YYYY/MM/DD（前 2 個交易日）」且降級提示條可見。
- 手動呼叫回補後查 `tw_chips_rollup` 確認 `stock_id=2330` 有 rows。

## 不動的東西
- DB schema、rollup 表結構、rollup 計算公式、pg_cron 排程時間、前端 UI 排版與視覺回歸 baseline、OCR pipeline 本體。
- BSR 抓不到就抓不到（例如整週 TWSE 都當機或 OCR 全滅）：`lookback` 用盡後行為與現況相同，只是使用者會看到更完整的失敗說明。

## 技術細節
- 交易日判定：沿用 `rollBackToWeekday`（週一至週五）；國定假日仍會空跑一次然後 `date--`，`lookback ≤ 7` 上限 7 次 fetch/檔。
- 冪等性：每日抓成功前先 `delete().eq(stock_id).eq(trade_date=resolvedDate)` 再 insert，與現行一致。
- `tw_bsr_fetch_failures`：每個嘗試過但失敗的日期都獨立寫一筆，`onConflict: stock_id,trade_date` 更新；成功那天不再寫（保留 clean 語意）。
- Rollup 覆寫策略：只在成功日呼叫 `rebuildRollup(resolvedDate)`；失敗不動舊 rollup，因此 `tw-chips-detail` 取到的 `latestAsOf` 永遠是最近一次成功日。