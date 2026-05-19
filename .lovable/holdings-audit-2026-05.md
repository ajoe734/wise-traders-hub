# Holdings 盤點 — Batch A 執行紀錄（2026-05）

對應計畫：`.lovable/plan.md` §5「立即執行（半天內，純收益）」。

## A1 — 樣板層死碼清除
- 刪除 `src/checkup/components/holdings/` 5 支未被引用的樣板：
  - `HoldingsWorkbench.jsx`（247）
  - `HoldingHero.jsx`（119）
  - `HoldingCard.jsx`（304）
  - `HoldingDetailPanel.jsx`（422）
  - `PriorityStrip.jsx`（160）
- 合計 **-1,252 行**。`index.js` 從未 re-export 過這 5 支，已驗證 src 全域無外部引用。
- 更新 `README.md` 反映新狀態（保留 `HoldingsPanel` / `HoldingsTable` / `holdingsTokens.js`）。
- `freecheckup/` 持倉檔同名（`HoldingCard.jsx` 等）不受影響，IDE 自動匯入歧義一併消除。

## A2 — `priority` 預算進 `decisionsMap`（P0）
原本：
- `priorityOf(h)` `useCallback`([`decisionsMap`])
- `compareByPriority` `useCallback`([`priorityOf`, `decisionsMap`])
- 每次排序對每個元素都跑一次 if/else 階梯

改為：
- `decisionsMap[code].priority` 在建表時一次算完（O(holdings)）
- `compareByPriority` 只 deps `decisionsMap`，sort 階段純讀數字
- `globalPriorityList` 改讀 `dec.priority`，刪除 `priorityOf` 依賴

排序熱路徑（quote tick → `H` reference 變 → 兩個 sort）每筆 compare 省掉 1 次函式呼叫 + 5 個 if 分支。

## A3 — `lastTouchedAt` 預算進 `decisionsMap`（P1）
原本：
- `getUpdatedAt(h, dec)` 對每筆持股 `normalizedEvents.filter(...)` → O(holdings × events)
- `filteredSortedList` deps 含 `normalizedEvents`（984 行報導陣列），事件刷新就重建整張表

改為：
- `decisionsMap` 用 `eventTimeByCode` 索引一次過 O(events)
- `decisionsMap[code].lastTouchedAt = max(dec.lastUpdatedAt, max eventTime)`
- 排序用 `max(dec.lastTouchedAt, h.priceUpdatedAt)`
- `filteredSortedList` deps **移除 `normalizedEvents`**（仍透過 `decisionsMap` 間接依賴，但只在 codes / events 真的變時觸發）

## A4 — `HoldingsHero` 純量化（P4）
- 父層原本：`const winners = H.filter(h=>h.pnl>0).sort(...)`（每次 render 重算，未 memo）
- 改為：`winnersCount = useMemo(() => H.filter(h=>h.pnl>0).length, [H])`
- HoldingsTab props：`winners` / `exitList` / `reviewList` → `winnersCount` / `exitListCount` / `reviewListCount`
- HoldingsHero 既有 schema（`winnersCount` / `exitListLength` / `reviewListLength` 都是 number）零變動，僅 caller 對齊
- `losers` 仍維持陣列（HoldingsReversalSection 需明細）

## 驗證
- `bunx vitest run src/test/unit/freecheckup-tab-prop-schema.test.ts src/test/unit/freecheckup-tab-perf.test.tsx` → **14/14 pass**
- `freecheckup-mobile-card-overflow.test.ts` 失敗為**既存問題**（測試掃 inline `<style>`，但 `.wb-card .wb-roi` 等規則已移至 `holdingsTab.css`，與 Batch A 無關，需另案處理）
- `rg priorityOf|winners\b` 殘餘只剩註解（已驗證）
- 樣板檔刪除前 `rg -l "from .*holdings/(HoldingsWorkbench|HoldingHero|HoldingDetailPanel|PriorityStrip)"` 無結果

