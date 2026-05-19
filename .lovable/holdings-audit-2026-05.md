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
