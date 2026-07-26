
## 目標
改 `src/checkup/components/freecheckup/ChipsTrendChart.tsx`：
1. 刪除「播放／暫停」按鈕與 raf 播放邏輯（scrubber 拖曳保留）。
2. 刪除「1 日」視窗按鈕；視窗只留 5／20／60，預設 5。
3. **柱體恆為每日淨買賣**（紅正／綠負，跟截圖一致）；視窗切換只改變右下讀值（`N 日滾動淨買賣 ±X 張`）與 readiness caption，柱形不變。
4. 「分點集中度」模式同樣改為每日柱狀圖（值域 0–100，>70% 紅色），保留 70% 警戒虛線。
5. 保留 scrubber 圓點對齊柱體 + 當日 tooltip 讀值。

## 變更細節（單檔）

### A. 移除播放
- 刪 `playing / setPlaying / rafRef / handlePlay` 與播放 `useEffect`。
- 刪 render 中的 `<button data-testid="chips-trend-play">`。
- Scrubber `<input type="range">` 保留、`onChange` 直接 `setIdx(Number(...))`。

### B. 移除 1 日
- `type Window = 5 | 20 | 60`；`useState<Window>(5)`。
- 視窗按鈕陣列 `[5, 20, 60]`；auto-clamp fallback `[60, 20, 5]`，資料 < 5 時按鈕 disabled 並由 readiness caption 提示。

### C. 柱體恆為每日淨（方案 A）
- 新增 `daily = inst.map(r => ({ date: r.date, value: r.total_net, raw: r }))` —— **柱體資料源，與 `win` 無關**。
- `series`（供讀值／scrubber 用）：
  - inst：`value = rollingSum(totals, win)[i]`（跟現在一樣，但只用於右下讀值與 activePt tooltip）。
  - bsr：`value = concentration_ratio`，`daily` 與 `series` 相同。
- Render：
  - inst：對 `daily` map `<rect>`，`fill = v >= 0 ? UP : DOWN`，基準線 `yZero`。
  - bsr：對 `series` map `<rect>`，值域強制 0–100，`fill = v > 70 ? UP : WB.ink`。
  - 柱寬 `Math.max(1, (w - PAD_L - PAD_R) / N - 1)`。
  - 刪掉 `linePath` 與 `<path>` 折線區塊。
- Y 軸域：inst 用 `daily` 的 min/max（含 0）計算 `vMin/vMax`；讀值顯示的 rolling sum 只用在文字，不影響 Y 軸。
- 保留 bsr 70% 警戒虛線、`chips-trend-low-quality-dot` 空心圓（疊在對應日柱頂端）。

### D. Scrubber 游標
- `activeIdx` 沿用 `series.length` 為長度（每日一格）；虛線 + 圓點畫在 `xs(activeIdx), ys(daily[activeIdx].value)`（inst）或 `ys(series[activeIdx].value)`（bsr）。
- 右下讀值：
  - inst：左「`${win} 日滾動淨買賣`」、右 `fmtLots(series[activeIdx].value)`（rolling sum）。
  - bsr：左「Top15 買超集中度」、右 `${value.toFixed(1)}%`。

### E. Readiness / 空資料
- `currentReadiness` 保持原本查表（`institutional[String(win)]` / `bsr_concentration['5']`）。
- `validPts.length < 2` fallback：改成畫單一 `<rect>` 而非圓點，樣式與正式柱一致。

## 不變
- Hook / edge function / readiness payload schema 一律不動。
- testid：保留 `chips-trend-chart / -empty / -empty-hint / -readout / -scrubber / -low-quality-dot / -readiness-caption / -slot-filled / -slot-empty`。**刪除**：`chips-trend-play`。

## 測試調整
- `rg -l "chips-trend-play|1 日|windowDays.*1|win === 1" e2e src/test` → 修正斷言（移除播放鍵斷言、1 日按鈕斷言；rolling 讀值仍可斷言）。
- 現有 `e2e/holdings-range-band-*` 等與本檔無關者不動。

## 驗證
1. `tsgo` 過型別。
2. /holding-checkup 點卡片 → 籌碼面：確認無播放鍵、無 1 日、5/20/60 柱狀圖紅綠交錯、切「分點集中度」也是柱狀且 70% 警戒線在、拖 scrubber 圓點對齊柱頂、右下讀值同步變化。
3. 跑步驟 1 找到的受影響 spec。
