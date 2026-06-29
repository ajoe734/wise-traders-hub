## Goal
新增寬螢幕（1280px）Playwright E2E，驗證 `/holding-checkup-demo` 點卡片後：
- 新版 `HoldingsDetailPanel` 顯示（包含 `ComparisonCharts` 與 `ExportMenu`）
- legacy overlay 文案（「返回列表」/「來自：」）**不出現**
- 窄螢幕專用提示帶（`holdings-panel-narrow-hint`）在寬螢幕**不顯示**

## Files
- **新增** `e2e/holdings-detail-panel-wide.spec.ts`
  - 對應現有 `e2e/holdings-detail-panel-narrow.spec.ts`，重用相同 testid：`holdings-detail-panel`、`holdings-comparison-charts`、`holdings-export-menu`
  - 三個案例：
    1. 點第一張持倉卡 → panel + ComparisonCharts + ExportMenu 都可見
    2. legacy overlay 文案（`返回列表`、`來自：`）斷言不可見
    3. `holdings-panel-narrow-hint` 在 1280px 應為 hidden（CSS media query 控制）
- **修改** `playwright.config.ts`：新增 project `desktop-holdings-detail-panel`
  - `testMatch: /holdings-detail-panel-wide\.spec\.ts/`
  - `viewport: { width: 1280, height: 900 }`

## 技術備註
- 沿用 `gotoWithRetry` helper（與 narrow spec 相同）
- 寬螢幕走 `.holdings-workbench` 兩欄 grid，detail panel 為 sticky 右欄；確認 `position: sticky` 由 CSS 預設提供，無需額外斷言
- narrow-hint 在 ≥1024px 由 `display: none` 隱藏，用 `toBeHidden()` 驗證
- 不動 component 程式碼，純測試新增

## 驗收
`bunx playwright test --project=desktop-holdings-detail-panel` 全綠。