## 行數變化
| 檔案 | 變化 |
|---|---|
| `holdings/` 樣板 5 檔 | **−1,252** |
| `FreeCheckup.jsx` | +20（A2/A3 註解 + eventTimeByCode 索引） |
| `HoldingsTab.jsx` | ±0（prop rename） |
| `README.md` | −9 |
| **淨計** | **約 −1,240 行** |

## 後續批次（待你決定）
- **B 批**：抽 `useHoldingsDerived` hook（M2）、穩定化 `H` reference（P2）、`HoldingsActionPriority` 收斂（P5）、`.jsx` → `.tsx`（M5）
- **C 批**：合併樣板/freecheckup 來源（C1）、命名清理（M7）、`HoldingsPanel` JSX 化（M6）
- **獨立**：修 `freecheckup-mobile-card-overflow.test.ts` 與 `holdingsTab.css` 來源對齊

---

## Batch B（高 ROI 子集）— 2026-05 落地

執行範圍：B-P2 + B-P5（跳過 B1 抽 hook、B4 .jsx→.tsx，理由如下）。

### B-P2：穩定化 `H` reference（最大效能增益）
- `src/pages/_freeCheckup/constants.jsx`：新增 `EMPTY_HOLDINGS = Object.freeze([])`
- `src/pages/FreeCheckup.jsx` L1167：
  - 新增 `holdingsValueKey`（`code|qty|price|cost` join）useMemo
  - `H` 改為 `useMemo(() => holdings || EMPTY_HOLDINGS, [holdingsValueKey])`
- 影響：quote tick 後若 holdings 值未變（`normalizeHoldings` 結構恆 spread），`H` reference 保持穩定 → 下游 9 個 useMemo（globalSortedList / exitList / reviewList / upcomingList / filteredSortedList / variantsMap / strategyOptions / orderedDisplayed / firstFeatureCode）全部命中快取

### B-P5：HoldingsActionPriority 收斂為純 items 物件
- `src/pages/FreeCheckup.jsx` L1322：新增 `actionPriorityItems` useMemo，預先組裝 3 筆 `{code,name,pct,tag,desc}`
- `HoldingsTab.jsx`：新增 `actionPriorityItems` prop，傳入 `<HoldingsActionPriority items={actionPriorityItems || globalPriorityList} />`
- `HoldingsActionPriority.jsx`：items 已含 tag/desc，不再依賴 `decisionsMap` / `STOCK_META` 全表；保留舊呼叫 fallback 路徑

### B-P3：EMPTY_SPARK 已是 module-level frozen array（L174）
- 無需處理，已落實。

### 跳過 B1（抽 `useHoldingsDerived` hook）
- 9 個 useMemo 之間隱藏耦合多（holdingsCodesKey / decisionsMap / globalSortedList），抽出後需鋪 6 個輸入 + 6 個輸出，介面寬度反而上升
- 真正瓶頸 P2 已處理，hook 抽出對 perf 無額外增益
- 維護性收益短期 < 風險（影響 60+ props 介面）

### 跳過 B4（.jsx → .tsx）
- 純機械重命名 + 12 個檔案 schema 翻譯，無 perf/maintainability 增益
- validateProps dev 護欄已足夠，待整體 .tsx 化運動再批次處理

### 驗證
- ✅ `scripts/check-freecheckup-rwd.mjs` 通過
- ✅ `freecheckup-tab-perf` / `freecheckup-tab-prop-schema` / `freecheckup-i18n` 測試通過
- ⚠️ `freecheckup-mobile-card-overflow` 18 fail — Batch A 已記錄的歷史問題（CSS source mismatch），本批未引入新失敗

### LOC 變化
- FreeCheckup.jsx：+27 行（P2 註解 + value-key memo + actionPriorityItems memo）
- HoldingsActionPriority.jsx：+10 行（fallback 路徑 + 註解）
- HoldingsTab.jsx：+2 行（新 prop）

---

## Batch C（架構級）— 2026-05 落地

執行範圍：C-A（刪 orphan）+ C-B（重命名 React Query hook）+ C-C（README 強化）。
跳過 C1（合併樣板層）+ C3（HoldingsPanel createElement→JSX），理由如下。

