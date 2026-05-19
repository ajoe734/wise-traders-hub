# 持股看板盤點（2026-05 第二輪）

承接 `.lovable/holdings-audit-2026-05.md`（A/B/C 批已完成）。本輪只盤點不動工。

---

## 1. 目前狀態快照

| 區塊 | 行數 | 狀態 |
|---|---|---|
| `FreeCheckup.jsx`（god component） | 3,532 | 持股相關區段 ~L1100–L1500、L2880–L2950 |
| `freecheckup/HoldingsTab.jsx` | 428 | 60+ props、未 `memo`、內含 workbench grid |
| `freecheckup/HoldingCard.jsx` | 385 | 已 `memo` + IntersectionObserver |
| `freecheckup/HoldingsDetailPanel.jsx` | 236 | 已 lazy |
| `freecheckup/HoldingsHero/Filter/Reversal/ActionPriority` | 178/177/139/108 | 已抽出 |
| `holdings/HoldingsPanel.jsx` + `HoldingsTable.jsx` | 559 + 446 | 會員版仍 createElement |
| `holdingsTab.css` | 117 | 與 inline `<style>` 來源不一致（測試失敗） |

驗證腳本：`freecheckup-mobile-card-overflow.test.ts` 18 fail（既存）。

---

## 2. 仍待處理項目（依 ROI 排序）

### 效能類

**Perf-R1 — `cardGridCols` 每次 render 都產生新字串**
- L170：`const cardGridCols = vw <= 640 ? '1fr' : ...`，無 `useMemo`，且 `vw` 由 resize listener 持續 setState。
- 影響：`HoldingsTab` 未 memo，每次 parent re-render 整顆 tab 重渲；即使 memo，新字串會破 prop equality。
- 建議：`useMemo([vw])` + 對 `HoldingsTab` 加 `memo`。

**Perf-R2 — `vw` resize state 寫在 FreeCheckup root**
- 每次 resize 觸發 3,500 行 god component re-render，連帶 5 個 tab 全算。
- 建議：抽 `useViewportWidth()` hook 並下沉到 `HoldingsTab`（其他 tab 用不到 grid cols）。

**Perf-R3 — sparkline useEffect deps 用 `H.map(h=>h.code).join(',')` 字串**
- L1216：每次 render 重算 join，但 React 會 string-compare deps，浪費 CPU 不大但可改吃 `holdingsCodesKey`（已是 useMemo）。

**Perf-R4 — `normalizedEvents`（984 行陣列）仍以 prop 形式傳入 HoldingsTab + HoldingsDetailPanel**
- DetailPanel 只在選中時用，可改為 lazy fetch 或抽 Context。
- HoldingsTab 已不直接用（A3 已移除），仍透傳 → 可砍。

**Perf-R5 — workbench grid 切換仍會 reflow 全部卡片（P6 未處理）**
- `gridTemplateColumns: showPanel ? '1fr 420px' : '1fr'` 觸發整片卡片 layout。
- 建議：detail panel 改 `position:fixed` overlay 或 transform，不動 grid 結構。

**Perf-R6 — `HoldingsPage`（會員版）每次 store push 重建 winners/losers**
- `useRouteHoldingsPage.js` L20-29 直接 `[...holdings].sort()`；同 P2 holdings reference 抖動。
- 建議：同樣導入 valueKey 穩定化。

**Perf-R7 — `filteredSortedList` 同時做 filter + sort，sort 結果無法跨 filter 變動快取**
- 篩選器變動時連帶重排（O(n log n)）。建議分兩個 useMemo（filter 結果 → sort）。

### 可維護性類

**Maint-R1 — `HoldingsTab.jsx` 仍接 60+ props（M2 未處理）**
- 60 行 schema 就是介面過寬證據。B1 抽 `useHoldingsDerived` 當時跳過理由為「介面寬度反而上升」，但若同時將 derived state（globalSortedList / variantsMap / orderedDisplayed / firstFeatureCode / strategyOptions / actionPriorityItems）下沉到 hook 並讓 `HoldingsTab` 自己 call，parent 介面可從 60 砍到 ~25。

