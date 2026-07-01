# 持倉看板「收盤損益 / 現股股價」修復計畫

## 問題總結（子代理窮舉盤點）

客戶看到的「數字不對」不是單一 bug，而是 5 條錯誤同時作用。以下每一條都會修，不挑樣本。

### 錯誤 1：HoldingCard 的「TODAY」標籤實際顯示的是「總損益」
`src/checkup/components/freecheckup/HoldingCard.tsx:71-78, 353-371`
- 現行公式：`(price - cost) * qty`（總未實現損益）
- 標籤卻叫「TODAY」→ 使用者以為是今日收盤損益
- **應為**：`(price - yesterdayClose) * qty`

### 錯誤 2：市場報價合併時只回傳 `.price`，丟掉 `.change / .changePct / .yesterday`
`src/checkup/lib/holdings.js:109-127, 183-185`
- `normalizeHoldingMetrics` 只寫 `{ price, value, pnl, pct }`
- 結果 `HoldingsDetailPanel.tsx:105-106` 的 `todayPct / todayPnl` **永遠是 null**，TODAY 那一行整段不顯示

### 錯誤 3：`normalizeHoldingMetrics` 繞過 `calcPnlWithNet` 精確模式
- 先用簡單公式寫死 `h.pnl`，之後 `getHoldingUnrealizedPnl` 遇到已存在的 `h.pnl` 直接回傳
- 手續費 / 交易稅 / totalCost 精確模式**永遠走不到**

### 錯誤 4：前端與後端取價瀑布邏輯不一致
- 後端 `supabase/functions/_shared/stockPriceWaterfall.ts`：`z > h(v>0) > 委賣一 a > y`
- 前端 `src/checkup/lib/market.js:127-133`：`z > h(無量檢查) > o(開盤) > y`
- 導致漲停未成交時前端誤把「今日最高 = 漲停價」當現價；盤前用「開盤」而非「委賣」

### 錯誤 5：`daily-performance` edge function 用 Yahoo `regularMarketPrice` 當收盤
`supabase/functions/daily-performance/index.ts:13-18`
- `regularMarketPrice` 在盤中就是即時價，非收盤
- 沒有 `marketState=CLOSED` 判斷 → 盤中觸發會把即時價當收盤寫入
- 另外 `pnl_percent` 是（現價 vs 進場）**總報酬率**，不能被 UI 誤用為「今日損益」

### 附帶問題
- 錯誤 6：`useHoldingDecision.js:51-59` 讀不存在的欄位 `changePercent / changeValue` → `today.pct/pnl` 恆 null
- 錯誤 7：`holdingMath.ts:150-156` 無報價時用 `cost` 當現價算總市值 → 虛報
- 錯誤 8：`demoData.js:375-391` 的 `totalTodayPnl=11624` 與 changes 陣列加總（46000）對不上
- 錯誤 9：`useMarketData.js:103` 不支援興櫃與美股 fallback（客戶若有美股會直接 missing-price）

---

## 修復步驟

### Step 1 — 統一「holding 物件」欄位規格
擴充 `src/checkup/lib/holdings.js` 的 `normalizeHoldingRow / normalizeHoldingMetrics / applyMarketQuotesToHoldings`：
- 接收 quote 時把 `{ change, changePct, yesterday, priceSource, priceUpdatedAt }` 一併寫入
- `pnl` 分兩個欄位：
  - `pnl`（總未實現，走 `calcPnlWithNet` 精確模式，含手續費）
  - `todayPnl = (price - yesterday) * qty`（找不到 yesterday 就給 `null`，不要 fallback 成總損益）
- `pct` 拆為 `pct`（總報酬率）與 `todayPct = changePct`

### Step 2 — HoldingCard / HoldingsDetailPanel 對齊新欄位
`HoldingCard.tsx`：
- 「TODAY」欄改用 `h.todayPnl`；`h.todayPnl == null` 時顯示「—」而非硬算總損益
- 另外新增「TOTAL」欄顯示總報酬（原本 `(price-cost)*qty`）
- `pct` 大字改顯示 `h.todayPct`（TODAY 卡片）或 `h.pct`（TOTAL 卡片），依 variant 決定

`HoldingsDetailPanel.tsx`：
- L105-106 直接消費新的 `h.todayPct / h.todayPnl`，不再回 null

`useHoldingDecision.js:51-59`：
- `changePercent → todayPct`、`changeValue → todayPnl`

