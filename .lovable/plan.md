## 目標

把「分析師交易資產類別」從目前的 TWD/USD 雙軌，升級為 **台股 / 美股 / 加密貨幣** 三種可選；分析師在後台設定一次，之後代碼輸入、單位、報價、匯率折算、週記／訊號、持倉、績效、前台顯示，全部依所選類別自動套對。

## 資料模型

新增 `asset_class` 概念（比目前只用 `currency` 更明確），保留 `currency` 為顯示／結算幣別。

- `experts.asset_class` `TEXT NOT NULL DEFAULT 'tw_stock'`
  - 允許值：`tw_stock` / `us_stock` / `crypto`
  - 新增 CHECK；沿用既有 `enforce_expert_currency_lock` 邏輯，同表新增 `enforce_expert_asset_class_lock`（首次寫入後鎖，避免歷史績效污染）。
- `experts.currency` 允許值擴增為 `TWD` / `USD`（加密統一以 USD 計價，不新增第三種顯示幣）。
  - 對應關係（後端 trigger 自動同步）：
    - `tw_stock` → `TWD`
    - `us_stock` → `USD`
    - `crypto`   → `USD`
- `current_prices.asset_class`、`stock_names.asset_class`：同樣加欄位＋CHECK，`stock_names` 主鍵改成 `(symbol, asset_class)`（避免 `BTC` 與台股代碼衝突；migration 內做去重）。
- `fx_rates`：沿用 `USDTWD`，加密走 USD → 前台若使用者切 TWD 顯示，透過 FX 折算，不新增新 pair。
- 交易紀錄／訊號側 (`trade_records`, `expert_signals`, `trade_signals`) 不改欄位；透過 `expert.asset_class` 對照即可（symbol 唯一性已被 expert 隔離）。

## 前端：一次收斂於 `@/lib/asset.ts`

新增 `src/lib/asset.ts` 作為單一來源，取代散落的 currency 判斷：

```ts
export type AssetClass = 'tw_stock' | 'us_stock' | 'crypto';

// 每個 class 的 UI/驗證合約
interface AssetSpec {
  label: string;                 // 「台股」「美股」「加密貨幣」
  currency: 'TWD' | 'USD';       // 結算幣
  symbolRegex: RegExp;           // 代碼合法性
  symbolPlaceholder: string;     // 例：2330 / AAPL / BTC
  minSymbolLen: number;          // 觸發自動查名的門檻
  units: Array<'張'|'股'|'顆'>;  // 下拉選項
  defaultUnit: '張'|'股'|'顆';
  priceDigits: number;           // 顯示小數位（TW 2 / US 2 / crypto 4）
  quantityDigits: number;        // crypto 允許小數，其他整數
  marketHours: 'tw' | 'us' | '24x7'; // 決定 isMarketOpen
  priceSource: 'twse' | 'us' | 'crypto'; // 對應報價管線
}
```

同時保留現有 `@/lib/currency.ts`：改成 thin wrapper（`normalizeCurrency`、`formatMoneyByCurrency` 依 `asset` 決定），避免破壞既有 import。

## 後台：分析師自選

### 1. `admin/Profile.tsx`（或現有 currency 設定頁）
- 「資產類別」下拉：台股／美股／加密貨幣（首次儲存後鎖，UI 顯示鎖定 tooltip，與 currency 相同體驗）。
- 儲存時同步寫 `asset_class` 與對應 `currency`。

### 2. `admin/SignalEditor.tsx`（顧問多筆交易頁）
- 從 `useSignalEditorData` 取 `expert.asset_class`，透過 `emptyTrade(assetClass)` 決定初始 `quantityUnit`。
- `fetchStockInfo` 門檻：`code.length < spec.minSymbolLen` 才 return（美股 1、加密 2）。
- 加密允許小數數量。

### 3. `_adminSignals/SignalCreateDialog.tsx`（mentor 週記主入口 — 目前完全寫死台股，主戰場）
- 讀 `expert.asset_class` → `spec`：
  - Placeholder：`spec.symbolPlaceholder`（`BTC` / `AAPL` / `2330`）。
  - `handleStockCodeChange` 觸發門檻改用 `spec.minSymbolLen`；US／crypto 自動 `toUpperCase()`。
  - 數量單位下拉：`spec.units`，預設 `spec.defaultUnit`。
  - crypto 數量允許小數（type=number, step=0.0001）。
  - 發布前 `isValidSymbol(code, spec)`；錯誤訊息用 `spec.symbolPlaceholder`。
  - `isMarketClosed()` 改為 `isMarketClosed(spec.marketHours)`，crypto 永遠 open。

### 4. `_adminSignals/derive.ts`
- `isMarketClosed(mode: 'tw'|'us'|'24x7', now?: Date)`：
  - `tw`：既有邏輯。
  - `us`：美東 09:30–16:00（`Intl.DateTimeFormat` 取 America/New_York）；週末關閉。
  - `24x7`：永遠 `false`。