**Maint-R2 — 命名衝突仍在（M1 未處理）**
- `holdings/HoldingsTable.jsx` vs `freecheckup/HoldingCard.jsx` vs `pages/app/Holdings.tsx`（訂閱清單，與持股無關）。
- 建議：`pages/app/Holdings.tsx` → `pages/app/SubscribedExpertsList.tsx`（這支根本不是持股）。

**Maint-R3 — `HoldingsPanel.jsx` 559 行 createElement（M6 / C3 未處理）**
- 與同目錄 JSX 風格不一致。要動但機械性高，建議獨立任務日。

**Maint-R4 — `.jsx → .tsx`（M5 / B4 未處理）**
- 12 支持股檔。可作為整體 .tsx 化運動的一部分，不單獨處理。

**Maint-R5 — `holdingsTab.css` vs FreeCheckup 內 inline `<style>` 來源分裂**
- `freecheckup-mobile-card-overflow.test.ts` 18 fail 的根因。
- 建議：把 `.wb-card` / `.wb-roi` 媒體查詢規則從 inline `<style>` L2965/L4745 移到 `holdingsTab.css`，或反向把 `holdingsTab.css` 內容回 inline，二選一統一來源；同時更新測試掃描範圍。

**Maint-R6 — `WB` 物件仍以 prop 鏈傳遞**
- HoldingCard 同時收 `WB` + `alpha` + 從 holdingsTokens 拿 token，三套色票並存。
- 建議：HoldingCard 改直接 import `holdingsTokens.js`，停止透傳 WB。

**Maint-R7 — `isDemo` / `startLineLogin` / `setTab` 跨 5 個 tab 透傳**
- 應該由 `CheckupModeContext`（已存在）統一提供，省去 prop drilling。

---

## 3. 不建議動的部分

- 樣板層 `HoldingsPanel` / `HoldingsTable` 仍有會員版實際引用，C1 合併會破壞 UX（已記憶）。
- `validateProps` dev 護欄在 .tsx 化前保留。
- 60+ props 介面短期不要全砍，配合 Maint-R1 hook 抽出後自然收斂。

---

## 4. 風險與測試覆蓋缺口

- ❌ `compareByPriority` 純函式測試（A2 後 priority 已預算進 decisionsMap，更易測）
- ❌ `holdingsValueKey` 穩定性測試（B-P2 的核心契約）
- ❌ `HoldingsPage`（會員版）整合測試
- ❌ 樣板層被引用偵測 lint rule
- ⚠️ `freecheckup-mobile-card-overflow` 18 fail（Maint-R5 修完才會綠）

---

## 5. 建議批次

### D 批（半天，純效能）
- Perf-R1 `cardGridCols` useMemo + `HoldingsTab` memo
- Perf-R2 `useViewportWidth` 下沉
- Perf-R3 sparkline deps 改吃 `holdingsCodesKey`
- Perf-R4 砍掉透傳的 `normalizedEvents`（HoldingsTab）
- Perf-R6 HoldingsPage holdings valueKey

### E 批（一日，結構級）
- Maint-R1 抽 `useHoldingsDerived`（同時下沉 6 個 derived useMemo → HoldingsTab props 60→25）
- Maint-R5 統一 CSS 來源並修 mobile overflow 測試
- Maint-R6 HoldingCard 直接 import holdingsTokens
- Maint-R7 `CheckupModeContext` 收斂 isDemo/startLineLogin

### F 批（一日，命名/型別）
- Maint-R2 `pages/app/Holdings.tsx` → `SubscribedExpertsList.tsx`
- Maint-R3 HoldingsPanel createElement → JSX
- Maint-R4 持股 12 支 .jsx → .tsx

### G 批（半天，覆蓋率）
- 補 `compareByPriority` / `holdingsValueKey` / `HoldingsPage` 單元測試
- Perf-R5 detail panel overlay 化（風險較高，獨立排）

---

## 6. 待你決定

請挑批次。建議先 **D 批**（純收益、低風險）→ 看 React Profiler → 再決定 E/F。
若優先想清乾淨歷史包袱，可改先跑 **Maint-R5 + Maint-R2** 修測試與消歧義。
