# Phase 5: 上傳成交 + 交易日誌優化

## 現況審查

`useTradeCaptureRuntime.js` 與 `TradePanel.jsx`、`LogPanel.jsx` 已能跑通主流程（多檔批次、活躍上傳切換、memo 步驟、目標價同步），但有 **6 個明確坑**：

| # | 問題 | 影響 | 位置 |
|---|------|------|------|
| 1 | `parseShot` 直接 `JSON.parse(clean)`；AI 回 markdown wrapper 或截斷時整張作廢 | 重試浪費配額，使用者要重拍 | useTradeCaptureRuntime.js:267-271 |
| 2 | 沒有檔案大小／格式檢核；20MB+ HEIC 直接送 base64 給 edge function | 送出後才超時，體驗差 | useTradeCaptureRuntime.js:82-109 |
| 3 | 沒有 demo 守門：訪客也能打 `checkup-analyze` | 違反 [Demo 模式 memory](mem://qa/checkup/demo-mode-behavior) | useTradeCaptureRuntime.js:249 |
| 4 | `submitMemo` 寫入 holdings 後立即 `removeUpload`，無 undo | 誤觸即遺失 memo 答覆 | useTradeCaptureRuntime.js:339-354 |
| 5 | `LogPanel` 用 `log.id`（時間戳）排序、買賣顏色寫死 `C.up/C.down` 紅綠 | 與 [Holdings 單色橘 PnL 憲法](mem://style/holdings/monochrome-orange-pnl) 不直接衝突，但買賣 badge 仍是紅綠對撞，未統一視覺 | LogPanel.jsx:33-38 |
| 6 | `tradeLog` 雲端同步靠 FreeCheckup 整檔 save，沒有失敗緩衝（與 Phase 4 analysis 失敗 retry 不一致） | 寫入後若 cloud 失敗，下次刷新可能掉資料 | FreeCheckup.jsx:1247 |

## 變更計畫

### 1. parseShot JSON 容錯（沿用 Phase 4 aiJsonRepair）
- `useTradeCaptureRuntime.js`：用 `extractFirstJsonObject`（已存在 `src/checkup/lib/aiJsonRepair.js`）取代 `JSON.parse(clean)`，失敗時保留原始 raw text 給 `parseErr` debug。

### 2. 檔案前置檢核
- 在 `enqueueFiles` 前濾掉：
  - 非 `image/*`（已有）
  - `file.size > 8 * 1024 * 1024`（8MB 上限，與 base64 後 ~11MB 對齊 edge function payload）
  - HEIC（`image/heic`, `image/heif`）→ 提示「請轉成 JPG/PNG」
- 並上限同時排隊 **10 張**，超出顯示 toast。

### 3. Demo 守門
- `parseShot` 前讀 `useCheckupMode().isDemo`：訪客直接 `flashSaved('🔒 訪客模式不能上傳成交，請先用 Line 登入')`，不打 edge function。
- `processFiles` 入口同步擋下，避免上傳後再失敗。

### 4. 撤銷誤刪（最近一次 submitMemo undo）
- 新增 `lastSubmitSnapshotRef`：保留最近一次 `submitMemo` 寫入前的 `holdings/tradeLog` snapshot 與 `processedUploadId`。
- TradePanel 在 `flashSaved` toast 旁顯示「↺ 撤銷」按鈕（5 秒視窗），點擊還原 store 與重建上傳。

### 5. LogPanel 視覺對齊
- 買賣 badge 改為 **單色橘**（`C.accent`）+ 文字「買 / 賣」，去掉紅綠對撞；保留方向箭頭區分（與 Holdings 憲法一致）。
- 排序用 `${date} ${time}` lexical（YYYY/MM/DD），避免依賴 `id` 數字精度。
- 空狀態保留現行 Kore-eda 風格。

### 6. tradeLog 雲端 retry buffer
- 沿用 `dailyAnalysisRuntime.js` 的 ring buffer 模式，新增 `src/checkup/lib/tradeLogPersist.js`：
  - `persistTradeLogToCloud(payload)` 失敗時寫 `localStorage.checkup:pendingTradeLog`（max 5）。
  - `flushPendingTradeLogs()` 在 `useTradeCaptureRuntime` mount 時自動觸發。
- FreeCheckup.jsx:1247 的 save effect 改走此函式。

## 不做的事
- 不重構 `useTradeCaptureRuntime.js` 整體結構（420 行但職責清楚，硬切會增加 props drilling）。
- 不改 PARSE_PROMPT（屬於 AI 行為調整，獨立議題）。
- 不引入新的 OCR fallback（成本過高）。

## 受影響檔案
- 新增：`src/checkup/lib/tradeLogPersist.js`
- 新增：`src/checkup/lib/__tests__/tradeLogPersist.test.js`（5 個 buffer / flush 測試）
- 編輯：`src/checkup/hooks/useTradeCaptureRuntime.js`（jsonRepair、demo 守門、檔案檢核、undo snapshot）
- 編輯：`src/checkup/components/trade/TradePanel.jsx`（檔案上限提示、undo 按鈕）
- 編輯：`src/checkup/components/log/LogPanel.jsx`（單色橘、lexical sort）
- 編輯：`src/pages/FreeCheckup.jsx`（tradeLog save effect 改 persistTradeLogToCloud）

## 驗證
- 跑 `bunx vitest run`（739 + 5 新測試）。
- 手測：訪客上傳被擋、超大圖被擋、AI 回截斷 JSON 仍能解析、submitMemo 後 5 秒內可 undo。
- 不需跑 Playwright（不影響 Hero / 持倉看板 RWD）。

需要我執行這份計畫嗎？或是只挑其中幾項（例如只做 1 + 2 + 3 這組「上傳前置防呆」）？