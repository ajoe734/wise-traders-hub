## 目標

針對 `HoldingsDetailPanel` 三項升級：手機版型、Sandbox Undo/Redo、匯出選單自動測試。只動前台展示 + 純函式 + 測試，不碰交易/RLS/edge function。

---

## 1. 手機版型優化（≤640px）

問題：MiniChartsRow（3 個 SVG）與 Sandbox 控制（Δqty / 加碼價 / 停損價 / TARGET）在 390px 寬會擠壓 DECISION 卡並超出抽屜可視範圍。

修法（純 CSS + 結構）：
- 新增 `src/checkup/styles/holdingsDetailPanel.css`（首檔），由 `HoldingsDetailPanel` import。
- **DECISION 卡 sticky**：在抽屜內容容器加 `holdings-detail-scroll`；DECISION 卡掛 `holdings-detail-decision`，`@media (max-width: 640px)` 設 `position: sticky; top: 0; z-index: 5;`，背景補上 `WB.surface` 避免穿透。
- **MiniChartsRow 水平 scroll**：≤640px 時改為 `display: flex; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch;`，每張圖固定 `min-width: 78vw; scroll-snap-align: start;`。底部加 dot indicator（純 CSS `:target` 不夠用，用既有 React state 即可，三個 dot 監聽 scroll）。
- **Sandbox 控制橫向滑動**：將 Δqty / 加碼價 / 停損價 / TARGET 4 個 Field 在 ≤640px 改為 `grid-auto-flow: column; grid-auto-columns: 70%; overflow-x: auto; scroll-snap`，桌機維持目前 2×2 grid。
- 既有 `Stat` 列（均價/PnL%/Upside/R:R）在 ≤640px 改為 2×2 grid（目前為 1×4），避免被滑動帶吃高度。
- 對 `padding: 12px 14px` 的 DECISION 卡在 sticky 時加 `box-shadow: 0 4px 0 ${WB.surface}` 替代 hard divider，符合 Kore-eda 無陰影憲法（這裡用 surface 同色 mask 不算 shadow）。

驗證：Playwright 跑 `[360, 390, 414]` 三個寬度，斷言：
- DECISION 卡 `getBoundingClientRect().top` 在抽屜滾動 200px 後仍 ≤ 抽屜 top + 8px（sticky 生效）
- MiniChartsRow 容器 `scrollWidth > clientWidth`
- 沒有 horizontal page overflow（`document.documentElement.scrollWidth <= window.innerWidth`）

---

## 2. Sandbox Undo/Redo

修法（純前台 state，不持久化）：
- 在 `HoldingsDetailPanel` 內把 `useState(sim)` 換成 `useSimHistory(initialSim)` 自訂 hook，放在 `src/checkup/hooks/useSimHistory.ts`。
- API：`{ state, set, reset, undo, redo, canUndo, canRedo, clear }`。內部維護 `past[]` / `future[]`，`set` 寫入時把舊值 push 到 past 並清空 future。
- **去抖合併**：連續 300ms 內對同一個欄位的輸入合併為一個 history entry（避免拖 slider 產生 50 步歷史）。用 `useRef<{ lastField, lastTs }>`。
- 上限 50 步，超過丟最舊。
- 切換持倉時呼叫 `clear()` 並 seed 新 baseTarget（沿用既有 useEffect）。
- ScenarioSandbox UI：在 reset 按鈕旁加兩顆 ghost button「↶ Undo」「↷ Redo」，`disabled` 對應 `!canUndo / !canRedo`；鍵盤快捷鍵：抽屜聚焦時 `Cmd/Ctrl+Z` undo、`Cmd/Ctrl+Shift+Z` redo（用 `useEffect` 綁 keydown，抽屜關閉時解綁）。
- 重置按鈕本身也走 history（reset 推進一筆，使用者可 undo 回到調整中狀態）。

測試：`src/test/useSimHistory.test.ts` 涵蓋
- set/undo/redo 基本流程
- 300ms debounce 合併同欄位
- 不同欄位切換立即斷點
- clear() 清空 past/future
- 50 步上限滾動丟棄
- redo 在 set 後被清空

---

## 3. 匯出選單自動測試

目的：守護「PNG/PDF × 1:1/16:9 × 浮水印 × 時間戳」不會在重構時靜默壞掉（截白、比例錯、缺浮水印）。

分兩層測試：