- 對呼叫端相容：預設值維持 `'tw'`。

### 5. `_adminPerformance/*`、`SignalRow`、`SignalsTable`
- 已幣別化，改為讀 `spec` 而非直接 `currency`；標籤「張」在 crypto 隱藏、加密顯示「顆」。
- CapitalSummaryCard 沿用 `formatMoneyByCurrency(spec.currency)`。

## 報價與 FX 管線

### A. 台股
- 現況不動（`stock-price-sync`）。

### B. 美股
- 現況不動（`stock-price-sync` + `us_stock_price_waterfall` + `fx-rate-sync`）。

### C. 加密貨幣（新）
- 新 edge function `supabase/functions/crypto-price-sync/index.ts`
  - 資料源 L1：Coingecko simple/price（`ids=bitcoin,ethereum,...` via symbol → id 表）
  - 資料源 L2：Binance `api/v3/ticker/price`（USDT pair fallback）
  - Sanity check（>0、與上一筆差異 < 30%）。
  - 寫入 `current_prices`（`asset_class='crypto', currency='USD'`）。
- Symbol 對照表：`crypto_symbol_map`（migration 種一批：BTC/ETH/SOL/BNB/XRP/ADA/DOGE/TON/LINK/AVAX/DOT/MATIC/LTC/BCH/UNI），欄位 `symbol PK, coingecko_id, binance_pair`。
- Cron：`crypto-price-sync-every-5min`（`*/5 * * * *`，24x7）。
- `daily-performance` / `daily-snapshot`：`marketDetect` 擴充回傳 `'crypto'`，crypto 標的每日 UTC 00:00 收盤（snapshot 用當下價）；`publish-weekly-journals` 對 crypto expert 不做「週五 20:00 台股時間」限制，改用世界時間週五。
- 若 FX 折算：crypto 已是 USD，前端 `FxHint` 一樣走 USDTWD。

## 前台 `/app`

- `SignalDetail`／`JournalDetail`／`ExpertDetail` 讀 `expert.asset_class`，透過 `spec` 決定：
  - 顯示幣別符號、單位（顆／股／張）、代碼樣式。
  - `DisplayCurrencyToggle` 沿用（TWD/USD/auto），crypto expert 預設 USD、可切 TWD 折算。
- 專家列表卡片新增小 badge：`台股`／`美股`／`加密`（顏色 tokens：TW=primary、US=blue、CRYPTO=amber）。

## 週記排程

- `publish-weekly-journals` 依 `expert.asset_class` 選時區與交易日：
  - tw_stock：現況（台北時間週五 20:00）
  - us_stock：美東週五 20:00
  - crypto：UTC 週五 20:00

## 測試（vitest）

- `src/test/unit/assetSpec.test.ts`：三種 asset 的 spec 快照、單位／驗證邊界。
- `src/test/unit/marketOpen.test.ts`：tw/us/24x7 三時區判斷。
- `src/test/unit/signalCreateDialog.assetClass.test.tsx`：
  - crypto expert：placeholder `BTC`、預設單位「顆」、允許小數、`isValidSymbol('BTC')` true、`2330` false。
  - us expert：AAPL 1 字就觸發查名、單位鎖「股」。
  - tw expert：既有行為不變（回歸保護）。
- `src/test/integration/1.31-crypto-scheduler.test.ts`：crypto edge function 排程與寫入。

## 遷移策略

1. Migration A（schema）：加 `asset_class` 欄位／CHECK／trigger、`stock_names` 主鍵擴充、`crypto_symbol_map` 表 + GRANT + RLS（讀公開、寫 service_role）。
2. Migration B（回填）：既有 experts 依 currency 回填 `asset_class`（`USD` → `us_stock`、其他 → `tw_stock`），寫入後鎖定。
3. 前端 shim：`normalizeCurrency` 之外新增 `resolveAssetClass(expert)`，未擴充的舊呼叫 fallback = `tw_stock`。
4. 上線後才放開 crypto edge function 排程（避免舊資料被 mis-tag）。

## 不動的東西

- `expert_signals` / `trade_records` / `trade_signals` 主要欄位、LINE 推播、mentor 訂閱、AI Studio、Checkout、Referral。
- Realtime 事件與 `useEffectiveUserId` 視角檢視。
- 既有 TW analyst / advisor 的每個行為（本次做回歸測試守住）。

## 交付順序（每步都能獨立驗證）

1. Schema + spec lib + Profile 下拉。
2. `SignalCreateDialog`／`SignalEditor` 動態化（此步就解掉美股週記選不到標的的當下 bug）。
3. 前台顯示層 spec 化。
4. Crypto 報價管線 + 排程 + `publish-weekly-journals` 時區。
5. 全套整合測試。