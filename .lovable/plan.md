## 目標
在 `/company` 後台新增「BSR OCR 失敗看板」，逐檔顯示每日 `captcha_retry_exhausted` 與其他失敗率，並顯示每檔 fallback 實際使用的 `as_of_date`，方便追蹤被擋的模式。

## 資料來源（已存在，無需新表）
- `tw_bsr_fetch_failures`：`stock_code`, `target_date`, `reason`, `consecutive_failures`, `next_retry_at`, `backoff_seconds`, `created_at`
- `tw_bsr_daily` / `tw_chips_rollup`：取得每檔實際落地的最近 `as_of_date`（即 fallback 對齊日）
- `tw_bsr_sync_metrics`：15 分鐘 bucket 的成功／失敗計數（全域趨勢）

## 新增 Edge Function：`tw-bsr-failure-dashboard`
Query params：`from`, `to`（預設近 14 天）、`stock_code?`、`reason?`

回傳結構：
```json
{
  "range": { "from": "2026/07/06", "to": "2026/07/20" },
  "globalDaily": [
    { "date": "2026/07/20", "attempts": 320, "success": 280,
      "captcha_retry_exhausted": 22, "http_403": 8, "empty_rows": 6,
      "captcha_rate": 0.069 }
  ],
  "perStock": [
    {
      "stock_code": "2330",
      "attempts": 14, "success": 12,
      "captcha_retry_exhausted": 2, "other_failures": 0,
      "captcha_rate": 0.143,
      "consecutive_failures": 0,
      "next_retry_at": null,
      "latest_target_date": "2026/07/20",
      "fallback_as_of_date": "2026/07/18",
      "fallback_lag_days": 2,
      "dailyBreakdown": [
        { "date": "2026/07/20", "reason": "captcha_retry_exhausted", "attempts": 3 },
        { "date": "2026/07/19", "reason": "ok" }
      ]
    }
  ],
  "topOffenders": [ /* 依 captcha_rate 降冪、近 7 日 attempts ≥ 3 */ ]
}
```

實作要點：
- 一次 SQL 聚合 `tw_bsr_fetch_failures` by `(stock_code, target_date, reason)`
- Left join `tw_bsr_daily`（`MAX(trade_date)`）與 `tw_chips_rollup`（`bsr_as_of_date`）取每檔 fallback 對齊日
- `attempts` = `consecutive_failures` 累計 + 每日 metrics bucket 交叉核對
- 只 `service_role`，前端從 `/company` 走 admin RPC 呼叫

## 前端新增：`src/pages/company/BsrFailureDashboard.tsx`
路由：`/company/bsr-failures`（加進 `AdminLayout` 側欄「維運」群組）

版面（沿用 legendflow 極簡風、`YYYY/MM/DD`）：
1. **頂部篩選列**：日期區間（預設 14 天）、失敗原因 multi-select、股票代號搜尋
2. **全域趨勢卡**：折線圖 — 每日 `captcha_rate`、`http_403` 條、總成功數；上方 KPI（近 7 日平均 captcha 率、被封鎖天數、fallback 使用檔數）
3. **Top Offenders 表**（近 7 日 captcha_rate 前 20）：欄位 = 代號 / 名稱 / 嘗試 / captcha 次數 / 率 / 連續失敗 / next_retry_at（相對時間）/ fallback as_of_date + lag badge
4. **逐檔明細表**（分頁 50）：可展開 row，展開後顯示 `dailyBreakdown` 熱度格（近 14 天，綠=成功、琥珀=captcha、灰=其他失敗），並列出實際 `fallback_as_of_date` 與該日 rollup `rows` 數
5. **匯出 CSV** 按鈕（重用現有 `exportCsv` helper）

顏色遵守台灣慣例但用琥珀（#B45309）表示 captcha、紅（#B23A48）表示 http 阻擋，避免與漲跌色衝突。

## 技術細節
- 檔案：
  - `supabase/functions/tw-bsr-failure-dashboard/index.ts`（新增，`verify_jwt=false`，內部檢查 admin role）
  - `supabase/config.toml`：註冊該 function
  - `src/pages/company/BsrFailureDashboard.tsx`（新增）
  - `src/components/layouts/AdminLayout.tsx`：側欄加入項目（維運群組）
  - `src/App.tsx`：加 lazy route
- 管理員驗證：沿用 `has_role(auth.uid(), 'admin')` 檢查，非 admin 直接 403
- 快取：React Query，`staleTime: 60_000`；手動 refresh 按鈕
- E2E：`e2e/bsr-failure-dashboard.spec.ts` 覆蓋 admin 可看、非 admin 403、篩選、CSV 匯出、fallback lag badge 呈現、8 個斷點視覺快照

## 不做
- 不改 `tw-bsr-daily-sync` 抓取邏輯（此為觀測面板，不干預抓取）
- 不新增表（重用既有 3 張）
- 不做告警（後續若需要再接 `system_alerts`）
