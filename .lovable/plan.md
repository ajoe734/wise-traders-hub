## 目標
1. 防回歸：用 Playwright 鎖住「窄螢幕點卡片 → 展開新 HoldingsDetailPanel」這條路徑，避免又被分流回 legacy overlay。
2. 視覺回饋：窄螢幕展開 panel 時，明確告訴使用者「已展開完整圖表面板」，避免誤判 preview 沒更新。

## 變更內容

### A. Playwright 測試：`e2e/holdings-detail-panel-narrow.spec.ts`
- viewport：`{ width: 863, height: 900 }`（複現使用者情境）。
- 流程：
  1. `goto('/holding-checkup-demo')` → 自動寫入 `lf_force_demo='1'` 並導向 `/holding-checkup`。
  2. 等待持倉卡片牆出現（`[data-holding-code]` 或卡片第一張可見）。
  3. 點擊第一張持倉卡。
  4. 斷言：
     - `.holdings-detail-panel` 可見（不是 `display:none`）。
     - `ComparisonCharts` 區塊存在（用既有 `data-testid` 或新增 `data-testid="holdings-comparison-charts"`）。
     - `ExportMenu` 三組 segmented control（Format / Ratio / Resolution）皆可見。
     - 看不到 legacy overlay drawer（`text=返回列表` 或 `來自：` 文案應 **不可見**）。
     - 新增的窄螢幕提示文案可見（見 B）。
  5. 切換 Ratio = `16:9`、Format = `PDF`、Resolution = `High`，斷言 `localStorage.exportPrefs` 寫入正確。
- 不打真 download，只驗 UI / state；下載已由 `e2e/holdings-export-menu.spec.ts` 覆蓋。

### B. 窄螢幕視覺提示
在 `src/checkup/components/freecheckup/HoldingsTab.tsx` 渲染 `<aside class="holdings-detail-panel">` 時，於 panel 最上方插入一條僅 `≤1023px` 顯示的提示帶：

```
✓ 已展開完整圖表面板（成本/區間/佔比 + PNG·PDF 匯出）
```

- 用 className `holdings-detail-panel__narrow-hint`，在 `holdingsTab.css` 加：
  - 預設 `display:none`。
  - `@media (max-width: 1023px) { display:flex; }`。
- 樣式：細邊框、`WB.inkMute` 文字、`fontSize:11`、`letterSpacing:0.12em`、左側一個 ✓ 圖示，符合既有極簡風格（不引入新色）。
- 加 `data-testid="holdings-panel-narrow-hint"` 給 Playwright 斷言。

### C.（可選）卡片狀態文字
`HoldingCard.tsx` active 狀態下，窄螢幕在卡片底部追加一行極小字 `↓ 已展開於下方`（class 同樣只在 ≤1023px 顯示），讓使用者知道往下捲就看得到。若會動到 card 既有 layout 風險，可先省略只保留 B。

## 驗收
- `bunx playwright test e2e/holdings-detail-panel-narrow.spec.ts` 通過。
- 既有 `e2e/holdings-export-menu.spec.ts`、`e2e/freecheckup-demo-first-fold.spec.ts`、`e2e/freecheckup-card.spec.ts` 不退化。
- 手動 863px 重整 → 點卡片 → 看到提示帶 + ComparisonCharts + ExportMenu，不再出現「摘要／教學／風險」覆蓋層。

## 技術細節
- 既有 `HoldingsDetailPanel.tsx` 內 `ComparisonCharts` / `ExportMenu` 已是 named components；若 DOM 上沒有可靠 selector，會在 panel root、ComparisonCharts root、ExportMenu 三組 segmented control 上補 `data-testid`（純測試 hook，不改 layout）。
- 提示帶純 presentational，不影響 export 截圖內容（`exportRef` 指向的離屏 DOM 不包含此 hint）。
- 不改 `useHoldingShareExport`、不動 `holdingsDetailPanel.css` 現有規則，只新增提示帶相關 class。