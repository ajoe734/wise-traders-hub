## 問題

週記管理列表所有訊號（含美股 SPCX / INTC / META）「價位」欄位一律顯示 `NT$`，應該美股 `US$`、台股 `NT$`。

## 根因

`src/pages/_adminSignals/SignalRow.tsx` L52：

```ts
const currency: Currency = normalizeCurrency(signal.currency) || spec.currency || defaultCurrency;
```

`normalizeCurrency()` 永遠回 `'TWD'` 或 `'USD'`（沒有 falsy 分支），所以 `spec.currency` / `defaultCurrency` 這兩層 fallback 永遠不會生效。加上 `expert_signals.currency` 欄位實務上不存在（先前 schema 修正已確認），`signal.currency` 恆為 `undefined` → `normalizeCurrency` 回 `'TWD'` → 美股照樣掛 NT$。

`priceSymbol` 也是同一支邏輯派生，所以「價位」欄整片壞。

## 修法

`SignalRow.tsx` 用既有 `resolveDisplayCurrency(explicit, instrument)`，並補 asset_class 判定，優先序：

1. `signal.currency` 明確為 `'USD' | 'TWD'` → 用它
2. `signal.asset_class` / `defaultAssetClass` 推得的 `spec.currency`（`us_stock` / `us_option` / `us_future` → USD）
3. `resolveDisplayCurrency(null, signal.instrument)`（代號推斷）
4. `defaultCurrency`

以 helper 收斂：

```ts
function pickSignalCurrency(signal, spec, defaultCurrency): Currency {
  if (signal.currency === 'USD' || signal.currency === 'TWD') return signal.currency;
  if (spec.currency === 'USD') return 'USD';           // asset_class 已明示美股
  const inferred = inferCurrencyFromInstrument(signal.instrument);
  if (inferred) return inferred;
  return defaultCurrency ?? 'TWD';
}
```

`priceSymbol`、`toLocaleString` 的小數位 (`currency === 'USD' ? 2 : 0`) 都會跟著正確。

## 驗證

1. 新增 unit test：`src/pages/_adminSignals/__tests__/SignalRow.currency.test.tsx`
   - us_stock + 無 currency 欄位 → `US$116.30`
   - tw_stock 台積電 → `NT$580`
   - 明確 `signal.currency='TWD'` 但 asset_class us_stock → 尊重 explicit TWD
   - 只有 instrument `AAPL`（asset_class 缺）→ USD
2. `bunx vitest run src/pages/_adminSignals` 全綠。
3. Playwright 目視：`/admin/<slug>/signals` 頁面美股列 `US$`、台股列 `NT$`。

## 影響範圍

只動 `src/pages/_adminSignals/SignalRow.tsx`（helper 就地或抽到同資料夾 util）。不動 DB、不動 SignalsTable footer（那邊已用 `spec.currency` 正確）。
