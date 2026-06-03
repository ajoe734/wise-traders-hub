## 你說的對

`/company/traffic` 目前 8 個 tab 幾乎都是純表格，連最基本的「每日趨勢線」「Channel 佔比圓餅」「漏斗瀑布圖」都沒有。GA4、Plausible、Fathom、Mixpanel、PostHog 沒人這樣做後台。專案內已經安裝 `recharts`（`PerfMetricsChart.tsx`、`RevenueCharts.tsx` 都在用），純粹是這頁沒畫而已。

## 要加什麼（對齊業界做法）

### 1. KPI 卡加 sparkline + 增減％
8 張 KPI 卡每張右下角嵌一條 30 天 `<Sparkline>`（recharts `<Line>` 無軸），並顯示「vs 前一週期 ±x%」。GA4、Vercel Analytics、Plausible 都這樣做。

### 2. 總覽 tab：每日趨勢圖（取代純表格）
- 主圖：`ComposedChart`，左軸訪客/PV（bar），右軸訂單/毛收（line）。
- 下方保留小型 daily table（可摺疊）作為精確查表用。
- 顆粒度切換：日 / 週（用 `range` 計算 bucket）。

### 3. 漏斗 tab：瀑布漏斗圖
- 用 recharts `BarChart` + `layout="vertical"` 畫真正的漏斗（每階長度按人數，標示 conversion% 與 drop%）。
- 4 個漏斗排成 2×2 grid，視窗一眼看完。

### 4. 流量來源 tab：Channel donut + Referrer 橫條圖
- `PieChart`（donut）顯示 Channel 訪客佔比。
- Top Referrers / Landings 改 horizontal `BarChart`（前 10 名 + 其他摺疊）。

### 5. 功能熱度 tab：Top 15 事件 horizontal bar
表格保留作為完整清單，上方加一張 Top 15 `BarChart`（unique_visitors 排序）。

### 6. 產品線 tab：堆疊長條
修煉派 / 跟單派 / 學習中心 三條 stacked bar（事件 / UV / 登入會員）。

### 7. 廣告營收 tab：ROAS scatter
`ScatterChart`：X = spend、Y = gross、bubble 大小 = orders，hover 顯示 campaign。一眼看出哪個 campaign 投產比最高。

## 技術細節

- 全部用既有 `recharts`（不裝新套件），沿用 `PerfMetricsChart.tsx` 的 `ResponsiveContainer` + `hsl(var(--primary))` 寫法，符合設計系統。
- 新增 `src/pages/_companyTraffic/` 目錄，把每張圖切成獨立元件（`DailyTrendChart`、`FunnelWaterfall`、`ChannelDonut`、`EventsTopBar`、`SparklineKpi`、`RoasScatter`），`Traffic.tsx` 只負責資料與排版，控制在 300 行以內。
- KPI 「vs 前期」用同一支 `get_traffic_overview` RPC 多打一次（傳前一週期區間）來算，不改後端。
- Sparkline 資料來自既有 `data.daily`，無需新 RPC。
- 色票：訪客 `--primary`、營收 `--mentor`（已是 trading-up 色）、訂單 `--accent`、drop 用 `--muted-foreground`，遵守 Taiwan 紅漲綠跌憲法（這頁沒有漲跌語意所以用品牌色即可）。

## 不做

- 不動 RPC / 後端 / migration（資料已經夠畫）。
- 不動首頁、pricing、持股看板、收盤分析。
- 不加新 tab、不加新指標、不加 export。

## 風險

- recharts bundle 已被 `RevenueCharts` 載入，這頁多用幾張圖不會額外增加首屏 bundle（這頁本來就在 `/company` lazy chunk）。
- 多打一次 `get_traffic_overview` 算「前期對比」會讓首次載入多 1 個 RPC，但 React Query 會 cache。

要我直接動工嗎？如果想先砍範圍（例如「只加總覽趨勢圖 + 漏斗瀑布」），跟我說。
