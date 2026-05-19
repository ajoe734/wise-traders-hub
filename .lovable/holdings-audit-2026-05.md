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
