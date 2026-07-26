## 問題

`ChipsTrendChart` 目前柱體恆為每日淨買賣，5/20/60 只改右下讀值。切換視窗時圖完全沒變，但數字跳動，使用者無法理解「這個數字從哪來」。

## 修法（選項 A：高亮視窗區間）

改動集中在 `src/checkup/components/freecheckup/ChipsTrendChart.tsx`：

1. **視覺高亮**：以 scrubber 選取日（預設最新日）為終點，往前 W 根柱子為「視窗區間」。
   - 區間內柱子維持原本紅/綠飽和色。
   - 區間外柱子降至低透明度（約 `opacity 0.25`），讓「這段被加總」一眼可辨。
   - 區間背景加一層極淡底色 rect（`fill: rgba(0,0,0,0.03)`），強化邊界。

2. **讀值語意對齊**：右下 `readoutVal` 明確改為「視窗內加總」——即高亮 W 根柱子的總和，而非全序列的滾動加總結果。這樣圖與數字 1:1 對應。
   - `inst` 模式：顯示 `W 日累計淨買賣 = ±X 張`。
   - `bsr` 模式：因每根柱子是「當日集中度 %」不宜加總，改顯示 `W 日平均集中度 = X%`（區間內平均），保持與圖對稱。

3. **Scrubber 互動**：拖曳 scrubber 時，高亮區間跟著移動（終點 = scrubber 日、起點 = 終點往前 W-1 天），讀值同步更新。若 scrubber 位置不足 W 天（例如選到第 3 天但視窗 20 日），區間截斷到序列起點，讀值標註「（僅 N 日）」。

4. **視窗按鈕 disabled 條件保留**：資料不足 W 天時該按鈕仍 disabled。

## 技術細節

- 新增 `windowStart = max(0, scrubberIdx - W + 1)`、`windowEnd = scrubberIdx`。
- 柱子 render 時依 `i >= windowStart && i <= windowEnd` 決定 `opacity`。
- 移除現有 `rollingSum` 對讀值的使用；讀值改為 `sum(daily.slice(windowStart, windowEnd+1))`。
- Bsr 讀值改為 `avg(bsr.slice(windowStart, windowEnd+1))`。
- 保留 scrubber 黑點與虛線（對齊終點柱頂）。

## 測試

- 更新 `e2e/chips-section.spec.ts`：
  - 斷言切換 5→20 時，高亮柱數從 5 變 20（用 `data-window-active="true"` 屬性計數）。
  - 斷言讀值文字前綴由「5 日」變「20 日」，且數值改變。
- 視覺回歸 `e2e/chips-section-visual.spec.ts` 補一張 20 日高亮的 baseline。

## 不動的部分

- 播放鍵、1 日按鈕維持已移除。
- 柱體顏色規則（inst 紅正綠負、bsr >70% 紅）不變。
- 資料源與 `useTwChipsDetail` 不動。
