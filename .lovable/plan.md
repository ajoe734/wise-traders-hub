# 持股健檢 Performance Audit — 每頁問題與修復計畫

## TL;DR
慢的根因有兩層：
- **A. `/free-checkup`** 是一支 **387KB / 7317 行的單檔 monolith**，首次載入要把整包 JS 下載+parse+mount，且內含 135 個 useState/useEffect/useMemo 全擠在同一棵 7000 行 JSX 上，任何 state 變動都重 render 全樹。
- **B. `/portfolio/:id/*` 子分頁系統**有共用的「runtime hook 大失效鏈」：每次小 setter 都觸發 `readPortfolioRuntimeSnapshot`（14 個 localStorage key 同步 JSON.parse + 14 個 normalize），並讓 `headerProps` / `outletContext` 兩個 30+ 依賴的 useMemo 重建，所有子頁 context consumer 一起重 render。

下面把每一頁的具體問題與修法列出（保持 inline 渲染慣例，不動 FreeCheckup 的元件結構）。

---

## A. `/free-checkup` 入口（主要兇手）

### A1. Bundle 太大、首屏阻塞
- 現況：`FreeCheckup.jsx = 387KB / 7317 行`，lazy split 後仍是一支巨型 chunk。
- 修法（**不動 inline 結構**，純拆 vendor + data + 動態載入）：
  1. **動態 import 重型相依**：`callEdge`、`preloadKnowledgeBase`、`mergeCalendarToNewsEvents`、`TargetPriceHistorySection`、`Md`、`CoachMarks`、`Sheet/Textarea` 改為 `await import()` 或 `lazy()`，只在實際使用時載入。
  2. **`DEMO_*` demo data**（`demoData.js`、`SEED_HOLDINGS` 等 12KB+）改為按需動態 import（只在 `isDemo` 進入時載入）。
  3. **`STOCK_META` / `IND_COLOR`**（seedData.js 1176 行）拆成獨立 chunk，並提供 lazy lookup wrapper。

### A2. 135 個 hook 集中在同一 component → 每次 setState 整樹 re-render
- 現況：FreeCheckup 是 inline monolith（依 memory rule 不可拆 component），但整顆 7000 行 JSX 每次都重建。
- 修法（**保留 inline，但用 React 機制隔離 reconciliation**）：
  1. 把每個 tab 的 inline JSX 包進 `useMemo(() => <>...</>, [該 tab 真正用到的 state])`，避免別的 tab 的 state 動就連帶重算。
  2. 高頻 input（搜尋、價格輸入）用 `useDeferredValue` / `startTransition` 把渲染降級為非同步。
  3. 對 list item（持股卡、事件卡、訊號卡）用 `React.memo` + 穩定 key；目前是 inline map 直出，每次都新建 props object。

### A3. Mount 時並發 IO 太多
- 偵測到 ~20 處 `supabase.*` 呼叫散落在 effect/handler 中：`getSession()` 多次、`checkup_storage.select`、`checkup_trade_memos.select`、`stock-price-sync` edge function、realtime channel subscribe…
- 修法：
  1. **合併 `getSession()` 呼叫**（目前至少 3 處），用一個 mount-time `useQuery(['session'])` 共用結果。
  2. **`checkup_storage` 多 key 改為單次 `.in('key', [...])` 批次撈**，不要每個 key 一次 round-trip。
  3. **realtime channel 延後到使用者真的有改動後再 subscribe**（lazy subscribe），而非 mount 即連線。
  4. **`stock-price-sync` 不在 mount 時觸發**，改為 idle (`requestIdleCallback`) 或進入需要報價的 tab 才呼叫。

---

## B. `/portfolio/:portfolioId/*` 共用層（影響 Holdings/Events/Daily/Research/Trade/Log/News 全部分頁）

