# Shell Event Bus — TDD 事實來源

> **使用約定**
> 1. 每次動工前先 `code--view docs/architecture/shell-event-bus-tdd.md`。
> 2. 契約變動（新增事件、改 payload）**先改本 doc 再改 code**。
> 3. 每完成一個 TDD step，立刻更新第 7 章「執行日誌」的 checkbox 與測試輸出摘要。

關聯文件：[`docs/architecture/holdings-modules.md`](./holdings-modules.md)（深模組總覽，本 doc 落實其「跨模組互動契約」第 3 條）。

---

## 1. 背景與非目標

### 背景
深模組（M1 Holdings / M2 Closing / M3 Events / M4 TradeIO / M5 Research）已建立 barrel 邊界，但「M2 點事件跳到 M1 持倉並展開個股」這類主動跳轉仍需要一條合法路徑，否則模組間會被迫互相 deep import，深模組隔離就破功。

### 目標
- 新增 **Shell 層 event bus**，作為深模組之間唯一允許的「主動跳轉」通道。
- 本輪只上一個事件 `holdings:focus`，跑通 pub/sub → Shell listener → route navigate → `?expand=` 展開的完整鏈路。

### 非目標（另立 PR）
- 清理 legacy dead code（`AppShellFrame` / `AppPanels` / `PortfolioPanelsContext` / `useAppRuntime` 等）。
- 加 ESLint boundary rule 禁止模組間 deep import。
- 擴充其他事件（`events:refresh`、`closing:openStock` 等）。

---

## 2. 事件契約

| 事件名 | Payload | 發送方 (barrel helper) | Shell / 目標行為 |
| --- | --- | --- | --- |
| `holdings:focus` | `{ stockCode: string; source: 'closing' \| 'events' }` | M2 `useEmitHoldingsFocus` / M3 `useEmitHoldingsFocus` | Shell `useHoldingsFocusNavigation`：`navigate('/portfolio/:id/holdings?expand=<code>')` |
| `closing:openStock` | `{ stockCode: string; date?: string; source: 'holdings' }` | M1 `useEmitClosingOpenStock` | Shell `useClosingOpenStockNavigation`：`navigate('/portfolio/:id/daily?stock=<code>[&date=<YYYY-MM-DD>]')` |
| `research:prefill` | `{ stockCode: string; topic?: string; source: 'closing' \| 'events' }` | M2 / M3 `useEmitResearchPrefill` | Shell `useResearchPrefillNavigation`：`navigate('/portfolio/:id/research?stock=<code>[&topic=<topic>]')` |
| `events:refresh` | `{ reason: 'trade-import' \| 'trade-manual' \| 'ocr' \| string; source: 'tradeIO' }` | M4 `useEmitEventsRefresh` | M3 `useOnEventsRefresh(cb)` 訂閱後執行 re-fetch；不做 route 導航 |

### 型別放哪
`src/checkup/shell/eventBus.ts` 匯出 `ShellEvents` 型別；擴充事件時只改這裡與本表。



---

## 3. 檔案清單

### 新增
| 檔案 | 職責 |
| --- | --- |
| `src/checkup/shell/eventBus.ts` | 純 pub/sub，無 React 依賴。`createShellEventBus()`, `emit`, `on`, `off`。 |
| `src/checkup/shell/ShellEventBusProvider.tsx` | React Context 包 singleton bus + `useShellEventBus()` hook。 |
| `src/pages/ShellEventBusHarnessEntry.tsx` | dev/test 專用 harness，用來讓 E2E 觸發 emit。 |
| `src/test/unit/shell-event-bus.test.ts` | S1 契約測試。 |
| `src/test/unit/shell-event-bus-provider.test.tsx` | S3 Provider/hook 測試。 |
| `src/test/unit/shell-event-bus-module-boundary.test.ts` | S4 靜態掃描：M2/M3 barrel 不得 deep import M1。 |
| `e2e/shell-event-bus-navigation.spec.ts` | S5 端到端。 |

