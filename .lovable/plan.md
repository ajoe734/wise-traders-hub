## 問題判定

目前「抽屜」其實存在兩套路徑：

1. 新版 `HoldingsWorkbench` 的 `HoldingsDetailPanel`：已經有 ROI 字級 E2E，但只驗到新版 panel 內的 `drawer-roi-main`。
2. `FreeCheckup.jsx` 內仍殘留舊版「持倉資料庫 Detail Drawer」：包含 `返回列表`、`來自：`、`DECISION`、`TARGETS`、tab bar、手機底部關閉條等舊設計。這就是十輪掃描沒抓到的漏網 bug，因為既有 E2E 只檢查新版抽屜「出現」，沒有強制掃完整 DOM、所有斷點與舊抽屜不得存在。

## 修復範圍

### 1. 移除舊版 drawer 路徑
- 在 `src/pages/FreeCheckup.jsx` 清掉殘留的 legacy drawer state、事件、tab、draft、swipe、sheet render 與相關未使用 import。
- 保留真正仍被新版流程使用的狀態與 helper，不做無關重構。
- 確保持倉卡點擊只走 `HoldingsTab -> HoldingsWorkbench -> HoldingsDetailPanel` 單一路徑。

### 2. 修正新版抽屜可能的 RWD 溢出
- 在 `src/checkup/components/freecheckup/HoldingsDetailPanel.tsx` 對價格軸、30D 走勢、佔比排名、決策履歷、操作列與頁腳導覽做硬性尺寸收斂。
- 將價格軸 SVG 文字避免超出抽屜邊界：針對邊界附近 label 改用 clamped anchor / hidden overflow 或 DOM overlay，不再讓 `目標 280` 這類文字被裁切或衝出 viewport。
- 手機寬度下收斂 top toolbar gap、字級、padding，避免右上控制列擠爆。
- 佔比排名內的股票名稱加 `minWidth:0`、ellipsis / overflow-wrap，避免長名稱撐寬。

### 3. 補齊抽屜 E2E 守門
新增或擴充抽屜專屬 E2E，覆蓋完整斷點：
- 320 / 375 / 390 / 414 / 560 / 768 / 863 / 1024 / 1280。
- 每個斷點打開持倉卡後檢查：
  - 只能存在新版 `[data-testid="holdings-detail-panel"]`。
  - 不得出現舊版字串：`返回列表`、`來自：`、`DECISION`、`TARGETS · 分析師目標價`、`摘要`、`教學`、`風險` legacy tab。
  - `documentElement.scrollWidth <= clientWidth + 1`。
  - 抽屜 bounding box 不超出 viewport。
  - 價格軸、30D 走勢、佔比、決策履歷、footer nav 內所有可見文字 bounding box 不超出 panel。
  - computed font-size 全面不超過 22px，不只 ROI。

### 4. 更新 Playwright projects
- 在 `playwright.config.ts` 加入抽屜完整 RWD project map。
- 保留既有 ROI 字級測試，但把新測試作為「抽屜整體」回歸，不再只量 ROI。

### 5. 驗證清單
實作後必跑：
- `bunx tsgo --noEmit`
- `bunx playwright test e2e/holdings-detail-panel-*.spec.ts`
- `bunx playwright test e2e/rwd-no-horizontal-scroll.spec.ts --project=rwd-320 --project=rwd-375 --project=rwd-414 --project=rwd-560 --project=rwd-768 --project=rwd-1023`
- 針對 320 / 390 / 809 / 1280 用 Playwright 截圖確認抽屜：價格軸不裁字、不橫向溢出、舊版 drawer 完全不存在。

## 完成標準

- 持倉看板只剩一套新版抽屜。
- 舊版抽屜內容與入口從 DOM / 測試 / 使用流程全數消失。
- 所有抽屜內容跨 320–1280px 不水平溢出。
- 字級上限守門從 ROI 擴大到抽屜主要內容。