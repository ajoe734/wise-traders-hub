
# Plan：A2-3 + A1+ 並行推進

兩件事互不衝突：A2-3 動 events / news / daily 三段 tab JSX，A1+ 動 holdings tab 內的 Action Priority 與 Detail Panel。檔案同一個（`src/pages/FreeCheckup.jsx`，7195 行），但動的區段不重疊。

## 共同硬合約（不能違反）
1. `L2965` 全域 `<style>{...}</style>` 字面字串保留在 `FreeCheckup.jsx`
2. `L4745` 持倉看板 `<style>{...}</style>` 字面字串保留在 `FreeCheckup.jsx`
3. 抽出/包裝過程不得新增 state owner，不得改 callback 行為，不得動樣式輸出
4. 動完跑：
   - `bunx vitest run src/test/unit/freecheckup-mobile-card-overflow.test.ts`
   - `bunx vitest run src/test/unit/freecheckup-i18n.test.ts`
   - `bunx playwright test e2e/freecheckup-card.spec.ts`
   - 560 / 390 / 380px 視覺檢查

---

## Part A：A2-3 — Events / News / Daily tab 整段 useMemo

範圍（已用 rg 確認）：
- Events tab：`L4972` 起 `{tab==="events" && <>...`（約 500 行）
- Daily tab：`L5481` 起（約 487 行）
- News tab：`L6563` 起（到下一個 `tab===` 區段為止）

做法（每段相同）：
1. 在 tab 區段「之前」就近建一個 `const eventsTabNode = useMemo(() => (<>...JSX...</>), [...deps])`
2. 將 `{tab==="events" && <>...</>}` 改成 `{tab==="events" && eventsTabNode}`
3. **deps 規則**（嚴格）：
   - 只放純資料 ref：`normalizedEvents`、`filterType`、`filterCatalyst`、`expandedNews`、`reviewingEvent`、`reviewForm`、`relayPlanExpanded`…
   - **禁止**把 callback 放進 deps；callback 已透過 useCallback 穩定 ref，可直接閉包引用
   - `WB / C / alpha / theme` 視為模組常數，不入 deps
4. 三段獨立執行、獨立 commit 級別測試，避免 deps 漏放被同一輪掩蓋

風險：deps 漏放 → stale render。緩解：每段做完手動切到該 tab 跑一次完整互動（filter、展開、提交 review、relay plan 展開），確認畫面與資料同步。

---

## Part B：A1+ — Holdings 子區塊抽元件 + lazy-load

選兩塊收益最大、耦合可控的：

### B1. `<HoldingsActionPriority>`（L3684–L3795 附近 IIFE）
- 輸入 props：`items`（已是 `globalPriorityList.slice(0,3)`）、`decisionsMap`、`onPick(code)`、`WB`
- 純展示，無內部 state
- 抽到 `src/checkup/components/freecheckup/HoldingsActionPriority.jsx`，外層 `React.memo`

### B2. `<HoldingsDetailPanel>`（L4290 `renderDetailPanel`）
依賴解法：把目前閉包讀的變數全部改 props 傳入：
- `selected, decisionsMap, stockMeta(STOCK_META), targets, avgTarget, normalizedEvents, orderedDisplayed, WB`
- callback：`onSelectCode, onOpenDrawer, onOverrideToHold, userOverrides`
- 元件位置：`src/checkup/components/freecheckup/HoldingsDetailPanel.jsx`，`React.memo`

### B3. Lazy-load
- 用 `const HoldingsDetailPanel = React.lazy(() => import('...'))`
- 外層 `<Suspense fallback={null}>` 包住
- Action Priority 是首屏必看，**不 lazy**，只做 memo 抽元件
- DetailPanel 在桌面 ≥1024px 才顯示、且需要 `selected` 才有內容，lazy 安全

### B4. 限制
- 抽出後 `FreeCheckup.jsx` 仍負責渲染容器與 `<style>`，保留 L2965 / L4745 字面字串
- 不改 holdings tab 的搜尋/排序/filter 邏輯，那些屬於 A2-2（已跳過）

---

## 執行順序

```text
1. A2-3-events  → 驗證
2. A2-3-news    → 驗證
3. A2-3-daily   → 驗證
4. A1+-B1 Action Priority 抽元件 → 驗證
5. A1+-B2 Detail Panel 抽元件   → 驗證
6. A1+-B3 lazy-load Detail Panel → 驗證
7. 更新 mem://architecture/checkup/inline-rendering-audit：
   - 新增例外：freecheckup/ 下「list item 級 + 桌面側欄級」memo wrapper 允許
   - 強調 tab 容器級 JSX 仍留在 FreeCheckup.jsx
   - 補：tab JSX 可 inline useMemo，deps 限 stable ref + deferred value，禁 callback
```

每個 step 都是可獨立 revert 的最小單元；任一驗證紅燈即停在該 step 排查，不續推。

## 驗證清單（每個 step 結束跑）
- `bunx vitest run src/test/unit/freecheckup-mobile-card-overflow.test.ts src/test/unit/freecheckup-i18n.test.ts`
- `bunx playwright test e2e/freecheckup-card.spec.ts`
- 視覺：560 / 390 / 380px 截圖 + 桌面 1280px Detail Panel 展開
- 互動：切 4 個 tab、搜尋打字、展開 list item、Action Priority 點擊、Detail Panel 切換 selected
