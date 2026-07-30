# ADR-0002：股價以 DB 權威價為唯一來源

- 狀態：Accepted
- 日期：2026-07-30

## 背景

持倉看板的股價與收盤後對不上：前台同時存在瀏覽器 `marketPriceCache`、即時報價 API、DB 同步價三個來源，
各元件挑自己方便的那個讀，結果同一檔股票在總覽、抽屜、觀察清單顯示三個數字。

## 決策

**Authoritative Price（權威價）以 DB 同步結果為唯一事實**：

- 台股 14:05（台北）同步收盤價；美股與美股選擇權另由 Yahoo Finance 同步。
- 前台任何讀價都必須經過 `src/checkup/lib/priceResolver.ts` 或
  `mergeAuthoritativeIntoPriceCache()`；禁止直接讀 `marketPriceCache.prices`。
- watchlist 套價收斂在 `src/checkup/lib/watchlistQuotes.ts` 這個 seam，可單測。
- `PriceParityCard` 監控前後台價差，超過 0.5% 告警。

## 替代方案

- **前台每次即時抓報價**：延遲高、被上游限流，且盤後仍會與收盤價不一致。
- **保留多來源但加 fallback 順序**：來源優先序散落在各元件，就是現況的病因。

## 後果

- 新增讀價的地方一律要走 resolver；直接讀 cache 會在 price-authority 測試被抓。
- 同步任務失敗時前台會顯示舊價而非錯價，這是刻意選擇（寧可舊，不可歧異）。
