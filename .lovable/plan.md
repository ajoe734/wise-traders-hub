# 持倉看板深模組拆分規劃

目標：把「持倉／收盤分析／事件／紀錄」四大功能拆成邊界清楚的深模組，讓 debug 時能定位到單一模組、跨模組互動走明確契約，避免現在 `PortfolioPanelsContext` 一包 8 個 domain props 的耦合。

## 拆分結果：5 個深模組 + 1 個協調層

```text
┌─────────────────────────────────────────────────────────┐
│  M0 Shell（協調層：路由、Header、跨模組事件匯流排）      │
├──────────┬──────────┬──────────┬──────────┬────────────┤
│ M1       │ M2       │ M3       │ M4       │ M5         │
│ Holdings │ Closing  │ Events   │ Trade    │ Research   │
│ 持倉     │ 收盤分析 │ 行事曆   │ 上傳+日誌│ 深度研究   │
│          │ +事件分析│          │          │            │
└──────────┴──────────┴──────────┴──────────┴────────────┘
        ↓ 共用底層 ↓
┌─────────────────────────────────────────────────────────┐
│  Core: stores (holdings/market/reports/brain) · lib     │
│  · edge functions · sync workers                         │
└─────────────────────────────────────────────────────────┘
```

## 每個模組的職責與邊界

### M1 Holdings（持倉）
- **UI 範圍**：`HoldingsPanel`、`HoldingsTable`、`HoldingsDetailPanel`、`ChipsSection`、`HoldingsHero`
- **狀態**：`holdingsStore` + `marketStore`（現價、籌碼）
- **對外契約**：`useRouteHoldingsPage()` → `{ panelProps, tableProps }`（已存在，作為邊界）
- **debug 入口**：`/app/holdings`、`useHoldingsBundle`、`tw_chip_fact`、`price_admit`

### M2 Closing Analysis（收盤分析 + 事件分析合併）
- 這兩個 tab 共用 `dailyReport` / `newsEvents` / `strategyBrain`，本來就是同一個「AI 收盤解讀」領域，硬拆反而讓 `reportsStore` 兩邊被讀
- **UI 範圍**：`DailyReportPanel`、`NewsAnalysisPanel`、`StrategyBrainSection`
- **狀態**：`reportsStore`
- **對外契約**：`useClosingAnalysis()` → `{ daily, news, stress }`

### M3 Events（行事曆）
- **UI 範圍**：`EventsPanel`、`RelayPlanCard`、`EventsFilter`
- **狀態**：`eventStore` + 從 M1 borrow `holdings`（唯讀）
- **對外契約**：`useEventsFeed()` → `{ filteredEvents, relayPlan, urgentCount }`
- 對外只吐 `urgentCount` 給 Header tab badge

### M4 Trade Capture + Log（上傳成交 + 交易日誌）
- OCR 上傳的最終產物就是 `tradeLog`，兩者強耦合，合成一個模組
- **UI 範圍**：`TradePanel`、`LogPanel`
- **狀態**：`useTradeCapture()` hook（現存）+ `tradeLog` selector
- **對外契約**：`useTradeIO()` → `{ capture, log }`

### M5 Research（深度研究）
- **UI 範圍**：`ResearchPanel`
- **狀態**：`researchResults` / `researchHistory` / `analystReports`
- **對外契約**：`useResearchWorkbench()`

### M0 Shell（協調層）
- `PortfolioLayout` + `Header` + 路由 + tab badge 匯總
- **不再持有 domain state**：拆掉 `PortfolioPanelsContext` 一包 8 domain 的巨型 context，改成每個模組自己的 hook（M1~M5 的 `useRoute*Page`）
- Shell 只做：路由切換、Header props（含各模組吐出的 badge count）、跨模組跳轉（例如「事件分析」點卡片跳到「持倉」展開該檔）

## 跨模組互動契約（避免耦合擴散）

只允許 3 種跨模組互動，其他一律禁止：

1. **URL / route params**：跳 tab、展開特定 stock code → 走 `?expand=2330`，不共用 in-memory state
2. **共用 store 唯讀 selector**：M3 需要 holdings → `useHoldingsSnapshot()`（唯讀），不能拿 setter
3. **Shell-level event bus**：M2 「點事件跳持倉」→ `shellBus.emit('focus-holding', code)`，M1 訂閱

## 重構落地順序（每步可獨立驗證）

1. **Step 1**：拆 `PortfolioPanelsContext` → 5 個模組各自的 `useRoute*Page` hook（M1 已完成，作為範本）
2. **Step 2**：把 `AppPanels.jsx` 的 `panelRegistry` 改成 lazy import 5 個模組 barrel
3. **Step 3**：每個模組加 `__tests__/contract.test.ts` 鎖住對外 hook 的返回形狀
4. **Step 4**：Shell 新增 `shellBus`，把現有 `setTab` / `setExpandedStock` 跨模組呼叫改走 bus
5. **Step 5**：`docs/architecture/holdings-modules.md` 記錄 5 模組邊界與契約，CI 加 lint 規則禁止 M1 直接 import M3 內部檔案

## Debug 效益

- 出 bug → 先定位到哪個模組（看路由或 tab）→ 只讀該模組的 hook + store + edge function
- 跨模組互動只有 3 條路，容易追（bus event log / URL params / selector）
- 每個模組獨立 lazy chunk，效能問題也能按模組看 bundle 分析

## 技術細節

- `AppPanels.jsx` 目前 89 行、`usePortfolioPanelsContextComposer.js` 350 行 90+ props：這兩個是拆分的核心目標，拆完後 Composer 應該消失
- 現有 `useRouteHoldingsPage.js` 已經是 M1 標竿，其他 4 個模組照抄結構
- `holdings-page.test.tsx` 已示範 contract test 寫法，其他模組沿用
- 不動 store 檔案結構（`holdingsStore` / `marketStore` / `reportsStore` / `eventStore` 已經按 domain 分好），只動 UI 層與 context 層
