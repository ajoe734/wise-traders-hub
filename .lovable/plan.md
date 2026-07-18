## 目標

讓後台（週記 SignalCreateDialog）與前台持倉看板都能新增 **美股選擇權（Options）** 與 **美股期貨（Futures）**，補齊「美股 asset_class 只能買現股」的缺口。

## 範圍界定

現況：`asset_class` 只有 `tw_stock / us_stock / crypto` 三種，`us_stock` 的 `symbolRegex = /^[A-Z]{1,5}(\.[A-Z])?$/`，直接把 `AAPL 250117C00150000`、`/ES`、`/NQ` 全部擋掉。DB CHECK constraint、`current_prices`、`stock_names` 也都寫死這三種。

新增兩個一等公民資產類別（不是「附掛在 us_stock 底下的變體」，因為單位、乘數、報價來源、市場時區都不同）：

| 新 asset_class | 代碼格式 | 單位 | 乘數 | 幣別 | 交易時區 |
|---|---|---|---|---|---|
| `us_option` | OCC 21 字元 `AAPL  250117C00150000`（Root 1–6 + YYMMDD + C/P + 8 位履約價） | 口 | 100 | USD | US（延伸至 09:30–16:15 ET） |
| `us_future` | `/` + 1–3 大寫 + 可選月份月碼與年碼，如 `/ES`, `/NQ`, `/CL`, `/ESZ5` | 口 | 依合約另表（先只顯示、不參與 PnL 計算） | USD | 24×5（週日 18:00 ET – 週五 17:00 ET） |

第一階段報價與名稱皆走 **手動 override**（`holding_meta_overrides.override_price` + `stock_names` 手填），不接外部行情源；`stock-price-sync` / `daily-snapshot` 對這兩類直接跳過，避免 429/找不到報價把 job 打壞。第二階段再評估 Polygon/Tradier 整合。

## 實作步驟

### 1. DB migration（放寬 CHECK、擴充白名單）
- `experts.asset_class`、`current_prices.asset_class`、`stock_names.asset_class` 三個 CHECK constraint：
  `CHECK (asset_class IN ('tw_stock','us_stock','crypto','us_option','us_future'))`
- `admin_reset_expert_asset_class(_new_asset_class)` RPC 的參數驗證同步放寬。
- `trg_enforce_expert_asset_class_lock` 觸發器：`us_option` / `us_future` 一併納入合法值。
- 為兩個新類別建立 seed row（供 SignalCreateDialog 下拉顯示）：不需要新表，仍靠前端 `ALL_ASSET_CLASSES` 常數。

### 2. `src/lib/asset.ts`（單一來源）
- `AssetClass` type 新增 `us_option | us_future`。
- `QuantityUnit` 新增 `'口'`。
- `SPECS.us_option` / `SPECS.us_future` 兩份完整 spec：regex、placeholder、單位、priceDigits、marketHours、priceSource（新增 `'us_option' | 'us_future'`）。
- `resolveAssetClass` 保留舊 fallback 行為（不影響已存在的 tw/us/crypto 老師）。
- `isMarketClosedFor`：新增 `'us_ext'`（09:30–16:15 ET）與 `'us_future_5x24'` 兩種模式。
- `ALL_ASSET_CLASSES` 加入兩個新值。

### 3. `supabase/functions/_shared/marketDetect.ts`
- `detectMarket` 加兩條：`/^\//` → `US`（期貨）；`/^[A-Z.]{1,6}\s?\d{6}[CP]\d{8}$/` → `US`（選擇權）。
- `currencyOf` 保持 USD。
- `stock-price-sync` / `daily-snapshot` / `publish-weekly-journals` 在 fetch 前先判斷 `assetClass in ('us_option','us_future')`，直接 skip 並記一筆 `function_run_logs`，不再打行情 API。

### 4. `SignalCreateDialog` + `useSignalEditorData`
- Asset class 下拉補上「美股選擇權 / 美股期貨」兩個選項（受 `resolveAssetClass(expert)` 綁定，仍以老師目前 `asset_class` 為預設）。
- 驗證改走 `isValidAssetSymbol`，錯誤訊息使用新 spec 的 `symbolPlaceholder`。
- 「目前價格」欄若對應 asset 沒有自動報價，顯示提示「需手動輸入，系統暫不自動更新」。

### 5. 持倉看板 / HoldingsTable
- Instrument 輸入時走 `isValidAssetSymbol(spec)`；數量單位顯示改讀 `spec.units[0]`。
- `parseInstrument`（`src/lib/instrument.ts`）：新增選擇權 / 期貨的 code 抽取（不能沿用現有 4–6 位數字 regex）。
- PriceAxis / RangeBand：若 `assetClass in ('us_option','us_future')` 且無報價，隱藏區間帶並顯示「手動輸入」badge，避免 30D trend / axis 空資料時整條崩掉。

### 6. 測試（強制窮舉，不可只挑樣本）
- `src/test/unit/assetSpec.test.ts` 新增：五個 asset class 全覆蓋 symbol / unit / market hours。
- `src/lib/__tests__/instrument.test.ts` 新增：`AAPL 250117C00150000`、`/ES`、`/NQMZ5` 三組 parse。
- 新增 `e2e/signal-create-us-derivatives.spec.ts`：分別建立 option / future 訊號，驗證儲存後 SignalsTable 顯示與持倉看板顯示不噴錯。
- Edge functions Deno test：`marketDetect.test.ts` 補選擇權/期貨判別。

## 開放問題（實作前先確認一件事）

**選擇權/期貨的 PnL 該怎麼算？**
- **A. 只做「部位紀錄」**：不計算未實現損益，PnL 欄顯示「—」，實現損益仍照 (賣-買)×數量 但乘數用 1（等於原本現股邏輯）。實作最快、資料最乾淨。
- **B. 完整支援乘數**：Options ×100、Futures 依合約表（/ES ×50、/NQ ×20、/CL ×1000），需要新表 `future_contract_specs`，且要處理保證金、每日結算。工程量大。

先請你選 A 或 B，我再進 build mode 執行。
