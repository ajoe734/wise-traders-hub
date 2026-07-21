## 問題定位

截圖顯示 `趨勢與歷史回放`：日期軸 07/17 → 07/21（5 天序列），選 `5 日` 滾動視窗，但整個 160px 高的 SVG 完全空白，只有底下 scrubber 上的黑點孤零零一個。

根因在 `src/checkup/components/freecheckup/ChipsTrendChart.tsx`：

- `rollingSum(arr, 5)` 只有 `i >= w-1`（即第 5 天）才回傳有效值，前 4 天都是 `NaN`。
- 序列剛好 5 天 → 只有 1 個有效點 → `linePath` 產生 `"M x,y"` 沒有任何 `L`，SVG 折線畫不出來。
- Bar 模式（1 日）沒事，但預設落在 5 日，使用者第一眼就是全白。
- `分點集中度` 模式在資料點不足 2 時同樣空白（單點無法連線）。
- `20 日`、`60 日` 按鈕在只有 5~10 天資料時可按下但永遠空白，無任何提示。

## 修正範圍（`ChipsTrendChart.tsx` 單檔）

1. **視窗自動 clamp**  
   計算 `series` 前先偵測 `inst.length`。若目前 `win > inst.length`，自動退回到最大可用視窗（`min(win, max(1, inst.length))`），並在 useEffect 中同步 setState，避免每次重繪都 clamp。

2. **`SegBtn` 視窗按鈕依資料量 disable**  
   `1/5/20/60` 每個按鈕 props 加 `disabled = wv > series.length`；disabled 時降低透明度、`cursor: not-allowed`、不觸發 onClick。避免使用者又點到 60 日又是白畫面。

3. **有效點 < 2 的 fallback 渲染**  
   在 SVG 內判斷 `validPts.length`：  
   - `0` 個 → 顯示置中「— 尚無資料 —」`<text>`。  
   - `1` 個 → 畫一個 r=4 的圓點（顏色沿用 UP/DOWN/ink 規則）＋ 置中提示「資料點不足以繪出 {win} 日滾動線，至少需要 {win} 個交易日」。  
   - `≥ 2` → 維持原本 line/bar 行為。  
   readout 區塊繼續顯示該點數值（沿用現有邏輯）。

4. **`分點集中度` 模式相同 fallback**  
   單點時畫圓點＋提示「僅 1 個交易日資料」；讓使用者知道是資料量問題不是壞掉。

5. **X 軸日期標籤在 fallback 也保留**  
   即使沒畫折線，`series[0].date` 與 `series[last].date` 仍要顯示，維持現在截圖那樣的日期骨架。

## 不動的東西

- `useTwChipsDetail` / edge function / DB — 這是純呈現層問題，資料本身沒錯。
- 樣式 tokens、字體、UP/DOWN 顏色維持不變。
- Scrubber / 播放邏輯不變。

## 驗證

- 手動：`/holding-checkup` 打開任一台股抽屜，切 `1/5/20/60` 四個視窗，每個都應有可視內容（bar / line / 單點＋提示 / disabled）。
- 加一個 unit test（vitest）給 `rollingSum`＋一個 render smoke test 驗證 `validPts.length === 1` 時 DOM 有 `data-testid="chips-trend-empty-hint"`。
