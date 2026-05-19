# 持股看板（Holdings）全面盤點報告

範圍：`/free-checkup` 路由「持倉」分頁 + `/checkup` 路由 `HoldingsPage` + `app/Holdings.tsx` + 共用元件目錄。本盤點**只盤點不動工**，等你決定優先順序後再執行。

---

## 1. 現況地圖

### 1.1 三套並存的「持股看板」

| 路徑 | 入口檔 | 渲染策略 | 行數 | 狀態 |
|---|---|---|---|---|
| `/free-checkup` | `src/pages/FreeCheckup.jsx`（lazy → `HoldingsTab.jsx`）| **Inline JSX + 12 個子元件** | Tab 428 行 + Card 385 行 + Panel 559 行 + DetailPanel 236 行 + Hero 178 行 + Filter 177 行 + 其它 645 行 = **約 2,608 行** | 主力，憲法在此 |
| `/checkup`（會員）| `src/checkup/pages/HoldingsPage.jsx`（38 行）| `HoldingsPanel` + `HoldingsTable` | 1,005 行 | 走 Store 模式 |
| `/app/holdings` | `src/pages/app/Holdings.tsx` | 卡片列出訂閱方案 | 88 行 | 與其他兩套**完全無關**（只是同名）|

### 1.2 `src/checkup/components/holdings/` 樣板層（README 已聲明「樣板，不准 import 至 /free-checkup」）

- 實際被 `HoldingsPage.jsx` + `AppPanels.jsx` 引用：`HoldingsPanel.jsx`(559)、`HoldingsTable.jsx`(446)、`holdingsTokens.js`(123)、`index.js`
- 樣板且**僅被 `index.js` re-export，無實際路由使用**：`HoldingsWorkbench.jsx`(247)、`HoldingHero.jsx`(119)、`HoldingCard.jsx`(304)、`HoldingDetailPanel.jsx`(422)、`PriorityStrip.jsx`(160) = **1,252 行死碼風險**

### 1.3 `src/checkup/components/freecheckup/` 已抽出的 12 個子元件
`HoldingsTab` / `HoldingCard` / `HoldingsHero` / `HoldingsActionPriority` / `HoldingsQuotaMeter` / `HoldingsFilterBar` / `HoldingsReversalSection` / `HoldingsUploadSummary` / `HoldingsEmptyState` / `HoldingsNoMatchState` / `HoldingsFooterBar` / `HoldingsDetailPanel`（lazy）

---

## 2. 效能盤點

### 2.1 已落實的優化（保留）
- ✅ `HoldingsTab` 整段 `React.lazy`（FreeCheckup.jsx L25 註解）
- ✅ `HoldingCard` `memo` + `useInView({ rootMargin: '400px 0px' })`，離視窗延後渲染
- ✅ `HoldingsDetailPanel` `lazy`，未選中時不下載
- ✅ `decisionsMap` 以 `holdingsCodesKey` 字串為 deps（避免 array reference 抖動）
- ✅ `useDeferredValue(searchQ)` 緩衝關鍵字輸入
- ✅ `assignCardVariants` / `orderedDisplayed` 已 `useMemo`
- ✅ `sparklines` 只補抓缺少代碼

### 2.2 效能缺口（依影響由大到小）

**P0 — `compareByPriority` 在排序時重新建立**
- `useCallback` 依賴 `priorityOf` + `decisionsMap`；每次 quote tick → `H` 變動 → `globalSortedList` / `filteredSortedList` 雙雙重排（O(n log n)）
- 建議：把優先度寫進 `decisionsMap`（已有 `actionType`/`urgency`/`thesisState`），sort 階段只讀數字

**P1 — `filteredSortedList` deps 含 `normalizedEvents`（984 行報導陣列）**
- L1377 deps：`normalizedEvents` 並不在 sort/filter 主路徑使用（只透過 `getUpdatedAt` 在 `sortBy==='updated'` 才用到）
- 建議：把 `getUpdatedAt` 預算入 `decisionsMap[code].lastTouchedAt`，從 deps 移除 `normalizedEvents`