### 修改
| 檔案 | 動作 |
| --- | --- |
| `src/checkup/pages/PortfolioLayout.jsx` | 掛 `ShellEventBusProvider`，註冊 `holdings:focus` listener 呼叫 `navigate`。 |
| `src/checkup/hooks/useRouteHoldingsPage.js` | 從 `useSearchParams()` 讀 `expand`，下傳給 `HoldingsPanel`。 |
| `src/checkup/modules/closing/index.ts` | export `useEmitHoldingsFocus`（薄 wrapper）。 |
| `src/checkup/modules/events/index.ts` | 同上。 |
| `docs/architecture/holdings-modules.md` | TODO 區塊加 `→ 詳見 shell-event-bus-tdd.md`；完成後移入「已完成」。 |

---

## 4. TDD 五步節奏

每一步嚴格 **Red → Green → Refactor**；紅測試沒先跑失敗過不算數。

### S1 契約測試 — Red → S2 綠
**檔案**：`src/test/unit/shell-event-bus.test.ts`

案例：
- `emit` 後所有 `on` handler 被呼叫，payload 相等（深比對）。
- `off` 後不再收事件。
- 多次 emit 保序。
- handler 拋錯不影響其他 handler（try/catch 包）。
- unknown event type 由 TypeScript 型別阻擋（type-only 檢查）。

### S2 bus 實作 — Green
**檔案**：`src/checkup/shell/eventBus.ts`
- `Map<EventName, Set<Handler>>`。
- 匯出 `ShellEvents` 型別、`createShellEventBus()`、`ShellEventBus` 型別。

### S3 Provider + hook — Red → Green
**檔案**：`src/test/unit/shell-event-bus-provider.test.tsx`
- Provider 內 `useShellEventBus()` 拿到同一實例（多次 render 同 ref）。
- Provider 外呼叫拋錯（明確訊息）。
- listener 註冊在 Shell：測試用 `MemoryRouter` + `vi.spyOn` navigate，emit `holdings:focus` 後應 navigate 到 `/portfolio/:id/holdings?expand=2330`。

**實作**：`src/checkup/shell/ShellEventBusProvider.tsx` + 更新 `PortfolioLayout.jsx`。

### S4 M2/M3 barrel emit helper + 邊界靜態掃描 — Red → Green
**檔案**：`src/test/unit/shell-event-bus-module-boundary.test.ts`
- 用 `fs.readFileSync` 掃 `src/checkup/modules/closing/**` 與 `events/**`，斷言：
  - 沒有 `from '../holdings/'` 或 `from '../../components/holdings'` 的 import。
  - barrel 有 export `useEmitHoldingsFocus`。

**實作**：`useEmitHoldingsFocus` = `() => { const bus = useShellEventBus(); return (code, source) => bus.emit('holdings:focus', { stockCode: code, source }); }`。

### S5 E2E — Red → Green
**檔案**：`e2e/shell-event-bus-navigation.spec.ts`
- 進 harness route（`/__test__/shell-event-bus`），點按鈕觸發 emit `holdings:focus { stockCode: '2330', source: 'closing' }`。
- 斷言 URL 變為 `/portfolio/<demoId>/holdings?expand=2330`。
- 斷言持倉列 `data-stock="2330"` 具 `data-expanded="true"`。

**Harness**：`src/pages/ShellEventBusHarnessEntry.tsx`（僅在 dev/test build 掛載，掛在 `App.tsx` 用 `import.meta.env.DEV` 守衛）。

---

## 5. 跨模組互動契約檢查表

對應 `holdings-modules.md` 「只允許 3 條路」：

- [x] Route params / query string（`?expand=`）— 本 PR 使用。
- [x] 共用 store 唯讀 selector — 本 PR 不動。
- [ ] Shell event bus — **本 PR 落實**。

實作後把第 3 條 checkbox 打勾，並在 `holdings-modules.md` 對應段落加上「詳見 shell-event-bus-tdd.md」。

---

## 6. 驗收清單

- [x] `bunx vitest run src/test/unit/shell-event-bus.test.ts` 全綠。
- [x] `bunx vitest run src/test/unit/shell-event-bus-provider.test.tsx` 全綠。
- [x] `bunx vitest run src/test/unit/shell-event-bus-module-boundary.test.ts` 全綠。
- [x] `bunx playwright test e2e/shell-event-bus-navigation.spec.ts` 全綠。
- [x] `bunx playwright test e2e/portfolio-modules-smoke.spec.ts` 不退化。
- [x] `bunx playwright test e2e/module-cross-nav.spec.ts` 不退化。
- [x] `tsgo` 對新增檔案無 error。

