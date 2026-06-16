## 目標
讓分析師在**單一篇週記**裡同時寫「加碼 + 減碼」、「一買一賣」也能順利送出，不再被迫拆兩篇或人工挪動順序。敘事顯示順序維持分析師輸入的原樣，僅在**驗證／資料庫寫入**時改用「執行語意順序」。

## 設計原則
- 顯示順序（reader 看週記） = 分析師輸入順序（不動）。
- 執行順序（trigger 觸發、現金/持倉檢查） = **釋放資金優先**：`exit → trim → sell → add → buy`。
- 同檔股票若有多筆，依然在各組內保持輸入相對順序。
- Trigger 不動（風險最低）；改由前端在送資料前把陣列按執行順序排好，逐筆 INSERT 順序＝執行順序，trigger 取到的 `available_cash` 就會正確反映前面已釋放的現金。

## 變更項目

### 1. `src/pages/_signalEditor/derive.ts`
新增 helper：
```ts
const EXEC_ORDER = { exit: 0, trim: 1, sell: 2, add: 3, buy: 4 };
function sortByExecutionSemantics(trades: TradeDraft[]): TradeDraft[] {
  return trades
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const oa = EXEC_ORDER[a.t.action] ?? 9;
      const ob = EXEC_ORDER[b.t.action] ?? 9;
      if (oa !== ob) return oa - ob;
      return a.i - b.i; // 同類維持原序
    })
    .map(({ t }) => t);
}
```
- `validateSignalBatch`、`buildStepStates`、`buildCashSimTrades`、`buildSimulatedPositions`：所有「sequential simulation」改先 `sortByExecutionSemantics(trades)` 再跑。錯誤訊息中的「第 N 檔」改成顯示 `tag = 第 N 檔 (XXXX 加碼)` 之類，但 index 來源以**原陣列**為準（避免分析師找不到是哪一張卡片）。
- 改法：iteration 用排序後陣列，但 tag 取 `原始 index + 1`。
- `buildPublishRows`：同樣先排序、再產出 rows，這樣 `expert_signals.insert(rows)` 的 INSERT 順序 = 執行順序 → trigger 看到的 `available_cash` 已包含前一筆 trim/exit 釋放的資金。

### 2. `src/pages/admin/SignalEditor.tsx`
- `cashSim` / `simulatedPositions` 透過上述 derive 變更自動取得正確結果，無需改動。
- 在 `TradeCard` 或 footer 加一個小提示（可選，本次先不加）：「送出時系統會自動先處理減碼／平倉，再處理加碼／買進，現金/持倉以這個順序計算。」

### 3. 顯示順序保證（不變）
`expert_signals` 在 reader 端是以 `executed_at`／`sort_order` 顯示，不是 row insert 物理順序。`buildPublishRows` 不動 `executed_at`（沿用分析師填的時間），所以重排後讀者看到的順序仍是分析師原意。

### 4. 測試
新增 `src/test/unit/signal-editor-mixed-batch.test.ts`（或加在 `1.27`）：
- case A：同檔「先 add 後 trim」，現金不夠 add 但 trim 後夠 → 排序後通過。
- case B：跨檔「buy B 用 A 平倉換來的錢」 → 排序後通過、現金剩餘正確。
- case C：trim 數量超過模擬持倉 → 仍然 fail，並回報「第 X 檔」對應到**原陣列 index**。
- case D：純加碼超額 → 仍然 fail。

### 5. 不在範圍
- 不改 `enforce_signal_capital_limit` 觸發器。
- 不改觸發器寫法、不引入 statement-level trigger，避免影響其他寫入路徑（remittance、手動補單、後台修正）。
- 不動週記顯示組件、不動 `executed_at`。
- 不動現有 mentor 審核 / mentor cron / LINE push 流程。

## 驗收
1. 在 SignalEditor 開一張新週記：
   - Row1：加碼 A 3 張 @ 100（現金不夠）
   - Row2：平倉 B（釋放現金）
   - 送出前不再出現「本筆需…剩餘可用現金僅…」，模擬現金顯示也正確。
2. 同檔股票：
   - Row1：加碼 2330 1 張
   - Row2：減碼 2330 1 張
   - 兩筆都能通過，trigger 不擋。
3. 真正超額（純加碼超過所有可用現金）仍會擋並回正確的卡片編號。
4. 週記讀者頁顯示順序仍為分析師原始輸入順序（依 `executed_at` 排序）。