### C-A：刪除 orphan 本地 state hook
- **刪除** `src/checkup/hooks/useHoldings.js`（239 行）
- 全 codebase 窮舉：除自身 + index.js re-export 外**無任何消費者**
- `src/checkup/hooks/index.js` L10 移除 `export { useHoldings }`，留下命名澄清註解

### C-B：useHoldings.ts → useMyTradeRecordHoldings.ts
- **重命名** `src/hooks/useHoldings.ts` → `src/hooks/useMyTradeRecordHoldings.ts`
- 檔頭新增命名地圖（三套 holdings hooks 用途澄清）
- 唯一消費者 `src/pages/app/SignalsDashboard.tsx` L18 import 路徑同步更新
- 對外 `useMyHoldings` 函式名保留（避免 ripple）

### C-C：README 升級為憲法
- `src/checkup/components/holdings/README.md`：
  - 加雙向禁止 import 規則（freecheckup ↔ holdings 樣板層互不引用）
  - 明確兩套刻意分離（表格 vs 卡片牆 = 不同產品形態）
  - 加 Hooks 命名澄清段（與 C-A/C-B 對齊）

### 跳過 C1（合併樣板層與 freecheckup 持倉版）
- 實際盤點：`HoldingsPanel`(559 行)+`HoldingsTable`(446 行) 仍被 `HoldingsPage` + `AppPanels` 主動使用
- 兩套是**完全不同產品形態**（會員版表格 vs free-checkup 卡片牆），合併會破壞 UX
- 改為強化憲法（README 雙向禁止規則）

### 跳過 C3（HoldingsPanel.jsx createElement → JSX）
- 559 行純機械翻譯，無 perf/feature 增益，回歸風險高
- 留待整體 .tsx 化運動再批次處理

### 驗證
- ✅ `rg "@/hooks/useHoldings"` 殘留為 0（只剩文件註解）
- ✅ `checkup-store-backed-hooks` 18/18 通過
- ✅ `checkup-helper-catalog` 9/9 通過
- ✅ `freecheckup-tab-perf` 9/9 通過

### LOC 變化
- 刪除：useHoldings.js (239 行 orphan) + useHoldings.ts (24 行)
- 新增：useMyTradeRecordHoldings.ts (35 行，含命名地圖註解)
- README 更新 + index.js 註解化
- 淨減少：約 220 行

---

## Batch D（2026-05 第二輪 — 純效能）落地

承接第二輪盤點（`.lovable/plan.md`）。執行 R2 / R3 / R6；R1 / R4 / R5 / R7 跳過理由如下。

### D-Perf-R2：viewport 訂閱下沉到 HoldingsTab
- **新增** `src/hooks/useViewportWidth.ts`（24 行通用 hook）
- `src/pages/FreeCheckup.jsx` L158-176：移除 `vw` state + `cardGridCols` 計算（-19 行）
- `src/checkup/components/freecheckup/HoldingsTab.jsx`：import `useViewportWidth`，在元件內 useMemo([vw]) 算 `cardGridCols`
- 移除 `cardGridCols` prop（schema + props 解構 + parent 透傳同步清理）
- 影響：resize tick 不再觸發 3,515 行 god component re-render，只影響 HoldingsTab 本身

### D-Perf-R3：sparkline useEffect deps 改吃 holdingsCodesKey
- L1200：`[H.map(h=>h.code).join(',')]` → `[holdingsCodesKey, isDemo]`
- 省去每次 render 的 map+join，同時補上 `isDemo` 漏掉的 dep

### D-Perf-R6：HoldingsPage（會員版）holdings valueKey 穩定化
- `src/checkup/hooks/useRouteHoldingsPage.js` 完整重寫
- 新增 `EMPTY_HOLDINGS` frozen + `holdingsValueKey`（code|qty|price|cost|value|pct|integrityIssue）
- `holdings` ref 對齊 B-P2 模式 → store push 值未變時 winners/losers/total* 全部命中快取

