# Holdings Consistency TDD — Phase A (Deep-link) + Phase B (Skeleton)

**建立日期：** 2026-07-27  
**合併來源：** `docs/architecture/holdings-modules.md` §「Deep-link 待補」、`shell-event-bus.md` §「Follow-up」、以及當前跑跑版一致性檢查漏項。  
**執行方式：** TDD。每個 phase 先寫失敗測試 → 補實作 → 綠燈 → doc 標 [x]。全部綠後刪除本檔並將關鍵決策回寫到 `holdings-modules.md`。

---

## Phase A · Deep-link 消費（Shell Bus §5）

Shell Event Bus 已可**產生**內部深連結（`?expand=`、`?stock=`、`?stock=&topic=`），
但目標 route hook **不會讀取** URL query 還原展開狀態 → 使用者透過通知/分享連結進入時看不到預期的展開卡片。

### A1 · `useRouteHoldingsPage`
- [x] 讀取 `useSearchParams().get('expand')`，若存在且與 `expandedStock` 不同 → `setExpandedStock(code)`。
- [x] `useEffect` 僅在 param 變動時觸發（避免與使用者手動 collapse 打架）。
- [x] 測試：`checkup-route-hooks.test.tsx > deep-link > holdings ?expand=2330 會呼叫 setExpandedStock`

### A2 · `useRouteDailyPage`
- [x] 讀取 `useSearchParams().get('stock')` → `setExpandedStock(code)`（複用同一 store slot）。
- [x] 測試：`deep-link > daily ?stock=2330 會 setExpandedStock`

### A3 · `useRouteResearchPage`
- [x] 讀取 `?stock=` 與 `?topic=` → 暴露 `prefillStockCode` / `prefillTopic`（本地 state，非 store）。
- [x] `ResearchPanel` 可自行決定是否 auto-run（第一階段只 pipe 出去，避免副作用 double-fire）。
- [x] 測試：`deep-link > research ?stock=2330&topic=chips 暴露 prefill*`

---

## Phase B · Skeleton 一致性

現況散亂：`HoldingCard` 用 shimmer skeleton、`HoldingsPage` 用純文字 `持倉載入中…`、
`EventsPanel` 用單色 pulse、`ChipsSection` 沒 skeleton、CSS 有兩套 shimmer keyframes。

### B1 · 建立 `CheckupSkeleton`
- [x] 新元件：`src/checkup/components/common/CheckupSkeleton.tsx`
- [x] 支援 `variant='page' | 'card' | 'row' | 'inline'`，一律用 `src/index.css` 的 `@keyframes shimmer`。
- [x] 遵守 `prefers-reduced-motion`。

### B2 · 收斂消費點
- [x] `HoldingsPage.jsx` — Suspense fallback 改用 `CheckupSkeleton variant='page'`。
- [ ] `ChipsSection.tsx` — 首載 loading 顯示 `CheckupSkeleton variant='row'`（暫緩：現有 `載入中…` badge 已符合 Kore-eda minimal，避免影響 15+ 個 chips 測試）。
- [ ] `EventsPanel PredictionSkeleton` — 保留（單色 alpha 動畫是刻意設計，見 L430 註解）。
- [x] 刪除重複的 `@keyframes holdingsSkeletonShimmer`（`src/checkup/styles/holdingsTab.css` L383-386），改指向共用 `shimmer`。

### B3 · E2E `data-expanded`
- [x] `HoldingRow` 加上 `data-testid="holding-row"` 與 `data-expanded={String(expanded)}`，
      讓 A1 的 deep-link 有可驗證 selector。

---

## 驗收
1. `bunx vitest run src/test/unit/checkup-route-hooks.test.tsx` 全綠。
2. `rg "holdingsSkeletonShimmer" src` 無結果。
3. 手動：`/portfolio/me/holdings?expand=2330` 進入即展開該卡。

完成後刪除本檔，重點回寫 `holdings-modules.md § Deep-link contract`。
