# 持股看板 — 剩餘優化盤點

掃完 `HoldingsTab.jsx`（729 行）、`HoldingCard.jsx`（376 行）、`HoldingsDetailPanel.jsx`（236 行）與 `FreeCheckup.jsx` 對應的 `<HoldingsTab .../>` 注入區（76 個 props），歸納還能做的優化如下。

---

## A. Props 介面瘦身（最高 ROI）

**現況**：`HoldingsTab` 接 **76 個 props**，3300+ 行的 `FreeCheckup.jsx` 一字排開傳下去。任何上游 state 變動都會讓整個 tab re-render，`memo()` 等同失效。

- **A1 拆 props 為 5 個 context 物件**：`themeCtx`（C/alpha/WB/wbTone）、`quotaCtx`、`filtersCtx`（search/decision/thesis/urgency/conflict/pnl/strategy + setters）、`sortCtx`、`workbenchCtx`（displayed/sorted/orderedDisplayed/variantsMap 等）。讓 `HoldingsTab` 簽名降到 ~10 個 props。
- **A2 把 filter/sort state 移入 `holdingsStore` 或新建 `useHoldingsUiStore`**：`searchQ`/`filterDecision`/…/`sortBy`/`sortDir`/`viewMode`/`showAll`/`sortMenuOpen` 都是純 UI state，目前住在 `FreeCheckup.jsx`，每次打字都觸發整頁 re-render。搬進 Zustand 後 `HoldingsFilterBar` 自己訂閱 slice。

## B. 子元件抽出（HoldingsTab 還有 4 段 inline）

`HoldingsTab.jsx` 剩 4 段 ≥60 行的 inline JSX 可抽：

- **B1 `HoldingsUploadSummary.jsx`**（L87-133，~50 行）— 上傳結果橫幅。
- **B2 `HoldingsEmptyState.jsx`**（L284-401，~120 行）— 3 步教學 + STEP 圖示 + 主 CTA。
- **B3 `HoldingsNoMatchState.jsx`**（L402-450，~50 行）— 篩選無結果 + 一鍵清除。
- **B4 `HoldingsFooterBar.jsx`**（L514-617，~100 行）— SORT BY 下拉 + grid/list 檢視切換 + sortMenu portal。

抽完後 `HoldingsTab.jsx` 可從 729 行降到 ~250 行。

## C. Render 效能

- **C1 `HoldingCard` 補 `memo` + props 簽名穩定化**：目前 `HoldingsTab` 每 render 都重新生成 `renderCard` closure，搭配 76 props 上游污染 → quote tick 1 秒一次重畫所有卡。需確認 `HoldingCard` 已 `memo`，並用 `useCallback` 穩定 `onSelect`/`onOpenDrawer`。
- **C2 虛擬化卡片牆**：當 `sorted.length > 30` 時改用 `react-window` 或自實作 `IntersectionObserver` 分批掛載（首屏只渲 12，捲動到再掛）。
- **C3 Sparkline 延遲渲染**：把 `Sparkline` 包進 `LazyOnVisible`，未進視窗的卡只渲佔位 `<svg>`，省 SVG path 計算。

## D. CSS / RWD

- **D1 把 `<style>{...}` 抽到 `src/checkup/styles/holdingsTab.css`**：L620-727 共 108 行內聯 CSS，每次 mount React 都插入 `<style>` tag。改成靜態 CSS 檔由 Vite 一次注入，並可走 PostCSS 壓縮。
- **D2 排序工具列無障礙**：L198-220 的排序按鈕缺 `role="tablist"` / `aria-pressed`，鍵盤導覽會跳；A11y QA 會抓到。

## E. 一致性 / 健壯性

- **E1 `setTab` fallback 空守**：B2/B4 都用 `setTab && setTab('trade')`，但 `HoldingsTab` 已宣告 `setTab` 為必要 prop（`_validateProps.js` 可加 schema 檢查）。統一補進 prop schema。
- **E2 `expandedDecision` 在 store**：目前由 `FreeCheckup` 控管 + `setExpandedDecision` 透傳，建議搬進 `brainStore`（已有 `expandedStock`），跟現有持股展開狀態統一。

---

## 技術細節

### A1 範例：context 注入
```jsx
// FreeCheckup.jsx
<HoldingsContext.Provider value={{ theme, quota, filters, sort, workbench }}>
  <HoldingsTab isDemo={isDemo} setTab={setTab} navigate={navigate} />
</HoldingsContext.Provider>

// HoldingsTab.jsx
const { theme: { C, alpha, WB, wbTone }, quota, filters, sort } = useContext(HoldingsContext);
```

### C2 範例：簡易視窗化
```jsx
const [visibleCount, setVisibleCount] = useState(12);
useEffect(() => {
  const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisibleCount(c => Math.min(c + 12, orderedDisplayed.length)));
  if (sentinelRef.current) io.observe(sentinelRef.current);
  return () => io.disconnect();
}, [orderedDisplayed.length]);
```

### 驗收
- 跑 `bunx vitest run src/test/unit/freecheckup-tab-perf.test.tsx` — cold load 預期再降 30%（從 ~3s → ~2s）。
- 跑 `bunx playwright test e2e/freecheckup-card.spec.ts` — 12 baseline 全綠。
- 跑 `scripts/check-freecheckup-rwd.mjs` 與 i18n script。
- 手機 560/390/380 三斷點手動截圖回歸（依 mem 規範）。

---

## 建議順序

1. **A2 + A1**（最大效能拉升，動最少視覺）
2. **B1-B4**（純結構搬家，不改邏輯）
3. **C1-C3**（卡片牆順滑度）
4. **D1-D2 + E1-E2**（收尾）

要我從哪一塊開工？或先做整包 A+B？