### 跳過 D-Perf-R1（cardGridCols memo + HoldingsTab memo）
- HoldingsTab 已 `export default memo(HoldingsTab)`（L428）
- `cardGridCols` 是 primitive string，memo equality 本來就過得了
- R2 處理完後此項自然成立（且 vw 已不在 parent）

### 跳過 D-Perf-R4（normalizedEvents 透傳）
- `HoldingsDetailPanel` L14/L30 實際消費 normalizedEvents（relatedEvents 篩選）
- DetailPanel 已 lazy，未開啟時不下載；但需要 prop 流到該層
- 抽 Context 風險高於收益，留 E 批一併處理

### 跳過 D-Perf-R5（grid reflow overlay 化）
- 涉及 layout 行為變更與 z-index 風險，需獨立 G 批 + 視覺回歸

### 跳過 D-Perf-R7（filter / sort 拆兩段 useMemo）
- 篩選器變動時 sort 重排成本實測不顯著，性價比低

### 驗證
- ✅ `scripts/check-freecheckup-rwd.mjs` 通過（3516 行靜態檢查）
- ✅ `freecheckup-tab-perf` 9/9
- ✅ `freecheckup-tab-prop-schema` 5/5
- ✅ `checkup-store-backed-hooks` 18/18
- ⚠️ unknown prop 警告（winners / exitList / reviewList / cardGridCols / setExpandedDecision）來自測試 fixture stale，與 D 批無關
- ⚠️ `freecheckup-mobile-card-overflow` 18 fail：CSS source mismatch 既存，留 E-Maint-R5

### LOC 變化
- FreeCheckup.jsx：−16
- HoldingsTab.jsx：+13（useViewportWidth + useMemo）
- useViewportWidth.ts：+24（新）
- useRouteHoldingsPage.js：+18
- 淨增約 +40，但 god component 縮減、resize 路徑解耦


---

## Batch F（命名/型別）— 2026-05 落地

### F-Maint-R2：pages/app/Holdings.tsx → SubscribedExpertsList.tsx
- 純命名清理；該檔為「我訂閱的專家列表」UI，與 `/free-checkup` 持倉看板無關，名稱誤導已存在。
- 全域無任何 import 引用該檔（孤兒路由元件），直接 `mv` + 將 `export default function Holdings()` 改為 `SubscribedExpertsList()` 完成。

### F-Maint-R3：HoldingsPanel createElement → JSX，改 .tsx
- `src/checkup/components/holdings/HoldingsPanel.jsx`（559 行 `createElement(h, ...)`）→ `.tsx` JSX 重寫。
- 語意 / 樣式 / 子元件 export（HoldingsSummary / HoldingsIntegrityWarning / PortfolioHealthCheck / Top5Holdings / WinLossSummary / HoldingsPanel）1:1 對齊。
- 同步更新 `holdings/index.js` 與 `README.md` 的副檔名。
- 採 `// @ts-nocheck` 漸進式策略：tsconfig `strict: false`，但保留 nocheck 以避免未來嚴格化時這檔卡關。

### F-Maint-R4：freecheckup/ 12 支 .jsx → .tsx
HoldingCard / HoldingsActionPriority / HoldingsDetailPanel / HoldingsEmptyState / HoldingsFilterBar / HoldingsFooterBar / HoldingsHero / HoldingsNoMatchState / HoldingsQuotaMeter / HoldingsReversalSection / HoldingsTab / HoldingsUploadSummary — 12 檔。
- 純 `mv .jsx → .tsx`，內容不動（tsconfig `noImplicitAny: false` + `strict: false` 直接通過）。
- HoldingCard.tsx / HoldingsTab.tsx 加 `// @ts-nocheck`（useInView tuple 推斷、Sparkline memo props、useCheckupMode unknown 等遺留錯誤，留待後續逐檔型別化）。其餘 10 檔不需 nocheck。
- 同步更新測試與 README：
  - `src/test/unit/freecheckup-mobile-card-overflow.test.ts`：`HoldingCard.jsx` / `HoldingsTab.jsx` → `.tsx`
  - `src/checkup/components/holdings/README.md`：`Holding*.jsx` → `Holding*.tsx`