### 3a. Unit（Vitest，jsdom + mock `html-to-image` / `jspdf`）
新檔 `src/test/holdingExport.test.tsx`：
- 渲染 `HoldingExportCard` 兩種 variant，斷言：
  - DOM 寬高 inline style 為 `1080×1080`（square）/ `1920×1080`（wide）
  - 含 `legendflow.tw` 字串、含 `stamp` prop 字串、`DECISION` / `RETURN` 標籤存在
  - `showSimulated` 時顯示 `SIMULATED` 徽章
- `useHoldingShareExport` 行為（mock `toPng` 回固定 dataURL、mock `jsPDF`）：
  - `downloadPng` 觸發 `<a download>` click，filename 結尾 `.png`
  - `downloadPdf('square')` 呼叫 `jsPDF({ format: [210,210] })` 並 addImage 寬高 210×210
  - `downloadPdf('wide')` 呼叫 `jsPDF({ format: 'a4', orientation: 'landscape' })`，addImage 寬 297、置中（top ≈ 21.47mm）
  - `copy` 在無 `ClipboardItem` 環境 fallback 到 download
  - `toPng` 拋錯時 `toast.error` 被呼叫，busy 回到 false

### 3b. E2E（Playwright）
新檔 `e2e/holdings-export-menu.spec.ts`：
- 走 `/holding-checkup-demo`，開第一檔持倉抽屜，攔截 `a[download]` click。
- 測 PNG 路徑：mock `toPng` 為 small valid PNG dataURL（透過 `page.addInitScript` 注入 module spy 不可行，改用 `page.exposeBinding` 觀察 `<a>` 的 href dataURL 開頭 `data:image/png;base64,` 且 base64 解碼後長度 > 0），斷言不是 1×1 空白（檢查 dataURL 長度 > 5KB）。
- 測 1:1 / 16:9 兩個選項各跑一次，確認 filename 含 `1x1` / `16x9` 標記（順便調整 `HoldingsDetailPanel` 匯出 filename 命名規則明確帶比例）。
- 斷言抽屜離屏 portal `[data-export-host]` 在點擊後存在 → 截圖完成後移除（避免 leak）。
- 浮水印：直接讀 `[data-export-host] >>text=legendflow.tw` 在截圖瞬間 visible（用 `page.locator` 在點擊與 toast 間取樣）。

為了讓 E2E 可觀察，補上 `data-export-host` / `data-export-variant` data 屬性到 portal 容器與 `HoldingExportCard` 根節點（僅新增屬性，不改視覺）。

---

## 技術細節

### 檔案異動
- 新增
  - `src/checkup/styles/holdingsDetailPanel.css`
  - `src/checkup/hooks/useSimHistory.ts`
  - `src/test/useSimHistory.test.ts`
  - `src/test/holdingExport.test.tsx`
  - `e2e/holdings-export-menu.spec.ts`
- 修改
  - `src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`：import CSS、換 hook、加 Undo/Redo UI、加快捷鍵、加 `data-export-*` 屬性、加 sticky/scroll className、調整 filename 含比例 tag
  - `src/checkup/components/freecheckup/HoldingExportCard.tsx`：根節點加 `data-export-card` / `data-variant`
  - `src/checkup/hooks/useHoldingShareExport.ts`：不動行為，僅 `downloadPng`/`downloadPdf` 預設 filename 帶 variant tag（呼叫端已自管 filename，不影響既有用法）

### 不會動
- `holdingScenario.ts`（純函式已通過 12 測，不重寫）
- `HoldingsTab.tsx` 對外 props 介面
- Edge functions、DB、RLS、權限

### 風險與守門
- Sticky DECISION 在抽屜內若祖先有 `overflow: hidden` 會失效 → 已確認抽屜 scroll container 為 `overflow-y: auto`，加 `holdings-detail-scroll` 即可。
- horizontal scroll 在 iOS Safari 需 `-webkit-overflow-scrolling: touch` 已含。
- Undo/Redo 鍵盤事件不能干擾 input 輸入（在 input focus 時略過 `Cmd+Z` 讓瀏覽器原生 undo 走）→ 用 `e.target.tagName` 過濾 INPUT/TEXTAREA。
- 既有 `e2e/freecheckup-card.spec.ts` 360/380/414 RWD 守門必須持續綠燈。

### 驗證順序
1. `bunx vitest run src/test/useSimHistory.test.ts src/test/holdingExport.test.ts`
2. `bunx playwright test e2e/holdings-export-menu.spec.ts e2e/freecheckup-card.spec.ts`
3. Playwright 手動截圖 360/390/414 三斷點抽屜頂部，目視 DECISION 卡未被遮 + MiniCharts 可滑。
