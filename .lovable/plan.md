# 週記後台多幣別支援（USD / TWD）

讓部分老師可以操作美股；每位老師綁定一個幣別，資金、PnL、報價都用自己幣別獨立計價（**不做匯率折算**）。前後台同步換貨幣符號與單位。

## 一、資料層

### Schema 變更（新 migration）
- `experts` 新增 `currency text not null default 'TWD' check (currency in ('TWD','USD'))`
- `current_prices` 新增 `currency text not null default 'TWD'`（同一代碼不會跨幣別衝突，但讓 UI 知道顯示符號）
- `stock_names` 新增 `currency text default 'TWD'`、`market text`（用來區分美股市場：NASDAQ/NYSE）
- `expert_signals` / `trade_records` 不新增欄位 — 幣別永遠從關聯的 expert 帶出（單一來源、避免不一致）

### 衍生規則
- 老師一旦發過任何 signal 後，**禁止改 currency**（trigger 擋）。新老師發第一張前可改。
- 美股代碼格式：英文字母 1–5 碼（AAPL/TSLA/BRK.B）；台股維持 4–6 位數字。validator 依 expert.currency 切換。

## 二、報價（美股自動抓）

新 Edge Function `us-stock-quote`：
- 來源：**Finnhub**（免費 60 req/min、台灣可直連、回應穩定）；備援 Yahoo Finance unofficial。
- 需要 secret `FINNHUB_API_KEY`（會請使用者提供）。
- 輸入：`symbols: string[]`；輸出：`{ symbol, price, change, change_pct, currency: 'USD', fetched_at }`
- 寫回 `current_prices`（currency='USD'）供 holdings/績效讀。

新增 client helper `src/lib/usStockPriceFetcher.ts`，被 SignalEditor 的 `fetchStockInfo`、`useExpertHoldingsBundle`、收盤分析共用。

`stock-name-lookup` 擴充：偵測英文代碼時走美股名稱（Finnhub `/stock/profile2`）。

## 三、後台 SignalEditor

`src/pages/_signalEditor/`：
- `types.ts`：`CapitalStatus` 加 `currency`；`TradeDraft.quantityUnit` 加 `'shares'`（USD 專用，無「張」概念，預設且鎖死）
- `derive.ts`：`normalizeSignalQuantityToShares` 對 USD 直接回原值；錯誤訊息 `fmtMoney` 改用 `formatMoneyByCurrency(n, currency)`
- `CapitalPanel.tsx`：金額顯示前綴依 currency 切 `NT$` / `US$`；持倉表頭 `股數`→USD 時改 `Shares`
- `TradeCard.tsx`：USD 時隱藏單位下拉、強制 `shares`；股票代碼 placeholder 改 `AAPL / TSLA`
- `SignalEditor.tsx`：傳 `expert.currency` 進子元件；發布時 validate stockCode 格式

`useSignalEditorData.ts` 從 `expert` 帶出 currency 一併回傳。

## 四、前台讀者端

- `src/components/SignalCard.tsx`：所有金額用 `formatMoneyByCurrency`，依 signal 的 expert.currency
- 績效頁 `src/pages/_adminPerformance/*` + `src/hooks/usePerformance.ts`：起始資金、現金、PnL 金額前綴切換；排行榜不混算（USD/TWD 分流顯示，**不換算**）
- 持倉面板 `useExpertHoldingsBundle` 回傳 currency；所有消費端（FreeCheckup 持倉看板、SignalCard、CapitalPanel、Holdings 卡）皆讀此
- LINE / Email 推播 4 個 Edge Functions（`line-push-signal`、`line-push-renewal-reminder`、`email-push-renewal-reminder`、`subscribe-renew-link`）：訊息文字金額前綴依 currency

## 五、共用工具

新檔 `src/lib/currency.ts`：
```ts
export type Currency = 'TWD' | 'USD';
export const CURRENCY_SYMBOL: Record<Currency,string> = { TWD: 'NT$', USD: 'US$' };
export const formatMoneyByCurrency = (n: number, c: Currency = 'TWD') =>
  `${CURRENCY_SYMBOL[c]}${(Math.round(n) || 0).toLocaleString()}`;
export const isValidSymbol = (code: string, c: Currency) =>
  c === 'USD' ? /^[A-Z]{1,5}(\.[A-Z])?$/.test(code) : /^\d{4,6}$/.test(code);
```

`fmtMoney`（types.ts）改為 `formatMoneyByCurrency` 的 thin wrapper，預設 TWD，向後相容。

## 六、後台 expert 設定 UI

`src/pages/admin/AdminProfile.tsx`（或對應 expert 編輯頁）加幣別下拉，發過 signal 後鎖死灰階。

## 七、測試

- `src/test/unit/currency.test.ts`：formatter + symbol validator
- 擴充 `signal-editor-mixed-batch.test.ts`：跑一次 USD 情境（買 AAPL 100 股、賣 50 股）
- 新 `supabase/functions/us-stock-quote/test.ts`：mock Finnhub 回應

## 八、回滾策略

- 預設 `'TWD'` → 既有資料零影響
- Edge function 失敗時 priceHint 仍可手填
- currency lock trigger 不檔現有資料

## 需要使用者提供

- **Finnhub API Key**（finnhub.io 免費註冊即得）— 計畫核准、開始實作前我會用 secret 工具請你貼上

## 不在本次範圍

- 匯率折算 / 跨幣別總績效（已確認不做）
- 港股 / 加密貨幣（未來再說）
- ACpay / 金流幣別（金流仍只收 TWD，與訊號幣別無關）