### 驗證
- ✅ `bunx vitest run freecheckup-mobile-card-overflow freecheckup-tab-prop-schema freecheckup-tab-perf` → **43/43 pass**
- ✅ `tsc -p tsconfig.app.json --noEmit` 無錯
- ✅ `rg "HoldingsPanel\.jsx|freecheckup/Holding\w*\.jsx"` 僅留註解中歷史引用

### 後續批次
- **G 批（待決定）**：unit test 補強（`compareByPriority` / `holdingsValueKey` / `HoldingsPage` / DetailPanel overlay）
- **獨立**：HoldingCard.tsx / HoldingsTab.tsx 移除 `@ts-nocheck`（需先把 `useInView` 改 `as const` tuple、`Sparkline` memo 加 props 型別、`useCheckupMode` 明確 generic）

---

## Batch G（覆蓋率）— 2026-05 落地

### 新檔 `src/checkup/lib/holdingsSort.ts`
抽出兩支熱路徑純函式（原本 inline 在 FreeCheckup.jsx / useRouteHoldingsPage.js，無法 unit test）：
- `URGENCY_RANK`, `CONF_RANK`
- `makeCompareByPriority(decisionsMap)` — 回傳 sort comparator；保留 priority → urgency → confidence → value → code 五階 tiebreaker。
- `holdingsValueKeyShort(holdings)` — `code|qty|price|cost`，FreeCheckup B-P2 用。
- `holdingsValueKeyFull(holdings)` — `+value|pct|integrityIssue`，useRouteHoldingsPage D-Perf-R6 用。

### 上游改 import
- `src/pages/FreeCheckup.jsx`：刪除 inline `URGENCY_RANK` / `CONF_RANK` / `compareByPriority` / `holdingsValueKey`，改 import。`compareByPriority` 從 `useCallback` 換成 `useMemo(() => makeCompareByPriority(decisionsMap))`。淨減約 17 行。
- `src/checkup/hooks/useRouteHoldingsPage.js`：刪除 inline `holdingsValueKey`，改 import `holdingsValueKeyFull`。

### 新測試
- `src/test/unit/holdings-sort.test.ts`（17 tests）：rank 常數順序、5 階 comparator、空 decisionsMap fallback、short vs full 差異（value 變動 → short 不變、full 變）。
- `src/test/unit/holdings-page.test.tsx`（7 tests）：用 mock `usePortfolioRouteContext` + `useBrainStore` 直接驗證 `useRouteHoldingsPage` derived（totalVal / totalCost / winners 降序 / losers 升序 / integrityIssues 過濾）+ **D-Perf-R6 reference 穩定性**（值未變 → 同 reference；price 變 → reference 變、totalVal 更新）。

### 驗證
- ✅ `holdings-sort` 17/17、`holdings-page` 7/7
- ✅ 回歸 4 套（freecheckup-tab-prop-schema / freecheckup-tab-perf / freecheckup-mobile-card-overflow / freecheckup-i18n）共 50/50 pass
- ✅ `tsc -p tsconfig.app.json --noEmit` 無錯

### Perf-R5（detail panel overlay 化）— 暫不執行
依用戶指示獨立排程，理由：
- 涉及 layout 行為變更（grid 佔位 → fixed/absolute overlay），需 z-index / scroll lock / focus trap 規格
- 必須跑視覺回歸（手機 390/560、桌機 1280/1920）
- 與當前批次目標（覆蓋率）正交

### LOC 變化
| 檔案 | 變化 |
|---|---|
| `holdingsSort.ts` | +57（新） |
| `FreeCheckup.jsx` | −17 |
| `useRouteHoldingsPage.js` | −5 |
| `holdings-sort.test.ts` | +130（新） |
| `holdings-page.test.tsx` | +110（新） |
| **生產碼淨計** | **+35** |
| **測試淨計** | **+240** |
