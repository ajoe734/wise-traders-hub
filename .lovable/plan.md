## 目標
在 `tw-bsr-daily-sync` 加上 `mode: "audit"`（唯讀，不觸網、不寫表），一次回傳每支股票的：

- `attempted_as_of_date`：原本應抓的目標日（`rollBackToWeekday(date)`）
- `lookback_chain`：lookback 視窗內每一天是否已有 `tw_bsr_daily` 資料
- `last_successful_as_of_date`：`tw_bsr_daily` 中 ≤ 目標日的最近一筆成功日 + 筆數 + lag_days
- `rollup_as_of_date`：`tw_chips_rollup` 目前對齊到的日期（5/20/60 三窗）
- `failure_state`：`tw_bsr_fetch_failures` 目前的 reason / attempts / consecutive_failures / next_retry_at / resolved_at
- `aligned`：`rollup.as_of == last_successful`（true 表示對齊）；否則列出 `mismatch_reason`

同步在前端 BSR 失敗看板加「Audit」按鈕，點單一股票即彈出 audit 結果 modal，方便端到端比對。

## 變更清單

### 1. `supabase/functions/tw-bsr-daily-sync/index.ts`
- 新增 `mode === "audit"` 分支（走 lock 之外，唯讀）：
  - 接受 `{ mode: "audit", stock_ids: string[], date?, lookback? }`
  - 每檔並行執行：
    - 查 `tw_bsr_daily` 在 `[date-lookback, date]` 每一天的 count → `lookback_chain`
    - 查 ≤ `date` 的最近 `trade_date` + count → `last_successful`
    - 查 `tw_chips_rollup` 三個 window_days 的 `as_of_date` → `rollup`
    - 查 `tw_bsr_fetch_failures` 該 `stock_id` 全部（含已 resolved）→ `failure_state`
    - 比對 `rollup.as_of_date === last_successful.as_of_date` → `aligned`、`mismatch_reason`
  - 回傳 `{ mode: "audit", date, lookback, results: [...] }`
- 不呼叫 `acquireLock`、不 fetch TWSE、不寫任何表。

### 2. `supabase/functions/tw-bsr-failure-dashboard/index.ts`（如需）
- 保持不動；audit 走同一 `tw-bsr-daily-sync` 但 `mode: "audit"`。

### 3. `src/pages/company/BsrFailureDashboard.tsx`
- Top Offenders 每列尾端加 `Audit` 小按鈕
- 點擊 → `supabase.functions.invoke("tw-bsr-daily-sync", { body: { mode: "audit", stock_ids: [id], lookback: 7 } })`
- 用一個輕量 Dialog 顯示：
  - Attempted / Last Successful / Rollup(5,20,60) 三欄對齊表
  - Lookback chain（每日 ✔/✘ + rows）
  - Failure 歷史（最近 5 筆）
  - 大字 `aligned=true/false`（true 綠、false 琥珀 + mismatch_reason）

### 4. E2E `e2e/bsr-audit-mode.spec.ts`
- 呼叫 `tw-bsr-daily-sync` with `mode:"audit"` 針對 `2330`、`0050`、一個明知沒資料的 `9999`：
  - 回傳結構欄位齊全
  - `aligned` 布林正確
  - 未寫入 `tw_bsr_daily` / `tw_bsr_fetch_failures`（比對呼叫前後 count）

## 技術細節

Audit 分支跳過 lock：唯讀查表不會互斥、避免被 5 分鐘 cron 佔用鎖時完全卡死。

`mismatch_reason` 判定：
- `rollup_missing`：last_successful 存在但 rollup 無該日
- `rollup_stale`：rollup.as_of < last_successful（rebuild 沒跑）
- `rollup_ahead`：rollup.as_of > last_successful（資料被砍但 rollup 未清）
- `no_data`：兩邊皆空

回傳範例：
```json
{
  "mode": "audit",
  "date": "2026-07-20",
  "results": [{
    "stock_id": "2330",
    "attempted_as_of_date": "2026-07-20",
    "last_successful": { "as_of_date": "2026-07-18", "rows": 892, "lag_days": 2 },
    "rollup": { "5": "2026-07-18", "20": "2026-07-18", "60": "2026-07-18" },
    "lookback_chain": [
      { "date": "2026-07-20", "rows": 0 },
      { "date": "2026-07-17", "rows": 0 },
      { "date": "2026-07-18", "rows": 892 }
    ],
    "failure_state": { "reason": "captcha_retry_exhausted", "consecutive_failures": 2, "next_retry_at": "...", "resolved_at": null },
    "aligned": true,
    "mismatch_reason": null
  }]
}
```