**P2 — `H` 陣列 reference 每次報價刷新都變**
- 推導：`mergeTradeIntoHoldings` / `applyMarketQuotesToHoldings` 即使值未變也 spread 新陣列 → 下游 9 個 `useMemo` 全部失效
- 建議：以 `useMemo` + `holdingsValueKey`（code|price|qty 串接）為 deps，價格未變時回傳同一 reference

**P3 — `HoldingCard` 即使 memo 仍受 `sparkData={sparklines[h.code] || EMPTY_SPARK}` 拖累**
- `sparklines[h.code]` 每次 `sparklines` setState 整體 reference 變、但同一 code 的陣列其實可穩定；`EMPTY_SPARK` 若非 module-level 常數會破 memo
- 待驗證：搜尋 `EMPTY_SPARK` 宣告位置（若在 component body 內 → 強制 hoist 到模組層）

**P4 — `HoldingsHero` 顯示 KPI 卻接收完整 `H`+`winners`+`exitList`+`reviewList`**
- 父層每次 quote tick 都重算這 4 個陣列；Hero 只需 length
- 建議：把 4 個 length 預先在 parent 算成基本型，Hero 改吃 number

**P5 — `HoldingsActionPriority` 接收 `decisionsMap` 全表 + `STOCK_META` 全表**
- 只用 `globalPriorityList`（前 3 筆）的 code → 解構即可
- 建議：parent 先 build 3 筆完整 priorityItems 物件再傳

**P6 — `holdings-workbench` grid 切換時 reflow 全部卡片**
- 選中 → grid 由 `1fr` 改 `1fr 420px` → 整片卡片重排
- 建議：detail panel 用 `position:fixed` overlay 或 `transform` 動畫（不動 grid 結構）

**P7 — `cardGridCols` 來源不明，每次 parent re-render 都會傳新字串**
- 待驗證：在 FreeCheckup.jsx 搜尋 `cardGridCols` 計算位置

**P8 — `HoldingsPage.jsx`（會員版）每次 store push 都重建 `winners/losers`**
- `useRouteHoldingsPage` 已 useMemo，但 `holdings` reference 來自 zustand → 同 P2

### 2.3 Bundle 機會
- `holdings/` 樣板層 1,252 行死碼可移除（或加 `/* @vite-ignore */` 並從 `index.js` 拿掉 re-export）
- `holdingsTab.css` 是否該 lazy-loaded 隨 HoldingsTab 走（目前 `import "..."` top-level）

---

## 3. 可維護性盤點

### 3.1 結構問題

**M1 — 三套「Holdings」共存且命名衝突**
- `src/checkup/components/holdings/HoldingsTable.jsx`（會員版表格）vs `src/checkup/components/freecheckup/HoldingCard.jsx`（免費版卡片）vs `src/pages/app/Holdings.tsx`（App 訂閱清單）
- 新成員無法從檔名分辨；建議分別更名為 `MemberHoldingsTable` / `FreeCheckupHoldingCard` / `AppSubscriptionList`

**M2 — `HoldingsTab.jsx` 仍接 60+ props（schema 寫了 60 行）**
- L18-64 的 `HOLDINGS_TAB_PROP_SCHEMA` 本身就是「介面過寬」的證據
- 真正狀態源：FreeCheckup.jsx 仍是 3,487 行 god component
- 建議：抽出 `useHoldingsDerived(H, decisionsMap, filters, sort)` hook（含 globalSortedList / filteredSortedList / displayed / variantsMap / orderedDisplayed / firstFeatureCode / strategyOptions），HoldingsTab 自己 call

**M3 — 樣板層 `HoldingsWorkbench` / `HoldingDetailPanel` / `HoldingHero` / `HoldingCard` 與 freecheckup 版本同名但內容不同**
- 同一 git grep `HoldingCard` 會撈出兩個不同檔案，IDE auto-import 容易誤選
- 建議：樣板層加 `_Template` 後綴或移到 `holdings/_template/`

**M4 — `holdingsTokens.js`（憲法）vs `theme.js`（C/alpha）vs inline WB 物件三套色票**
- HoldingCard 同時收 `WB` + `alpha`，憲法寫在 README 但程式碼無 lint 護欄
- 建議：把 `WB` 收斂進 `holdingsTokens.js`，HoldingCard 只 import 不從 props 收

