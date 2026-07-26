# 持倉看板 — 深模組架構（Holdings Deep Modules）

> 目的：讓 debug 時能一眼定位到單一模組、跨模組互動走明確契約。
> 對應計畫檔：`.lovable/plan.md`（2026-07-26 批准）。

## 模組地圖

```text
┌──────────────────────────────────────────────────────────────┐
│  M0 Shell (協調層)                                            │
│  · src/checkup/pages/PortfolioLayout.jsx                     │
│  · src/checkup/components/Header.jsx                         │
│  · usePortfolioRouteContext (Outlet context)                 │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ M1       │ M2       │ M3       │ M4       │ M5              │
│ Holdings │ Closing  │ Events   │ TradeIO  │ Research        │
│ 持倉     │ 收盤+事件│ 行事曆   │ 上傳+日誌│ 深度研究        │
└──────────┴──────────┴──────────┴──────────┴─────────────────┘
                       ↓ 共用底層 ↓
     stores (holdings / market / reports / brain / event)
     lib   · edge functions · sync workers
```

## 每個模組的邊界

| 模組       | Barrel                          | 對外 hook                                       | Route                                   | 主 store             |
| ---------- | ------------------------------- | ---------------------------------------------- | --------------------------------------- | -------------------- |
| M1 Holdings| `src/checkup/modules/holdings`  | `useRouteHoldingsPage`                         | `/portfolio/:id/holdings`               | `holdingsStore` + `marketStore` |
| M2 Closing | `src/checkup/modules/closing`   | `useRouteDailyPage` + `useRouteNewsPage`       | `/portfolio/:id/daily` + `/news`        | `reportsStore`       |
| M3 Events  | `src/checkup/modules/events`    | `useRouteEventsPage`                           | `/portfolio/:id/events`                 | `eventStore`         |
| M4 TradeIO | `src/checkup/modules/tradeIO`   | `useRouteTradePage` + `useRouteLogPage`        | `/portfolio/:id/trade` + `/log`         | `holdingsStore` (tradeLog) |
| M5 Research| `src/checkup/modules/research`  | `useRouteResearchPage`                         | `/portfolio/:id/research`               | `reportsStore` (researchHistory) |

## 跨模組互動契約（只允許這 3 條路）

1. **URL / route params** — 跳 tab 或展開特定 stock code 走 query string (`?expand=2330`)，禁止 cross-module in-memory state。
2. **共用 store 唯讀 selector** — 例：M3 需要 holdings 走 `useHoldingsStore(s => s.holdings)`，只讀，不能改 setter。
3. **Shell event bus**（TODO）— M2 「點事件跳持倉」等主動跳轉，由 Shell 層轉發，不由模組互相 import。

其他一律禁止：模組 A 不得 `import` 模組 B 的內部檔案（只能透過 barrel 對外 API）。

## 現行 Runtime 路徑

實際跑的是 **route pages 路徑**，由 `src/App.tsx` L308-319 掛載：

```
/portfolio/:portfolioId  →  PortfolioLayout
                              ├─ HoldingsPage   (M1)
                              ├─ DailyPage      (M2)
                              ├─ NewsPage       (M2)
                              ├─ EventsPage     (M3)
                              ├─ TradePage      (M4)
                              ├─ LogPage        (M4)
                              └─ ResearchPage   (M5)
```

每個 Page 只做一件事：呼叫對應的 `useRoute*Page()` hook 拿到 props，交給對應 Panel 渲染。

## 已識別的 Legacy Dead Code（follow-up 清理）

下列檔案在 runtime 路由中**未被引用**（只有 `useAppRuntime` 的 unit test 還會 render），已在檔頭加 `@deprecated` banner。清理是獨立 PR：

- `src/checkup/components/AppShellFrame.jsx`
- `src/checkup/components/AppPanels.jsx`
- `src/checkup/contexts/PortfolioPanelsContext.jsx`
- `src/checkup/hooks/usePortfolioPanelsContextComposer.js`
- `src/checkup/hooks/useAppRuntime.js`（僅剩測試用）
- `src/checkup/hooks/useAppRuntimeComposer.js` 中 `composeAppShellFrameRuntime` export

清理範圍：刪除以上 + 移除 `hooks/index.js` 中對應 re-export + 移除 `src/test/unit/checkup-store-backed-hooks.test.tsx` 中 `describe('useAppRuntime')` block。

## Debug 起手式

1. **從 URL 定位模組**：看當前路由屬於哪個 M1-M5。
2. **只讀該模組 barrel**：`import { ... } from '@/checkup/modules/<name>'`。
3. **循 hook 進 store**：hook 內只讀 store selector 與 usePortfolioRouteContext。
4. **循 store 進 edge function / worker**：例如籌碼 → `tw_chip_fact` + `tw-chips-detail`；價格 → `price_admit` + `upsert_current_price`。

## TODO（本次未做，另立 PR）

- Shell event bus 實作 + M2→M1 跳轉改走 bus。
- ESLint boundary rule 禁止 M1 ↔ M3 內部檔案互 import。
- 清理 legacy dead code（見上）。