### B1. `useRoutePortfolioRuntime` 的快照重算鏈
位置：`src/checkup/hooks/useRoutePortfolioRuntime.js:147-150`
```js
useEffect(() => {
  setPortfolios(readRuntimePortfolios())
  setRouteData(readPortfolioRuntimeSnapshot(routePortfolioId, { marketPriceCache }))
}, [routePortfolioId, marketPriceCache])
```
- 問題：`marketPriceCache` 是 state object，`reloadRuntime` 只要被呼叫就 `setMarketPriceCache(new object)` → identity 變 → effect 重跑 → **重讀 14 個 localStorage key + 14 個 normalize**。任何 setter（setHoldings、setWatchlist…）也會經由 `persistRouteField` → setRouteData 連動。
- 修法：
  1. 把 `marketPriceCache` 比較改成 deep-equal 或 `prices` map 的 reference 比較（`normalizeMarketPriceCache` 在內容相同時要回同一個 reference）。
  2. setter 走 functional update 直接 patch `routeData[field]`（已是這樣），但要**移除上面這條 useEffect 在 setter 後重讀整包的副作用**。

### B2. `readPortfolioRuntimeSnapshot` 同步 14× JSON.parse + normalize
位置：`src/checkup/lib/routeRuntime.js:61-106`
- 14 個 `readPortfolioField` 各自 `localStorage.getItem` + `JSON.parse` + 一個 normalize 函式（含 `normalizeHoldings` 會迭代每筆持股 + 套價）。
- 修法：
  1. 在模組層加一個 `Map<key, parsed>` LRU cache（key 用 `pfKey + storageVersion`），write 時 invalidate 該 key。
  2. `normalize*` 加 idempotent guard：input 已是正規化形狀就直接回傳同 reference（避免後續 useMemo 因為 reference 變動失效）。
  3. 大型欄位（`analysis-history-v1`、`research-history-v1`、`log-v2`）改為 lazy getter — 只在進入該分頁時才 parse。

### B3. `headerProps` / `outletContext` 兩個 useMemo 依賴爆炸
位置：`useRoutePortfolioRuntime.js:660-722, 724-830`
- `outletContext` 23+ 依賴含整個 `routeData`；`headerProps` 30+ 依賴含 `portfolioEditorState`、`portfolioDeleteState` 等 dialog state。
- 結果：開個 rename dialog → headerProps 重建 → Header 整棵 re-render；任何 setter → outletContext 重建 → 所有子頁透過 `useOutletContext()` 拿到新 reference → 全部子組件 re-render。
- 修法：
  1. 把 `outletContext` 拆成兩層 Context Provider：**`PortfolioDataContext`（routeData + setters，穩定）** + **`PortfolioActionsContext`（一次性 actions）**；不要塞進 useMemo 大物件。
  2. `headerProps` 把 dialog state 切到 Header 內部 `useState`，header 物件只傳穩定的 callbacks。

### B4. 各頁「每次 render 重掃 storage」
- `useRouteOverviewPage` (`useRouteOverviewPage.js:14`)：`useMemo([navigate])` — navigate 是穩定的，但 mount 時對「每個組合」跑 `readPortfolioRuntimeSnapshot`（M × 14 keys 同步 IO）。
  - 修法：用 `useQuery` + storage-event 失效；或 mount 時一次 batch 讀，後續用 in-memory cache。
- `useRouteResearchPage:42` — `dataRefreshRows = useMemo([fundamentals, holdings, targets])`：normalize 後 reference 不穩 → 幾乎每次都重算。要先解決 B2 的 reference 穩定性。

---

## C. 個別分頁的具體問題

### Holdings 分頁
- `HoldingsTable` (421 行) + `HoldingCard` (304 行)：每筆持股完整渲染，沒有 `React.memo`、沒有虛擬列表。>20 筆就會明顯卡。
- 修法：
  1. `HoldingCard` 包 `React.memo`，props 用穩定 callback（從 ref 取）。
  2. >50 筆時導入 `react-window` 的 `FixedSizeList`。
  3. `useRouteHoldingsPage` 內 `winners` / `losers` `[...holdings].sort` 每次都重建：依賴 `holdings` reference 穩定後即可省掉重排。

