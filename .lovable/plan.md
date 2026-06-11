## 問題定位

同一篇週記中對「同一檔股票」同時下加碼＋減碼，前端送出失敗。實測 + 程式碼追蹤後，瓶頸都在**前端驗證**（DB trigger `handle_signal_trade` 其實已逐筆順序處理，能正確合併加權成本）：

`src/pages/_signalEditor/derive.ts` `validateSignalBatch` L74-111：

1. **L88-94**：對 `add / trim / sell / exit` 一律要求「目前模擬持倉 > 0」。
   - 場景：先「減碼」全數出清 → 模擬持倉=0 → 接著想「加碼」買回 → 直接被擋（其實這時候應該允許 add，或建議用 buy）。
2. **L97-108 現金模擬**：trim 收回的現金被視為立即可用 ✅，但同檔加碼的成本上限是套用在「下一筆 add」上 → 若「先 add 再 trim」，雖然驗證會過，但 `buildCashSimTrades` 算「送出後可用現金」時用的是原始持倉而非模擬持倉，會雙扣／低估，UI 可能顯示「已超過上限」誤判。
3. **TradeCard / SignalEditor 沒有 duplicate symbol 檢查**，但下拉「帶入」按鈕一次只能填入一筆，使用者要手動 + 新增另一檔 再選同檔股票。

下方面板「目前持倉」的「送出後」欄已正確顯示淨變動（`buildSimulatedPositions` 走完所有 trades），所以 UI 真相沒問題，純粹是 validator 與 cashSim 把同檔多筆當成異常。

## 修法

### 1. validateSignalBatch（核心）

讓「同檔股票」可在一篇週記內依任意順序、任意組合 add / trim / sell / exit / buy：

- **取消「sim cur ≤ 0 就擋 add」**：若 simulated qty=0 但本筆是 `add`，自動視同 `buy`（純前端容錯，不改 DB action），或直接放行；
- `trim` / `sell`：仍要求 `cur > 0`，但若同 batch 後續還有 add，會在 sim 上重新累積，不影響後續驗證；
- `sell` 數量 > sim cur 時，自動視為「全平倉 + 剩餘部分忽略」反而會藏錯誤 → 維持擋下，錯誤訊息明確指出「目前模擬持倉 cur 股，請拆筆或調整數量」。

### 2. buildCashSimTrades / simulateCashAfterTrades

讓現金模擬與 `simulatePositions` 共用同一份「逐筆套用」狀態：

- `trim` / `exit` 收回金額：用**模擬持倉**而非 `capital.open_positions` 的原始 quantity_shares，避免同檔多筆把已加碼那部分當原始庫存反算成本；
- `add` 成本：以「下單時點的可用現金 = 起始可用 + 已實現現金流」逐筆扣抵，不重複扣；
- exitShares / exitAvgPrice 改成「執行到本筆前的模擬狀態」，weighted-avg 用 ((原成本×剩餘股)+(新成本×加碼股))/(剩餘+加碼) 算出當下平均，再給 `simulateCashAfterTrades`。

### 3. 後端 trigger 確認（無需修改）

`handle_signal_trade` 已逐筆 fire、`add` 會 weighted-avg 合併、`trim` 部分平倉保留剩餘 open record，因此同 batch 多筆 INSERT 會被正確處理。已驗證邏輯路徑：
- add→trim：第一筆 update qty+price_avg；第二筆對同一 open record 扣 qty
- trim→add：第一筆扣到 0 → 該 record status=closed；第二筆 FOUND 失敗 → INSERT 新 open record（新均價）

兩種順序都會在 `trade_records` 留下正確最終持倉。**不動 DB**。

### 4. UI 微調（可選）

`CapitalPanel` 的「送出後」欄已正確；額外在 `TradeCard` 同檔股票時，把第二筆以上的卡片左上標一個 tag「同檔第 N 筆」提醒使用者順序很重要。

## 技術細節

修改檔案：
- `src/pages/_signalEditor/derive.ts`
  - `validateSignalBatch`：放寬 add 驗證、trim/sell 錯誤訊息帶出 sim cur、放行同檔多筆
  - `buildCashSimTrades`：改為逐筆套用模擬狀態（回傳的 `exitShares` / `exitAvgPrice` 用模擬後的當下值）
- `src/pages/_signalEditor/TradeCard.tsx`（可選）
  - 同檔多筆時顯示「同檔第 N 筆」小標

### 驗證

1. 對 sharkgu 試一篇週記：A 股 add 1 張 + 同 A 股 trim 0.5 張 → 應可儲存
2. A 股 trim 全數出清 + A 股 add 1 張 → 應可儲存（且發布後 trade_records 留下一筆 closed + 一筆新 open）
3. 起始持倉 1 張、價 100，加碼 1 張價 120、再減碼 1 張價 110 → trade_records 剩 1 張、均價 110、已實現損益 +10
4. 純加碼 / 純減碼 / 單檔不同股的多筆 → 行為與目前一致，無回歸
5. cash sim 在多筆下不會誤報「超過上限」

不動 DB、不動週記面板來源、不動 `handle_signal_trade`。