---

## 7. 執行日誌

| Step | 狀態 | Commit / 測試摘要 |
| --- | --- | --- |
| S1 契約測試（red） | ✅ | `src/test/unit/shell-event-bus.test.ts`；vitest & tsgo 皆因 `@/checkup/shell/eventBus` 尚未存在而紅（預期）。7 個 case：emit 廣播、off、unsub 回傳、保序、handler 拋錯隔離、Set 去重、無 handler 安全。 |
| S2 bus 實作（green） | ✅ | `src/checkup/shell/eventBus.ts`：Map&lt;Event, Set&lt;Handler&gt;&gt;、`on` 回傳 unsubscribe、`emit` 快照迭代 + try/catch 隔離。vitest 7/7 綠。 |
| S3 Provider + Shell listener | ✅ | `src/checkup/shell/ShellEventBusProvider.tsx`（Provider / `useShellEventBus` / `useShellEventListener` / `useHoldingsFocusNavigation`）+ `src/checkup/pages/PortfolioLayout.jsx` 掛 Provider 並註冊 listener。`shell-event-bus-provider.test.tsx` 5/5 綠。 |
| S4 barrel emit + 邊界掃描 | ✅ | `src/checkup/modules/{closing,events}/useEmitHoldingsFocus.ts` + barrel re-export；`shell-event-bus-module-boundary.test.ts` 6/6 綠。 |
| S5 E2E harness | ✅ | `src/pages/ShellEventBusHarnessEntry.tsx` + `/portfolio/:portfolioId/__shell-bus` + `e2e/shell-event-bus-navigation.spec.ts` + playwright project。3/3 綠。 |
| 收工：驗收清單全綠 | ✅ | 2026-07-26 vitest 3 檔 18/18 綠；playwright 3 檔 11/11 綠；`tsc --noEmit` exit 0。 |
| 收工：更新 `holdings-modules.md` TODO | ✅ | `docs/architecture/holdings-modules.md` L38 標 ✅ 並註記本 doc。 |
| 收工：CI 綁定 | ✅ | 2026-07-26 三個 Playwright project 加進 `.github/workflows/ci-build-e2e.yml` matrix。 |
| S8-1 事件擴充：`closing:openStock` / `research:prefill` / `events:refresh` | ✅ | 2026-07-26 `eventBus.ts` `ShellEvents` 加 3 事件；`ShellEventBusProvider` 新增 `useClosingOpenStockNavigation` / `useResearchPrefillNavigation`；`PortfolioLayout` 掛上兩條 Shell nav listener。Barrel helper：M1 `useEmitClosingOpenStock`、M2/M3 `useEmitResearchPrefill`、M4 `useEmitEventsRefresh`、M3 訂閱 `useOnEventsRefresh`。新測試 `src/test/unit/shell-event-bus-events-v2.test.tsx` 11/11 綠（bus 契約 3、Shell nav 3、barrel helper 5），4 檔合計 29/29 綠。既有 shell-event-bus 測試無退化。 |
| S8-2 E2E harness + CI 綁定 | ✅ | 2026-07-26 新增 `e2e/shell-event-bus-nav-v2.spec.ts`（5/5 綠）：`closing:openStock` 含/不含 date、`research:prefill` 來自 M2/M3、`events:refresh` tick 0→1→2。新增 `playwright.config.ts` project `shell-event-bus-nav-v2`，並加入 `.github/workflows/ci-build-e2e.yml` Playwright matrix。 |



---

## 8. 後續 TODO（獨立 PR）

1. ~~事件擴充：`events:refresh` / `closing:openStock` / `research:prefill` + UI 串接 + E2E harness + CI~~ ✅ 2026-07-26 完成（見 §7 S8-1、S8-2）。
2. ~~Legacy dead code 清理~~ ✅ 2026-07-26 完成。
3. ~~ESLint boundary rule~~ ✅ 2026-07-26 完成。
