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
