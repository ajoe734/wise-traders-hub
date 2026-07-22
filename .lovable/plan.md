## 問題定義

截圖中的週記後台「資金狀況 / 目前持倉」仍有同一類錯誤：台股持倉在資料庫中以實際股數儲存，但前端帶入週記時用資產預設單位「張」，同時把實際股數直接塞進數量欄。

結果會變成：
- 1 股持倉 → 帶入表單後變成 `1 張` 語意
- 2,000 股持倉 → 帶入後變成 `2000 張` 語意
- 減碼 / 出場 / 停損 的模擬持倉與資金驗證全部被放大 1000 倍
- 畫面顯示「股數」但沒有顯示目前鎖定單位，使用者無法看出哪筆是股、哪筆是張

## 修法計劃

### 1. 建立台股數量顯示 / 編輯單一轉換規則
- 新增或抽出 helper：把資料庫儲存的實際股數轉成週記表單要顯示的 `{ quantity, quantityUnit }`。
- 規則：
  - `tw_stock` 且 `trade_records.quantity_unit = '張'`：顯示 `quantity / 1000`、單位 `張`
  - `tw_stock` 且 `trade_records.quantity_unit = '股'`：顯示原始股數、單位 `股`
  - `us_stock`：顯示原始數量、單位 `股`
  - `us_future` / `us_option`：顯示原始數量、單位 `口`
  - `crypto`：顯示原始數量、單位 `顆`
- 不在前端擅自換算已不整除的張數；遇到 `quantity_unit='張'` 但股數不是 1000 的倍數，保守顯示為股並標註異常來源，避免再次送出錯誤。 

### 2. 修正 `CapitalPanel` 的「帶入」行為
- 目前問題點：`quantityUnit: defaultUnit` + `quantity: p.quantity_shares`。
- 改為使用持倉本身的 `quantity_unit` 與轉換後的可編輯數量。
- 出場 / 停損 full action 必須帶入正確表單數量：
  - 1 股 + 單位股 → `1 股`
  - 2000 股 + 單位股 → `2000 股`
  - 2000 股 + 單位張 → `2 張`
- 加碼 / 減碼時預設單位也要跟目前未平倉部位一致，不再用資產預設值。

### 3. 修正資料型別與 bundle 映射
- `OpenPosition` 型別補上 `quantity_unit`、`asset_class`、`currency` 等必要欄位。
- `useExpertHoldingsBundle.mapOpenPositionToRow()` 不再硬寫 `quantity_unit: '股'`。
- 從 `get_expert_capital_status` RPC 回傳 `quantity_unit`、`currency`、`asset_class`，讓所有持倉來源都知道原始單位。

### 4. 修正後台持倉表格顯示
- 「目前持倉」欄位不要只顯示裸數字。
- 改成顯示「原始單位語意」：例如 `1 股`、`2,000 股`、`2 張`。
- 「送出後」同樣依該持倉單位顯示，避免使用者看到股數但表單其實是張。
- 表格欄名從「股數」改成「數量」，避免台股張 / 股並存時誤導。

### 5. 修正模擬與驗證的單位一致性
- `buildStepStates()`、`computeCashSim()`、`buildSimulatedPositions()` 仍保留以實際股數計算。
- 但所有從持倉帶入的表單值必須先轉成正確單位，讓 `normalizeSignalQuantityToShares()` 回到正確實際股數。
- 補強 `validateSignalBatch()` 的錯誤訊息：當某檔已有 open position 且單位不同時，提示「目前未平倉為 X，請使用相同單位」。

### 6. 新增完整回歸測試
- Unit test：
  - `1 股 + quantity_unit=股` 帶入出場後仍是 `1 股`，實際股數 = 1。
  - `2000 股 + quantity_unit=股` 帶入出場後仍是 `2000 股`，不可變成 2000 張。
  - `2000 股 + quantity_unit=張` 帶入出場後顯示 `2 張`，實際股數 = 2000。
  - 同批減碼 / 加碼後的 `computeCashSim()` 不放大 1000 倍。
- E2E test：
  - 開啟週記編輯頁。
  - 從「目前持倉」點「帶入 → 出場 / 減碼」。
  - 斷言表單數量與單位正確。
  - 斷言「送出後預估可用現金」沒有因張股混算暴衝。
- Drift test：
  - `get_expert_capital_status` SQL 必須回傳 `quantity_unit`。
  - `CapitalPanel` 不可再出現 `quantityUnit: defaultUnit` 搭配 `p.quantity_shares` 的舊錯誤模式。

### 7. 資料庫側補強
- 新增 migration 覆寫 `get_expert_capital_status()`，把 open / recent trade 的 `quantity_unit` 一併回傳。
- 檢查 `enforce_signal_capital_limit()` 仍以 `quantity_unit='張'` 才乘 1000，其餘皆不乘。
- 不修改既有歷史資料，除非 audit 顯示 open/pending 仍有錯誤；本次修的是「帶入與送出再次污染」的根因。

## 驗證範圍

完成後我會驗證：
- 週記後台目前持倉表格顯示
- 帶入加碼 / 減碼 / 出場 / 停損
- 台股 `張`、台股 `股`、美股 `股`、期貨 / 選擇權 `口`
- 資金模擬、送出前驗證、publish payload
- SQL drift test、unit tests、相關 E2E
