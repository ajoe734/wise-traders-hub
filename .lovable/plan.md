## 問題

`HoldingsDetailPanel.tsx` §4.6 `RangeBand`（L934-978）的 30 日走勢圖中，代表現價的紅點 x 座標用「現價在 low/high 區間的百分比」計算，把**價格軸**誤當**時間軸**。結果：現價越接近 30 日低點，紅點越往左跑（截圖中現價 2293 靠近低點 2268，紅點被畫在最左側），與折線右端脫節。

## 修法

紅點語意是「時間軸最後一筆 = 現在」，應對齊折線的最右端點：

- **x**：固定 `100%`（或用 `spark` 最後一點的 index，`(len-1)/(len-1)*100`）。
- **y**：改用 `spark[spark.length-1]` 的值（等同 `price`，但確保與折線末端完全貼合，不會因浮點差飄開）換算，公式維持 `svgH - ((v - low) / (high - low)) * svgH`。
- **clamp**：保留 y 的 clamp，避免 spark 末值意外越界。
- **fallback**：若無 `spark` 或 `high === low`（除零），維持現行的「不渲染 sparkline 區塊」行為。

只改 `RangeBand` 內部座標計算，不動 DOM 結構、testid（`holdings-range-band-dot`）與樣式，避免影響現有 e2e（`holdings-price-axis-dot-shape.spec.ts`、`holdings-price-axis-dot-visual.spec.ts`）。

## 驗證

1. 手動：抽屜開 3443 創意，紅點應貼齊折線最右端末點，而非漂在左側。
2. 跑 `bunx playwright test e2e/holdings-price-axis-dot-shape.spec.ts e2e/holdings-price-axis-dot-visual.spec.ts` 確認不破。
3. 新增/更新一條 assertion：紅點 `left` 應 ≥ 容器寬度 95%（對齊末端）。
