## 現況盤點

流量統計其實已經做了大半，只差最後一步沒接起來：

- **資料表已建立並有資料**：`traffic_visits`（1 筆）、`traffic_events`（2 筆）正在累積中。
- **前端 tracker 已掛載**：`src/lib/trafficTracker.ts` 透過 `PerfMetricsTracker`（`App.tsx` L176 全域掛載）自動記錄 visitor / page view，送進 `traffic-ingest` edge function。
- **後台頁面已寫好**：`src/pages/company/Traffic.tsx`（294 行，含 KPI、來源、熱門頁、UTM 等）。
- **側欄入口已存在**：`CompanyLayout.tsx` L38 已經有「流量監控 /company/traffic」。
- **缺的就是路由**：`src/App.tsx` 只註冊了 `/company/perf-metrics`，沒註冊 `/company/traffic`，所以從側欄點進去會 404 — 看起來像「沒做」其實是。

## 這次只做一件事

1. 在 `src/App.tsx`：
   - 加 `const CompanyTraffic = lazy(() => import("./pages/company/Traffic"));`
   - 在 company 路由區塊加 `<Route path="/company/traffic" element={<ProtectedRoute requiredRole="company_admin"><CompanyTraffic /></ProtectedRoute>} />`

## 不動的部分

- 不改 `Traffic.tsx` 頁面內容、不改 tracker、不改 edge function、不改資料表。
- 不動其他可讀性／戰報榜 UI（延續你前一輪指示）。
- 不改任何文案、區塊順序、圖片。

打開後若資料呈現有要調的，再另外開一輪處理。
