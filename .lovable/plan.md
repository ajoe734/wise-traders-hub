## 目標

在現有「One-Page Decision Sheet」上加入：(1) 情境模擬即時更新 upside / 進度條；(2) 三組視覺化（成本 vs 現價、區間位置、佔比貢獻）；(3) 兩種固定比例 PNG/PDF 匯出；(4) 顯示欄位開關與排序（同步左側主清單）。

---

## 1. 情境模擬區塊（Scenario Sandbox）

放在 TARGET 進度條與 THESIS 之間，可摺疊（預設收合，避免截圖噪音）。

**可調欄位**：
- `TARGET 價`（number，預設 = avgTarget(code)）
- `Δ 股數`（slider，-qty ~ +qty，step = max(1, qty/20)）
- `加碼價`（number，預設空白；填了才參與計算）
- `停損價`（number，預設空白；填了才畫風險線）

**即時推算**（純前端 useMemo）：
- 模擬均價 = (cost·qty + 加碼價·max(0,Δqty)) / (qty+max(0,Δqty))；減碼則 cost 不變
- 模擬數量 = qty + Δqty
- 模擬市值 = price × 模擬數量
- 模擬 upside% = (TARGET − price)/price × 100
- 模擬 PnL% = (price − 模擬均價)/模擬均價 × 100
- 模擬 risk:reward = (TARGET − price) / max(price − 停損價, ε)

**反映到 UI**：
- DECISION 卡右上加 `SIMULATED` 細徽章（橘色），action label 不變
- TARGET 進度條切換為「現價 vs 模擬 TARGET」並標記原 TARGET 為灰色刻度
- 數字欄位（PnL%、市值、TARGET·upside）切換為「模擬值 → 原值」雙行顯示
- 一鍵「重設」回原始假設

不寫回任何後端，狀態僅活在抽屜實例內，關閉清空。

---

## 2. 視覺化比較圖表

在脈絡層下方新增 `MiniChartsRow`，3 個窄圖橫排（≤560px 改直排）：

**A. 成本 vs 現價軸**：水平刻度，0 = cost，標記 price、TARGET、停損（若有）、加碼價（若有），用色點 + 細線；下方標 `+x.xx% / −x.xx%`。
**B. 區間位置條**：30D 區間 low–high 為灰色帶，price 為橘色刻度，cost 為灰色刻度，下方標 `近 30D 位置 xx%`（(price-low)/(high-low)）。
**C. 佔比甜甜圈**：donut 顯示「此標的占總市值 weightPct%」，外圈剩餘為灰；中心數字 `xx.x%`。模擬模式時內外圈分別顯示「原 / 模擬」雙環。

實作：純 SVG 內嵌，不引第三方圖表庫，沿用 WB tokens。

---

## 3. PNG / PDF 匯出

不再依賴 SHARE MODE 開關才能匯出。頂部操作列「分享」按鈕改為下拉選單：

- `1:1 IG（1080×1080 PNG @3x）`
- `16:9 簡報（1920×1080 PNG @3x）`
- `1:1 IG PDF`
- `16:9 簡報 PDF`
- `複製圖片到剪貼簿`（沿用目前剪貼簿邏輯，使用 1:1）

**渲染方式**：
- 為匯出建立一個離屏 `<div ref={exportRef}>`（`position:fixed; left:-9999px; pointer-events:none`），照目標比例 fixed width/height 渲染同一份內容（`<HoldingExportCard variant="square|wide" />`），確保截圖時不受瀏覽器寬度影響。
- `html-to-image` 用 `pixelRatio: 3` 取出 PNG；PDF 用 `jspdf` 把 PNG 以單頁鋪滿頁面（square = 210×210mm 自訂、wide = A4 橫向 297×167mm 置中）。
- 兩個版面共用同一個 `HoldingExportCard` 元件，差別只在 grid layout（square：兩欄；wide：三欄 + 左側大數）。
- 兩個版面固定顯示 `legendflow.tw` 浮水印 + 時間戳，不靠 SHARE MODE。
- 螢幕上的 SHARE MODE 仍保留作為「螢幕內預覽」，但匯出走離屏 canvas，使用者不必先進 SHARE MODE。

依賴：`bun add jspdf`（html-to-image 已安裝）。

---

## 4. 顯示欄位開關 + 排序

**抽屜頂部新增齒輪選單**（Popover）：
- Toggle：`THESIS`、`NEXT EVENT`、`區間 / 30D`、`成本 / 數量`、`TARGET 進度條`
- 偏好寫入 `localStorage('holdingPanel.prefs.v1')`，跨開關記憶
- 截圖匯出時忠實反映目前開關狀態

**排序**：抽屜頂部加 `排序：佔比 ▾ / 報酬 ▾`，點擊**同步寫回 HoldingsTab 的 `sortBy/sortDir`**（透過 `setSortBy`/`setSortDir` props，這兩個已在 props 中），所以左側主清單與抽屜 prev/next 都改變。

排序鍵：
- `weight`（依市值 / 總市值；無 totalVal 時 fallback 為 value）
- `return`（依 `pct`）
- 沿用既有的方向切換邏輯

---

## 5. 影響檔案（技術細節）

- `src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`
  - 拆出子元件：`ScenarioSandbox`、`MiniChartsRow`、`HoldingExportCard`、`ExportMenu`、`PrefsMenu`
  - 新增 state：`sim`（target/Δqty/buyMore/stop）、`prefs`（5 個 toggle）、`exporting`
- `src/checkup/hooks/useHoldingShareExport.ts`
  - 新增 `exportPng(node, {ratio, scale})` 與 `exportPdf(node, {ratio})`
  - 內部處理離屏 mount（接受 `renderInto: (host) => ReactNode` 或直接收已 mount 的 ref）
- `src/checkup/components/freecheckup/HoldingsTab.tsx`
  - 把 `sortBy/sortDir/setSortBy/setSortDir` 傳進 `HoldingsDetailPanel`（已有 hook，沿用）
  - 不改主清單渲染邏輯，僅確保排序 state 共用
- 新增 dep：`jspdf`

---

## 6. QA

- Vitest：`ScenarioSandbox` 公式單測（均價、PnL、upside、r:r）
- Playwright `e2e/holding-panel-export.spec.ts`：
  1. 開啟某檔抽屜 → 切換 prefs（隱藏 THESIS） → 截圖驗證消失
  2. 調整 Δqty 為 +qty → DECISION 卡出現 SIMULATED 徽章、TARGET 進度條變化
  3. 排序切到「報酬」→ 主清單第一筆與抽屜當前一致
  4. 匯出 1:1 PNG → 下載觸發（mock `a.click`）、檔名含 code/日期
  5. 匯出 16:9 PDF → blob 內容 mime = application/pdf
- 手機回歸：跑既有 `e2e/freecheckup-card.spec.ts`，確保抽屜在 380/390/560px 仍可滾動、不溢出

---

## 7. 不在此範圍

- 不引入歷史價序列（A 圖只用現有點，不畫 K 線）
- 不寫回後端假設（不持久化 sim 給其他人看）
- 不做多檔比較 PDF（單檔單頁）