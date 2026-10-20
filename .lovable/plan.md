# 頁面排行點擊 → 個別頁面每日折線圖

## 使用者看到什麼
- 「Top 15 頁面（依 UV）」每一條長條（含路徑文字）可點擊，游標變手指。
- 點下後右側抽屜（手機為底部）打開：標題是路徑，上方三個數字（期間瀏覽、不重複訪客、登入訪客），下方每日折線圖，兩條線：瀏覽數、不重複訪客；可切換是否顯示登入訪客線。
- 期間跟著看板上方的期間選擇（今日／7 天／30 天…）；沒資料的日子補 0，不跳日。
- 抽屜底下附「與總覽對帳」小字：期間合計＝排行長條的數字，不一致時顯示警示（不藏）。
- 下方表格同一列也可點擊打開同一抽屜。

## 做法
1. 新增後台專用查詢「單一頁面每日趨勢」：輸入路徑＋期間＋是否含內部流量，回傳台北日 × 瀏覽／訪客／登入訪客。口徑沿用現有頁面排行（只算具名看頁、台北日界、半開區間、company_admin 限定），並帶已調好的執行預算與索引，避免高流量日逾時。
2. 前台：長條圖加點擊事件，抽屜 lazy 載入，折線用既有圖表元件風格（台灣色規、日期 YYYY/MM/DD）。
3. 補零與對帳邏輯放在 `trafficQuality` 的純函式，前端不自刻計算。

## 測試（直到全綠才算完成）
- TDD 純函式（Vitest）：補零日期連續、台北日界跨日、期間合計＝排行數字、不一致時回報差異、空資料。
- 實際 SQL（PGlite，加入 `check:traffic`）：命名／匿名／內部頁、日界、半開區間、非管理員被擋、每日加總＝`get_page_analytics` 同路徑數字，逐一路徑跑全部測試路徑。
- 正式資料唯讀對帳：以本人管理員，對 30 天 Top 15 全部 15 條路徑逐一呼叫，確認每條日加總＝排行數字，且無逾時；再挑最高流量日 2026/08/16 所在期間驗效能。
- 瀏覽器（Playwright，管理員登入）：點每一條長條（15 條全點）都開抽屜且顯示折線；切換期間後重抓；1280 與 390 寬截圖檢查；表格列點擊也能開。
- 跑 `bun run check:traffic` 與全套 `test:run`。
- 不發布正式站，等你確認後再發。

## 技術細節
- 新 migration：`get_page_daily_trend(_path text, _from timestamptz, _to timestamptz, _include_internal bool)`，SECURITY DEFINER、company_admin guard、`statement_timeout` 與 0057 一致，使用 0049 索引。
- 檔案：`src/pages/company/Traffic.tsx`（點擊）、`src/pages/_companyTraffic/PageTrendDrawer.tsx`（新）、`Charts.tsx` HorizontalBar 加 `onBarClick`、`src/lib/analytics/trafficQuality.ts`（`fillDailySeries`、`reconcilePageTotal`）、`scripts/test-traffic-overview.mjs` 加斷言。
