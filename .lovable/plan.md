# M3 events:refresh 真實 re-fetch（Shell Bus §8 Follow-up）

## 目標
把 `events:refresh` 從「僅 bump tick + analytics」升級為「真正重新拉雲端事件並寫回 store」，讓 M4 TradeIO 寫入後 M3 Events 顯示的資料是最新的。

## 文件策略（TDD 模式）
- 新增：`docs/architecture/events-refresh-tdd.md`（本次 follow-up 專屬 TDD 文件，含 §1 需求 / §2 契約 / §3 測試策略 / §4 實作步驟 / §5 執行日誌 / §6 完成標記）。
- 刪除：舊 `docs/architecture/shell-event-bus-tdd.md`（原始 bus TDD 已完成、進維護模式），改由 index 或 README 指向新 doc。
- 新 doc 完成合併後才刪舊 doc，避免 CI docs link 檢查斷鏈。

## 現況（已讀檔確認）
- `usePortfolioBootstrap.js` L155-197：初次 hydration 才呼叫 `POST /brain {action:'load-events'}`，之後不會重跑；`setNewsEvents` 是 EventStore 的 setter。
- `useRouteEventsPage.js`：目前只從 `usePortfolioRouteContext()` 取 `newsEvents`，未回傳任何 reload。
- `EventsPage.jsx` L13-18：`handleRefresh` 只 `setRefreshTick(n+1)` 與 analytics，未觸發網路重抓。
- `usePortfolioRouteContext.js`：純 `useOutletContext()`，代表 reload callback 需由 `PortfolioLayout` 注入 context。

## 實作步驟

1. **抽 `reloadNewsEvents` callback**
   - 在 `usePortfolioBootstrap.js` 把「load-events fetch + normalize + setNewsEvents + savePortfolioData」封成獨立函式，供初次 hydration 與 refresh 共用。
   - 從 hook 回傳 `reloadNewsEvents(pid?)`；預設用當前 `activePortfolioId`。
   - 加 in-flight guard（`useRef`）避免併發重複請求；失敗 silent + `console.warn`（維持與現行 offline fallback 一致）。

2. **透過 Layout 注入 route context**
   - `PortfolioLayout.jsx` 的 `<Outlet context={...}>` 加入 `reloadNewsEvents`。
   - `useRouteEventsPage.js` 從 context 取出並回傳。

3. **EventsPage 串接**
   - `handleRefresh` 改為 `async (payload) => { await reloadNewsEvents(); setRefreshTick(n+1); track(...) }`。
   - tick 仍在 refetch 完成後 bump，維持 E2E 觀測點語意（tick 增加 = refetch 已完成）。

4. **測試（TDD 先行）**
   - **Unit**：`useRouteEventsPage` 契約測試 → 斷言回傳含 `reloadNewsEvents: Function`。
   - **Unit**：mock fetch，emit `events:refresh` 後 `setNewsEvents` 被以最新 payload 呼叫一次。
   - **E2E**：擴充 `e2e/shell-event-bus-nav-v2.spec.ts` 的 `events:refresh` 案例 → 透過 route intercept 斷言 `POST /brain {action:'load-events'}` 在 emit 後真的被呼叫，且 tick 也 +1。

5. **文件與清理**
   - 寫 `events-refresh-tdd.md`（含上述 §1-§6，執行日誌記 unit + e2e 綠燈次數）。
   - 更新 memory index / 其他引用點指向新 doc。
   - 刪除 `docs/architecture/shell-event-bus-tdd.md`。
   - `rg` 確認無 dead link。

## 驗收
- `bunx vitest run` 相關 unit 全綠。
- `bunx playwright test e2e/shell-event-bus-nav-v2.spec.ts` 全綠，且新 assertion 覆蓋 network call。
- 手動：在 `?bus_test=1` beacon 觸發 emit → Network 面板可見 `load-events` 請求 → EventsPanel 顯示雲端最新資料。
- `rg "shell-event-bus-tdd"` 無殘留引用。
