## 持股看板效能優化 — P3 完整集

範圍：A 載入 + B 執行 + C 驗證 全部執行。

### A. 載入體積

1. **抽 `HoldingsTab.jsx` + `lazy()`**（L3277-L4500，~1230 行）
   - `FreeCheckup.jsx`：`const HoldingsTab = lazy(() => import("@/checkup/components/freecheckup/HoldingsTab"));`
   - `{tab==="holdings" && <Suspense><HoldingsTab .../></Suspense>}`
   - 補 `HOLDINGS_TAB_PROP_SCHEMA` 到 `_validateProps.js`

2. **再切 4 個 `React.memo` 子元件**
   - `HoldingsHero.jsx`（L3453-L3594）
   - `HoldingsQuotaMeter.jsx`（L3289-L3404）
   - `HoldingsFilterBar.jsx`（L3701-L3818）
   - `HoldingsReversalSection.jsx`（L3597-L3687；同時把 `defaultValue + getElementById` 改 controlled `useState`）

3. **`HoldingCard.jsx` 抽 memo 元件**（L3870-L4216）
   - 三 variant（feature/accent/plain）由 props 控制
   - `truncateAction`、`SRC_LABEL`、`URGENCY_RANK` 等常數提到 module 層
   - `Sparkline` 補 `React.memo`

### B. 執行渲染

4. **`useMemo` 化** `orderedDisplayed` / `firstFeatureCode` / `variantsMap`（依賴 `displayed`、`decisionsMap`）
5. **`HoldingCard` memo 比較鍵**：`(h, decision, target, sparkData, sparkFailed, isActive, variant)`；衍生計算（pctVal/pnlVal/srcLabel/ariaLabel）移入子元件
6. **`useMemo`** `topPriorityItems = globalPriorityList.slice(0,3)` 傳給 `HoldingsActionPriority`
7. **Filter chips 子元件常駐**：`FilterGroup` / `chipBtn` 移到模組層級；`activeTags` 用 `useMemo`
8. **Reversal 改 controlled state**（移除 `document.getElementById`）
9. **`Sparkline` `React.memo`**
10. **檢查並 `useMemo` `displayed = showAll ? sorted : sorted.slice(0,12)`**

### C. 驗證

11. **新增 `src/test/unit/freecheckup-holdings-perf.test.tsx`**：
    - lazy chunk < 2500ms
    - `React.memo` 驗證所有抽出元件
    - 靜態解析 `{tab==="holdings" && <Suspense>}` 結構
    - First mount latency < 800ms
    - memo 阻斷重渲：父 re-render 時 `HoldingCard` 不 re-mount

12. **跑全套**：`bunx vitest run` + `bunx playwright test e2e/freecheckup-card.spec.ts` + RWD 三斷點靜態檢查（560/390/380px，依強制清單）+ i18n 檢查

### 變更檔案

```text
新增：
  src/checkup/components/freecheckup/HoldingsTab.jsx
  src/checkup/components/freecheckup/HoldingsHero.jsx
  src/checkup/components/freecheckup/HoldingsQuotaMeter.jsx
  src/checkup/components/freecheckup/HoldingsFilterBar.jsx
  src/checkup/components/freecheckup/HoldingsReversalSection.jsx
  src/checkup/components/freecheckup/HoldingCard.jsx
  src/test/unit/freecheckup-holdings-perf.test.tsx
修改：
  src/pages/FreeCheckup.jsx        （-~1230 行；lazy/Suspense + useMemo）
  src/checkup/components/freecheckup/_validateProps.js
```

不動：業務邏輯、`useHoldings` / `useHoldingDecision` / `holdingsStore` / 計算式 / API / 樣式輸出。

### 注意事項

- `mem://architecture/checkup/inline-rendering-audit` 寫「FreeCheckup.jsx relies heavily on inline rendering—do not extract components」。但近期已陸續抽 events/daily/news tab 並通過全套測試，本任務延續同樣模式；過程嚴守 props 對等 + RWD 強制回歸，確保不破壞既有行為。
- 所有 `fontSize ≥ 32` 的 inline 樣式必須帶 `className` + `<style>` 媒體查詢（依核心規範）。