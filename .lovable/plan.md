# 抽屜黑點變橢圓 + 滾動不下去 — 根因處理

## 已驗證的根因（Playwright 實測）

### Bug 1：「現價」黑點變扁橢圓（截圖裡的元凶）
`HoldingsDetailPanel.tsx` PriceAxis 與 RangeBand 的 SVG 都用 `preserveAspectRatio="none"`（為了讓 tick 位置可用 `%` 對齊），但裡面直接放了 `<circle>`：

- `PriceAxis`：`viewBox="0 0 100 70"` + `<circle r={4}>`
- `RangeBand`：`viewBox="0 0 100 30"` + `<circle r={2.5}>`

`<circle>` 沒有 `vector-effect="non-scaling-stroke"` 對 fill 也無效——**填色圓形會被 X/Y 非等比拉伸**。實測圓點在不同寬度變成：

| 寬度 | 現價圓點實際尺寸 |
| ---- | ---- |
| 390px | 29 × 8 px（橢圓）|
| 768px | 58 × 8 px |
| 1280px | 99 × 8 px（幾乎變一條線）|

正是使用者截圖看到「當初設計是圓點，實際是黑色橢圓」的原因。RangeBand 的 30D 紅點同樣中招。

### Bug 2：抽屜滾動不下去
`components/ui/sheet.tsx` 的 `side="right"` variant 是 `h-full`，等同 `100vh`。iOS Safari / 動態 URL bar 下 100vh **含瀏覽器 chrome 高度**，抽屜實際渲染比可視區高 → 底部內容被瀏覽器 UI 蓋住無法滾到。

`HoldingsWorkbench.tsx` 用的是共用的 `SheetContent`，只加了 `overflow-y-auto`，沒有覆寫高度上限，也沒吃 `dvh`。桌面 1280×900 實測 `maxScroll=39`（勉強夠），一到 iPhone 尺寸就會把 `情境模擬 / 論點筆記 / 研究筆記 pager` 卡在瀏覽器 URL bar 後面。

## 修法

### 1. `src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`

**PriceAxis (L863–896)**：把「現價圓點」從 SVG `<circle>` 抽出來，改用 HTML 絕對定位 `<div>`（跟現有的 label overlay 同一層），寬高用真實 px（8×8 圓）。SVG 只保留水平基準線與 tick 垂直短線（都是 stroke，用 `vector-effect="non-scaling-stroke"` 保 1.5px）。

**RangeBand (L919–932)**：同樣手法，把 SVG 內 `<circle>` 移到 SVG 外的 HTML overlay `<div>`（5×5 圓，用 `posPrice%` 定位），SVG 只留 polyline。

留下顯眼註解，說明「preserveAspectRatio=none 的 SVG 內禁止使用 fill 幾何形狀」，避免下一輪打磨又踩回來。

### 2. `src/components/ui/sheet.tsx`

`side: right` / `left` 的 variant 補上 `max-h-[100dvh]`（`h-full` 保留，dvh 舊瀏覽器 fallback 100vh 不會壞）。這是共用 primitive，只加上限、不改行為，其他用途仍然 100%。

### 3. `src/checkup/components/freecheckup/HoldingsWorkbench.tsx`

`SheetContent` className 追加 `!h-[100dvh] max-h-[100dvh]`（強制 override，因 sheet.tsx 的 `h-full` 用 tailwind class），並在 inline style 補 `WebkitOverflowScrolling: 'touch'` 保留（已有）。

## 回歸驗證

1. Playwright 已抓到「橢圓」數據，在 3 個斷點斷言 `dot.getBoundingClientRect().width === dot.height`（±0.5px），加進 `e2e/holdings-detail-panel-visual-snapshot.spec.ts` 或新增 `e2e/holdings-price-axis-dot-shape.spec.ts`。
2. iOS 尺寸滾動：在 390×667 / 390×844 兩個 viewport 打開抽屜，斷言 `panel.scrollHeight - panel.clientHeight === maxScroll`（可完整滾到底），並截圖比對底部 `研究筆記` pager 可見。
3. `bunx tsgo --noEmit` 型別檢查。

## 不動的東西

- PriceAxis 標籤定位／臨界 clamp（`labelPos` 8~92%）不改，避免又動到已修好的重疊問題。
- SheetContent 只加高度上限，不重寫動畫／變體。
- `holdings-detail-panel` `data-testid` 與 body 結構不動，現有 15+ 支 e2e spec 全保留。
