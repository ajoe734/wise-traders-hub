# ADR-0001：持倉看板切成五個深模組，跨模組只走三條路

- 狀態：Accepted
- 日期：2026-07-30

## 背景

持倉看板（Checkup）原本是單一巨型頁面，持倉、收盤分析、事件、交易匯入、研究工作台互相直接 import。
任何一處改動都可能在另一區塊爆炸，debug 需要跨十幾個檔案追狀態。

## 決策

切成 5 個 **深模組（Deep Module）**，每個模組的**介面就是它的 barrel**：

| 模組 | Barrel | 對外 hook |
| --- | --- | --- |
| M1 Holdings | `@/checkup/modules/holdings` | `useRouteHoldingsPage` |
| M2 Closing | `@/checkup/modules/closing` | `useRouteDailyPage` / `useRouteNewsPage` |
| M3 Events | `@/checkup/modules/events` | `useRouteEventsPage` |
| M4 TradeIO | `@/checkup/modules/tradeIO` | `useRouteTradePage` / `useRouteLogPage` |
| M5 Research | `@/checkup/modules/research` | `useRouteResearchPage` |

**跨模組互動只允許三條路**：URL params、唯讀 store selector、Shell Event Bus。
模組實作可以住在 `components/` `pages/` `hooks/`；**擁有權由 barrel 的 re-export 自動推導**，不維護第二份清單。

### 邊界規則（機制化，不靠自律）

| 規則 | 內容 |
| --- | --- |
| R1 | 模組 A 內的檔案不得 import 手足模組 B（barrel 或深路徑皆禁）。 |
| R2 | 模組外部只能 import barrel，不得深挖內部檔案。 |
| R3 | 每個模組必須有 barrel。 |
| R4 | 不得跨模組 import 對方擁有的元件／頁面／hook 實作檔。 |

三處強制執行，共用同一份判定 `scripts/moduleBoundaries.mjs`：

1. ESLint（`eslint.config.js` 的 `no-restricted-imports`）— 編輯器即時紅線
2. Vitest（`src/test/unit/module-boundary-guard.test.ts`）— 含合成違規反向測試，防守衛失效
3. CI（`npm run check:module-boundaries`）— 合併前硬擋

## 替代方案

- **靠 code review 自律**：已證實失效，五模組邊界一週內就被 M3→M4 的 emit helper 直接 import 打穿。
- **拆成獨立 npm workspace 套件**：邊界最硬，但 Vite 單頁應用要付出建置與 HMR 代價，收益不成比例。
- **只用 ESLint**：CI 沒跑 lint 時形同虛設，且無法驗證「守衛自己有沒有壞」。

## 後果

- 新增模組要同時更新 `eslint.config.js` 的 `CHECKUP_MODULES` 與 `scripts/moduleBoundaries.mjs`（測試會擋住不一致）。
- 需要跨模組資料時必須明確選一條路，寫起來比直接 import 麻煩——這是刻意的成本。