**M5 — `validateProps`（dev-only）是運行期 schema 檢查，TypeScript 才是正解**
- 12 個 jsx 都用 `validateProps`，總成本 > 改成 .tsx；schema 對齊也省一半
- 建議：批次 .jsx → .tsx 並用 type alias `HoldingsTabProps`

**M6 — `HoldingsPanel.jsx`（559 行）用 `createElement(h, ...)` 寫法**
- 不一致：同目錄 `HoldingsWorkbench.jsx` 用 JSX，這支用 hyperscript → 閱讀成本高
- 建議：統一 JSX

**M7 — Hooks 重疊：`src/hooks/useHoldings.ts`（React Query）+ `src/checkup/hooks/useHoldings.js`（本地 state）+ `src/checkup/stores/holdingsStore.js`（Zustand）**
- 三個都叫 `useHoldings`/`holdingsStore`；新成員無法分辨應該用哪個
- 建議：useHoldings.ts → `useMyTradeRecordHoldings.ts`，明確標示來源

### 3.2 隱藏耦合
- **C1**：`FreeCheckup.jsx` L1100 `holdingsCodesKey` 是 18 個 useMemo/useEffect 的 deps 命脈，但分散在 400 行內，缺一張依賴圖
- **C2**：`isDemo`、`startLineLogin` 直接傳到 HoldingsTab → 應該由 Context 提供
- **C3**：`holdingsTab.css` 的 `.wb-card` / `.wb-roi` className 是合約字串，硬綁 inline style 媒體查詢；任何重命名都會破 RWD 護欄（已記憶 `mem://qa/checkup/freecheckup-mobile-regression-checklist`）

---

## 4. 風險與測試覆蓋

- ✅ `freecheckup-mobile-card-overflow.test.ts`（卡片 overflow 護欄）
- ✅ `freecheckup-tab-perf.test.tsx`（tab perf）
- ✅ `freecheckup-tab-prop-schema.test.ts`（schema）
- ✅ `e2e/freecheckup-card.spec.ts`（mobile）
- ❌ **缺**：`compareByPriority` 純函式測試
- ❌ **缺**：`HoldingsPage.jsx`（會員版）任何整合測試
- ❌ **缺**：樣板層元件是否有人引用的 lint rule

---

## 5. 建議優先順序（依 ROI）

### 立即執行（半天內，純收益）
- **A1**：移除/隔離 `holdings/` 樣板層 1,252 行死碼，或加註 `_Template` 後綴
- **A2**：`compareByPriority` 預算入 `decisionsMap`（P0）
- **A3**：`filteredSortedList` deps 移除 `normalizedEvents`（P1）
- **A4**：`HoldingsHero` 只收 length（P4）

### 一日工作量（重構不破壞行為）
- **B1**：抽出 `useHoldingsDerived` hook，將 9 個 useMemo 從 FreeCheckup.jsx 搬走（M2）
- **B2**：穩定化 `H` reference（P2）
- **B3**：`HoldingsActionPriority` 收斂為 3 筆物件（P5）
- **B4**：`HoldingsTab.jsx` + `HoldingCard.jsx` 改 .tsx（M5）

### 二日工作量（架構級）
- **C1**：合併 `holdings/` 樣板層與 `freecheckup/` 持倉版，建立單一 `holdings/` 來源（含 token 收斂 M4）
- **C2**：三套 `useHoldings` 命名清理（M7）
- **C3**：`HoldingsPanel.jsx` createElement → JSX（M6）

---

## 6. 不建議動的部分

- `HoldingsTab.jsx` 60+ props 看起來醜但**短期不要全砍**：FreeCheckup parent 仍掌握 quote tick / cloud sync / drawer 等跨 tab 狀態，硬抽 Context 會引入新 bug
- `validateProps` dev 警告短期保留（替代 TS 之前的安全網）
- 樣板層 README 已明確「不准接入 free-checkup」的憲法 → 不要破

---

## 7. 待你決定

請挑選要執行的批次（建議 **A 全做（半天）→ 看效果 → 決定 B/C**），我會：
1. 在每批開頭先把該批寫入 `.lovable/holdings-audit-2026-05.md` 作為交付契約
2. 完成後跑 `freecheckup-mobile-regression-checklist`（記憶強制條款）+ tsc + 相關 unit/e2e
3. 回報 LOC 變化與 React Profiler 量測