### Events 分頁
- `EventsPanel` 727 行單檔；`useRouteEventsPage` 的 `filteredEvents = newsEvents.filter(...)` 在 `newsEvents` reference 不穩時每次重算。
- 修法：B2 idempotent normalize 後即解；EventsPanel 內部 list 用 memo。

### Daily 分頁
- `DailyReportPanel` 911 行；`useRouteDailyPage` 中 `runDailyAnalysis` deps 含 `analysisHistory` → 任何歷史變動都重新建 callback；`expandedNews` 是 `Set` 但 `setExpandedNews` 沒做 functional update guard。
- 修法：callback 改用 ref 取最新 `analysisHistory`；DailyReportPanel 切成「summary + lazy history list」，history 用 `LazyOnVisible`。

### Research 分頁
- `useRouteResearchPage` 內 `dossierByCode = useMemo(new Map(...))` — `holdingDossiers` reference 不穩就重建 Map。
- `ResearchPanel` 530 行，内含多個 mutation 結果展開。
- 修法：B2 解掉 reference 抖動 + ResearchPanel 內 list `React.memo`。

### Trade 分頁（最大 1293 行）
- `TradePanel` 1293 行單檔，`useTradeCaptureRuntime` 維護完整下單表單狀態，目前每筆 keystroke 重 render 整 panel。
- 修法：
  1. 把表單欄位拆到 `useReducer` 並用 `useDeferredValue` 延遲輸入端 render。
  2. Panel 內 split：「歷史紀錄區塊」與「表單區塊」分別 memo。

### Log 分頁
- `LogPanel` 610 行；`useRouteLogPage` 只是透傳，問題在 outletContext 變動就連帶 re-render。
- 修法：靠 B3 拆 context 解決。

### News 分頁
- `NewsPanel` 397 行；`useRouteNewsPage` 用 inline `Set` 與 `createDefaultReviewForm()` 為 init state，每次 render 重建 default form object（雖然是 lazy init 沒事），但 `submitReview` deps 含 `reviewForm` 整個物件 → 表單輸入時 callback 每次新建。
- 修法：`submitReview` 改 ref 取 `reviewForm`。

### Overview 分頁
- 見 B4。最痛的是 mount 同步掃 M 個組合 × 14 keys。
- 修法：分批 + cache；或先回傳「組合清單」，每個組合的 totals 用獨立 `useQuery` 並 `Suspense` 漸進顯示。

---

## D. 執行順序（建議分批）

```text
Phase 1（最大效益，1 次）：
 ├─ B1：移除 reload-on-marketCache 副作用，穩定 marketPriceCache reference
 ├─ B2：normalize* idempotent + storage cache
 └─ B3：拆 outletContext / headerProps 為兩層 Context

Phase 2（針對熱頁面）：
 ├─ Holdings：React.memo + 虛擬列表
 ├─ Trade：表單 reducer + useDeferredValue
 └─ Daily/Research/News：callback ref 化、list memo

Phase 3（FreeCheckup）：
 ├─ A1：lazy 拆 demo data / 重型相依 / seedData
 ├─ A2：tab JSX useMemo 隔離 + list memo
 └─ A3：合併 getSession、批次讀 checkup_storage、延後 realtime/stock-price-sync
```

## E. 驗證方式
- `browser--performance_profile` 在 `/free-checkup` 與 `/portfolio/me/holdings` 各跑一次，比較 long task 數、JS heap、scriptDuration。
- React DevTools Profiler 量「切 tab」與「打字」commit 時間（目標：<16ms）。
- Network panel 量 `/free-checkup` 首次 chunk 大小（目標：主 chunk <200KB gzip）。
- 大量假資料壓測：100 筆持股、500 筆 trade log，FCP / INP 不退化。

## F. 不做的事
- 不違反「FreeCheckup inline 渲染」memory rule，不抽元件。
- 不改商業邏輯（買賣計算、訂閱判斷）。
- 不動既有 RWD 斷點（手機回歸清單仍適用）。