### Step 3 — 取價瀑布前後端統一
`src/checkup/lib/market.js:extractBestPrice` 改成呼叫 `src/lib/stockPriceWaterfall.ts` 的同一份實作，並補：
- `h` 需 `v > 0` 才採用
- 第三 fallback 改為委賣一 `a` 而非開盤 `o`
- 額外回傳 `yesterday = parsePrice(item.y)` 供 `change / changePct` 計算
- `extractQuotesFromTwsePayload` 一併回傳 `{ price, change, changePct, yesterday, source }`

### Step 4 — `daily-performance` edge function 修正
`supabase/functions/daily-performance/index.ts`：
- 檢查 Yahoo `meta.marketState`，只有 `CLOSED / POST / POSTPOST` 才用 `regularMarketPrice`
- 盤中觸發時改用 `regularMarketPreviousClose` 或整批跳過（記 `system_jobs_log` skip 原因）
- 額外寫入 `previous_close`、`price_change`、`price_change_pct` 欄位（若表沒欄位就走 metadata JSON），供 UI 消費
- 新增 cron 時間注釋：僅在收盤後執行（台股 13:35+、美股 04:05+）

### Step 5 — 前端市場資料涵蓋美股 / 興櫃
`useMarketData.js:103`：
- 判斷代號類型：純數字 → tse+otc；`.emg` → 興櫃；字母開頭 → 走 `fetchYahooQuote`（新增 helper，與 daily-performance 共用邏輯）
- 美股回傳同樣的 `{ price, change, changePct, yesterday, source }` 結構

### Step 6 — Demo 假資料一致化
`src/checkup/data/demoData.js`：
- 讓 `totalTodayPnl = sum(changes[*].todayPnl)`，並補齊 20 檔的 `yesterday` 欄位（讓卡片 TODAY 欄有值）

### Step 7 — 保護錯誤 7（fallback 用 cost）
`src/checkup/lib/holdingMath.ts:calculateTotalMarketValue`：
- 無報價時**不 fallback 到 cost**，改為只加總有報價的持倉，並回傳額外的 `missingPriceCount`
- KPI 顯示區加註「N 檔待補價」（沿用現有 `holdingsIntegrityIssues` 機制）

### Step 8 — 測試涵蓋（強制）
1. `src/test/unit/holdings-metrics.test.ts`（新增）：
   - `normalizeHoldingMetrics` 正確產出 `todayPnl / todayPct / pnl / pct` 四個欄位，且精確模式（totalCost/fee）優先於簡單模式
   - `applyMarketQuotesToHoldings` 把 `change/changePct/yesterday` 合併進 holding
2. `src/test/unit/1.2-stock-price-waterfall.test.ts`：
   - 新增 case：h 有價無量 → 不採用（回退到 a / y）
   - 新增 case：前後端瀑布結果一致（同一組 MsgItem 輸入 → 相同輸出）
3. `src/test/unit/holdings-page.test.tsx`：
   - 補「無報價的持倉不計入 totalVal」的斷言
4. `e2e/freecheckup-demo-first-fold.spec.ts`：
   - 首屏 HoldingCard 需顯示 `TODAY` 有值（非 —）、`TOTAL` 有值；斷言 `totalTodayPnl === sum(cards.todayPnl)`
5. `supabase/functions/daily-performance` 整合測試：
   - Mock Yahoo 回 `marketState=REGULAR` → 應跳過更新
   - Mock `marketState=CLOSED` → 應寫入 current_price 與 previous_close

### Step 9 — 部署驗證
- `bunx vitest run` 全綠
- `bunx playwright test e2e/freecheckup-demo-first-fold.spec.ts e2e/freecheckup-card.spec.ts` 全綠
- 手動用 Playwright 打開 /holding-checkup-demo，截圖確認 20 檔卡片的 TODAY 欄都有值且與 KPI 加總相符
- Edge function 部署後手動觸發一次，檢查 `system_jobs_log` 有 `skipped_in_session` 或 `updated` 記錄

---

## 不會動的範圍

- 不動 shadcn / auth / 訂閱流程
- 不動 signals / trade_records 的商業邏輯（只修 `daily-performance` cron 的取價時機與欄位）
- 不動 `.env` / `supabase/config.toml` / `src/integrations/supabase/client.ts`

---

## 開放問題（實作前需再確認一次）

1. `daily-performance` cron 目前實際觸發時間為何？（決定 Step 4 的緊急程度）
2. `h.priceSource` 消費端顯示「即時 / 昨收」標籤是否要在 Step 1 一併補上寫入邏輯？我打算補。
3. 美股持倉是否已有客戶在用？若有 → Step 5 必做；若還沒 → 可延後但需在 UI 明確標示「不支援美股」而非顯示 0。

如果同意這 9 個步驟一次做完，我進 build mode 後會依 Step 1→9 順序執行，並在每個 step 結束前跑對應測試才進下一個。
