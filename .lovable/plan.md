# 券商分點進度儀表板

在管理後台新增一頁 `/company/bsr-progress`，一眼看完「今天抓到哪、還剩多少、上游有沒有掛」，每小時自動更新。

## 頁面內容

### 1. 頂部四張狀態卡

- **最新交易日進度**：例如「2026/09/18 · 105 / 106 檔 · 99%」，含進度條。分母是當日實際掛單的個股母體，不是猜的。
- **待處理筆數**：佇列 pending / running / failed 各多少，並標出其中「重試超過上限」的殭屍筆數。
- **熔斷狀態**：券商分點上游（`finmind_bsr`）目前 closed / half-open / open、連續失敗次數、最後成功時間；同時顯示另外三個相關上游（法人、報價、TPEx）的狀態燈。
- **今日額度**：三個抓取額度池（互動 / 保溫 / 歷史回補）的已用 / 上限與百分比，台北 00:00 歸零時間。

### 2. 每日抓取趨勢（近 15 個交易日）

長條圖 + 表格並列，每一列顯示：交易日、抓到檔數、母體檔數、進度百分比、資料筆數、該日仍在佇列的待處理數。未達 100% 的日期用醒目色標出，讓「哪一天沒補完」一眼看到。

### 3. 待處理明細

佇列中尚未完成的任務清單：個股、交易日、狀態、已重試次數 / 上限、最後錯誤、下次執行時間。可依交易日或錯誤原因篩選，方便判斷是「上游查無資料」還是「額度不足」。

### 4. 更新機制

- 每小時自動重新抓一次，頁面右上顯示「資料更新於 HH:MM」與手動重新整理按鈕。
- 切回分頁時也會重新抓，不會看到過期數字。

## 視覺與一致性

沿用既有管理後台的卡片與表格樣式（與券商分點失敗、回補進度等頁一致），日期一律 `YYYY/MM/DD`，不新增配色。側邊選單「券商分點」群組加入這一頁的入口。

## 技術細節

- 新增 `public.bsr_progress_dashboard(_days int default 15)`，SECURITY DEFINER、固定 `search_path`、`REVOKE PUBLIC/anon`、`GRANT EXECUTE TO authenticated` 並在函式內以 `has_role(auth.uid(),'company_admin')` 把關，非管理員回 42501。回傳單一 JSON：
  - `days[]`：`trade_date`、`stocks_done`、`stocks_expected`、`rows`、`queue_pending`
  - `queue`：依 `status` 彙總，外加 `zombie`（`attempts >= max_attempts` 仍 pending）
  - `pending[]`：未完成任務明細（上限 200 筆）
  - `health[]`：`data_source_health` 中 `finmind_bsr`、`finmind_institutional`、`finmind_price`、`tpex_daily` 四列
  - `quota[]`：`finmind_quota_pools` 三池
  - `generated_at`
  - 分母 `stocks_expected` 取「該日 `tw_bsr_sync_queue` 的 distinct 個股數」，若為 0 則退回近 10 個交易日的最大完成檔數。
  - 每日彙總用 `count(distinct stock_id)` 走 `tw_bsr_daily (trade_date, stock_id)` 索引，只掃近 15 個交易日，不做全表掃描。
- 純函式抽到 `src/lib/bsrProgress.ts`：`progressPct`、`progressTone`（ok / lagging / stalled）、`circuitTone`、`quotaTone`、`formatTradeDate`、`zombieCount`，並附 vitest 單元測試（含 0 分母、母體缺漏、half-open、額度滿載等邊界）。
- 頁面 `src/pages/company/BsrProgress.tsx` + `App.tsx` 路由（`ProtectedRoute requiredRole="company_admin"`）+ `CompanyLayout` 選單項；資料層用 `useQuery` 搭 `refetchInterval: 3_600_000`、`refetchOnWindowFocus: true`。
- 唯讀：頁面不提供任何觸發同步或改設定的按鈕，避免誤觸消耗額度。
