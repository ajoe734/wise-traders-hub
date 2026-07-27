# M3 events:refresh 真實 Re-fetch — TDD 事實來源

> **使用約定**
> 1. 每次動工前先 `code--view docs/architecture/events-refresh-tdd.md`。
> 2. 契約變動（新增 payload 欄位、改 slice source）**先改本 doc 再改 code**。
> 3. 每完成一個步驟，立刻更新第 5 章「執行日誌」的 checkbox 與測試輸出摘要。

前作：原始 Shell Event Bus TDD 文件已轉為維護模式文件 [`docs/architecture/shell-event-bus.md`](./shell-event-bus.md)（bus 已進維護模式）；本 doc 專責 §8 follow-up「events:refresh 真正 re-fetch」的收尾。

---

## 1. 背景與目標

### 背景
Shell Event Bus v2 上線後，`events:refresh` 由 M4 TradeIO emit，M3 EventsPage 只做 `refreshTick++` 與 analytics 記錄，**沒有實際重拉雲端事件**。使用者在 TradeIO 匯入或手動寫交易後，EventsPanel 顯示的仍是 hydration 當下的快取資料。

### 目標
- 讓 `events:refresh` 觸發時，實際 POST `/checkup-brain {action:'load-events'}` 並把回傳寫回 `EventStore.newsEvents`。
- 維持 `refreshTick` 語意：**tick 遞增 = refetch 已完成**（E2E 觀測點）。
- 保留 in-flight guard，避免連點造成併發請求。

### 非目標
- 不改事件 payload、不新增事件、不動 barrel 邊界。
- 不改 hydration 路徑（`usePortfolioBootstrap` 走 owner-portfolio TTL gating，仍照舊）。

---

## 2. 契約

| 面向 | 契約 |
| --- | --- |
| Event | `events:refresh` payload `{ reason, source }`（同 Shell Bus v2） |
| 資料來源 | `syncEngine.fetchCloudSlice('newsEvents')` → POST `/functions/v1/checkup-brain {action:'load-events'}` |
| Store 寫入 | `EventStore.setNewsEvents(normalizedPayload)`（由 `useRoutePortfolioRuntime.setNewsEvents` 正規化＋雙寫 localStorage） |
| Route context | `useRoutePortfolioRuntime` outletContext 新增 `reloadNewsEvents: () => Promise<Event[] \| null>` |
| Route hook | `useRouteEventsPage()` 回傳值新增 `reloadNewsEvents`（相同型別） |
| UI 呼叫點 | `EventsPage.handleRefresh` 先 `await reloadNewsEvents()`，再 `setRefreshTick(n+1)`，再 `track()` |
| 併發保護 | `useRoutePortfolioRuntime` 內 `reloadingNewsEventsRef` (useRef) 拒絕重入 |
| 失敗行為 | silent + `console.warn`；不 throw，讓上層 UI 不中斷 |

---

## 3. 測試策略（TDD 分層）

| Layer | 覆蓋點 | 檔案 |
| --- | --- | --- |
| L2 unit | `useRouteEventsPage` 契約：`reloadNewsEvents` 為 function、被叫時穿透到 context | `src/test/unit/checkup-route-hooks.test.tsx`（既有測試檔新增一 `it`） |
| L5 e2e | emit `events:refresh` → 觀察到 POST `load-events` 與 `data-events-refresh-tick` 遞增；連 emit 兩次都要記錄兩次網路呼叫 | `e2e/shell-event-bus-nav-v2.spec.ts`（既有 test 內強化 assertion） |

**保序驗證關鍵**：E2E 用 `page.route(...)` 攔截並累積 `load-events` 次數；於 tick attribute 遞增後才檢查次數，因為 `handleRefresh` 是 `await reloadNewsEvents()` → 再 bump tick，tick 上升等同 refetch 已 resolve。

---

## 4. 實作步驟

1. `useRoutePortfolioRuntime.js`
   - `import { syncEngine } from '../lib/syncEngine.js'`。
   - 加 `reloadingNewsEventsRef = useRef(false)` 與 `reloadNewsEvents = useCallback(async () => {...}, [setNewsEvents])`。
   - `outletContext` + deps 加入 `reloadNewsEvents`。

2. `useRouteEventsPage.js`
   - 從 `usePortfolioRouteContext()` 解構 `reloadNewsEvents`（預設 `async () => null`）。
   - 回傳物件與 `useMemo` deps 加入 `reloadNewsEvents`。

3. `EventsPage.jsx`
   - `handleRefresh` 改為 async：`await reloadNewsEvents(); setRefreshTick(n+1); track(...)`。
   - `useCallback` deps 加入 `reloadNewsEvents`。

4. 測試
   - Unit：`checkup-route-hooks.test.tsx` M3 段落新增 `it`。
   - E2E：`shell-event-bus-nav-v2.spec.ts` `events:refresh` case 內加 `page.route` 攔截與次數斷言。

5. 文件
   - 建立本 doc；原始 Shell Event Bus TDD 文件下架，改以維護模式文件 `docs/architecture/shell-event-bus.md` 承接原始契約與日誌。
   - `docs/architecture/holdings-modules.md` 的 `shell-event-bus-tdd.md` 引用改指本 doc。

---

## 5. 執行日誌

- [x] S1 · 抽 `reloadNewsEvents` 並注入 route context
- [x] S2 · `useRouteEventsPage` 暴露 callback
- [x] S3 · `EventsPage.handleRefresh` 串接 await
- [x] S4 · L2 unit 契約測試新增
- [x] S5 · L5 E2E 加 network intercept + 次數斷言
- [x] S6 · 原始 Shell Event Bus TDD 文件下架、轉為維護模式 `shell-event-bus.md`、`holdings-modules.md` 引用改指本 doc

測試複驗（本地）：
- [x] `bunx vitest run src/test/unit/checkup-route-hooks.test.tsx` — 綠燈 (8/8)
- [x] `bunx playwright test e2e/shell-event-bus-nav-v2.spec.ts` — 綠燈 (5/5)
- [x] `bunx vitest run` 完整 suite — 綠燈 (2047 passed / 7 skipped)

---

## 6. 完成標記

- ✅ 契約條列完成
- ✅ 實作步驟 S1–S6 全數落地
- ✅ 測試複驗（見 §5）

進維護模式後，新的事件或 slice 若需要類似 re-fetch 行為，複製本文件套版即可（把 slice 名、`syncEngine` cloud action、E2E 攔截 pattern 換掉）。
