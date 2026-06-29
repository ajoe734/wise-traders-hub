## 目標

1. 把現有的小型 MiniChartsRow（3 張 90px 圖）升級為**截圖友善的比較圖表版面**：成本 vs 現價、30D 區間位置、佔比貢獻三圖加大、加註解、加副標數據。
2. 匯出選單跳脫「下拉清單一鍵 = 一個比例 × 一個格式」舊模式，改為**有狀態的設定面板**：比例 / 格式 / 解析度三段選擇，並把上次選擇寫進 localStorage，下次打開預選。
3. Demo 路徑（`/holding-checkup`、`/holding-checkup-demo` 未登入訪客）必須同樣可看到新圖表，並能完整跑匯出流程。

---

## 範圍與檔案

| 檔案 | 變更 |
|---|---|
| `src/checkup/components/freecheckup/HoldingsDetailPanel.tsx` | 拆掉 `MiniChartsRow` 換成 `ComparisonCharts`；改寫 `ExportMenu` UI + 加 `loadExportPrefs/saveExportPrefs` |
| `src/checkup/components/freecheckup/HoldingExportCard.tsx` | 在 square / wide 兩版面嵌入同款比較圖表，確保截圖視覺一致 |
| `src/checkup/hooks/useHoldingShareExport.ts` | `downloadPng/downloadPdf` 接受 `pixelRatio` 覆寫；PDF 內部也吃同一倍率 |
| `src/checkup/styles/holdingsDetailPanel.css` | 新比較區塊 RWD（≥768 三欄、560–768 兩欄、≤560 單欄 + 橫向滑動） |
| `src/checkup/components/freecheckup/demoData.js`（或對應檔） | 補齊 demo 持倉的 `cost`、`sparkData30D`，確保 demo 三圖皆可渲染 |
| `src/test/holdingExport.test.tsx` | 新增測試：prefs persist、resolution 對應 pixelRatio、PDF 比例正確 |
| `e2e/holdings-export-menu.spec.ts` | 補上：未登入 `/holding-checkup-demo` 走完匯出流程 + reload 後預設值留存 |

---

## 1. ComparisonCharts（取代 MiniChartsRow）

三張卡片，每張高 ≈ 160px（原 90px），統一 `ChartFrame` 並加上：

```text
┌──── 成本 → 現價 ────┐ ┌──── 30D 區間位置 ────┐ ┌──── 佔比貢獻 ────┐
│  ▓▓▓▓ cost  92.40   │ │  ├─●──┼────●──┤      │ │   ◐ 12.4%       │
│  ▓▓▓▓▓▓ now 108.20  │ │  Low  cost   price   │ │   top3 條形圖   │
│  ▲ +17.1%   target  │ │  High  108.20        │ │   現倉 vs 其餘  │
│  --- stop  buy      │ │  位置 68%            │ │                  │
└──────────────────────┘ └───────────────────────┘ └──────────────────┘
```

- **CostVsPrice**：橫向雙條（cost / price），上下對齊，標出差額 + 變化%，目標/停損/加碼用細直線標在同一座標上。
- **RangePosition**：保留現有水平軸但加長到 18px 高、加 cost/price 雙標籤、附 30D 高低中位輔助線。
- **WeightContribution**：donut 在左、右側列出本檔 vs 前 N 大持倉的水平條（取 `orderedDisplayed` 前 3 筆 + 「其他」），讓截圖直接帶出「這檔在組合裡的位置」。

`prefs.showCharts` 控制顯示；舊 key 相容（已存在）。

---

## 2. ExportMenu 改版 + 設定記憶

新 localStorage key `holdingPanel.export.v1`，schema：

```ts
{
  format: 'png' | 'pdf',          // 預設 png
  ratio:  'square' | 'wide',      // 預設 square
  resolution: 'std' | 'high' | 'print',  // 對應 pixelRatio 2 / 3 / 4，預設 high
}
```

選單版面（取代現在的一鍵清單）：

```text
┌─ 匯出 ──────────────────────────┐
│  比例    [ 1:1 ] [ 16:9 ]       │
│  格式    [ PNG ] [ PDF ]        │
│  解析度  [ 標準 ] [ 高 ] [ 印刷 ]│
│                                  │
│  ▌ 立即匯出 (1080² · PNG · 3x)  │
│  └ 複製到 1:1 PNG 到剪貼簿       │
│  └ 螢幕預覽 SHARE MODE          │
└──────────────────────────────────┘
```

- 三組為 segmented control（單選），任何變更即時 `saveExportPrefs`。
- 主按鈕標籤動態反映當下設定（如 `2160² · PNG · 4x`）。
- 「複製到剪貼簿」維持 1:1 PNG 固定行為，方便分享貼文。
- `runExport(variant, kind, { pixelRatio })` 帶第三參數，沿用既有離屏渲染流程。

`useHoldingShareExport`：
- 新增第三參數可覆寫 `pixelRatio`；PDF 路徑同步把 `pixelRatio` 傳給內部 `render`，避免 PDF 永遠是 3x。
- 解析度對照：std=2 (≈1080)、high=3 (≈1620)、print=4 (≈2160)。

---

## 3. HoldingExportCard 帶圖表

目前匯出卡只有大數字 + 文案。把 ComparisonCharts 的精簡版（CostVsPrice + RangePosition + WeightDonut）嵌進兩個版型：

- `square`：底部 320px 高一行，三欄等寬。
- `wide`：右側資訊欄下方加同樣三欄，但卡片更扁平（無 ChartFrame 邊框，用空白做分隔）。

確保截圖即帶圖，符合「資訊與美感一致」需求。

---

## 4. Demo 同步

`/holding-checkup` 與 `/holding-checkup-demo` 都走 `FreeCheckup.jsx → HoldingsTab → HoldingsDetailPanel`，元件層變更自動覆蓋。但要：

- 檢查 demo 持倉資料有沒有 `cost` 與 `sparkData30D`；若缺少導致 `CostVsPrice` / `RangePosition` 顯示「資料不足」，補進 demo seed。
- 匯出 PNG/PDF 是純前端 `html-to-image` + `jspdf`，未登入訪客也能用，不需 backend，無 RLS 風險。

---

## 5. 驗證（不准偷懶）

- Vitest：
  - `holdingExport.test.tsx` 新增 → ① ExportPrefs 寫入 localStorage、② resolution 'print' 帶到 `toPng` pixelRatio=4、③ PDF 'wide' 鋪 16:9。
- Playwright (`e2e/holdings-export-menu.spec.ts`)：
  - 已登入：切到 print + PDF + 16:9 → 下載檔名含 `16x9.pdf` → reload 後選單預設仍是 print/PDF/16:9。
  - **未登入訪客**：`/holding-checkup-demo` 開抽屜 → 確認 ComparisonCharts 三張都渲染（不出現「資料不足」） → 走一次 PNG 1:1 匯出，攔截 download 驗檔名 + dataURL 非空。
- 手機 RWD：560px / 380px 截圖確認 ComparisonCharts 改單欄、ExportMenu segmented 不爆版。
- 三斷點 + 中英文雙語回歸（套用 [FreeCheckup 手機回歸清單](mem://qa/checkup/freecheckup-mobile-regression-checklist) 與 [FreeCheckup i18n 回歸](mem://qa/checkup/freecheckup-i18n-regression)）。

---

## 不做

- 不動 `HoldingsTab.tsx` 左側清單版面、排序邏輯、`useSimHistory`。
- 不改 backend / RLS / edge function（純前端視覺與 localStorage）。
- 不加新依賴；繼續使用 `html-to-image` + `jspdf`。
