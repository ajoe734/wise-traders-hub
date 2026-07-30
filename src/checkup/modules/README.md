# Checkup 深模組（Deep Modules）

持倉看板拆成 5 個對外邊界明確的深模組 + Shell 協調層。
詳見 [docs/architecture/holdings-modules.md](../../../docs/architecture/holdings-modules.md)。

| 模組       | Barrel                     | 對外 hook                   | Route Page                       |
| ---------- | -------------------------- | --------------------------- | -------------------------------- |
| M1 Holdings| `modules/holdings`         | `useRouteHoldingsPage`      | `pages/HoldingsPage.jsx`         |
| M2 Closing | `modules/closing`          | `useRouteDailyPage` + `useRouteNewsPage` | `pages/{DailyPage,NewsPage}.jsx` |
| M3 Events  | `modules/events`           | `useRouteEventsPage`        | `pages/EventsPage.jsx`           |
| M4 TradeIO | `modules/tradeIO`          | `useRouteTradePage` + `useRouteLogPage`  | `pages/{TradePage,LogPage}.jsx`  |
| M5 Research| `modules/research`         | `useRouteResearchPage`      | `pages/ResearchPage.jsx`         |

**跨模組互動只允許 3 條路：** URL params / 唯讀 store selector / shell event bus。

**Debug 起手式：** 從路由定位模組 → 讀該模組 barrel 的 hook / 元件 → 再進 store / edge function。

## 邊界是機制，不是自律（ADR-0001）

| 層 | 指令 | 何時擋 |
| --- | --- | --- |
| ESLint | `npm run lint:modules` | 編輯器／CI |
| Vitest | `src/test/unit/module-boundary-guard.test.ts` | 測試（含合成違規反向測試） |
| CI script | `npm run check:module-boundaries` | 合併前硬擋 |

判定邏輯單一來源：`scripts/moduleBoundaries.mjs`（R1 手足 / R2 barrel-only / R3 barrel 存在 / R4 實作檔跨界）。
模組「擁有哪些檔」由 barrel 的 re-export 自動推導，不維護第二份清單。
新增模組：更新 `eslint.config.js` 的 `CHECKUP_MODULES` 與 `scripts/moduleBoundaries.mjs` 的 `CHECKUP_MODULES`。
