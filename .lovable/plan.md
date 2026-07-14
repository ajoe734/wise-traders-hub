# 美股取價與計算管線

目標：分析師在 `experts.markets` 加入「美股」標籤後，可發布美股訊號並自動同步報價、更新持倉現價、日績效與快照——與現有台股管線並行、互不干擾。

## 一、判別「這筆是美股」的規則（全站唯一來源）

新增 `supabase/functions/_shared/marketDetect.ts`：

```ts
export type Market = 'TW' | 'US';
export function detectMarket(instrument: string): Market {
  const sym = instrument.split(' ')[0]?.trim() ?? '';
  // 台股：純數字（含 ETF 如 00878）
  if (/^\d{4,6}[A-Z]?$/.test(sym)) return 'TW';
  // 美股：字母 + 可選 . / -（如 BRK.B、GOOG）
  if (/^[A-Z][A-Z.\-]{0,9}$/.test(sym)) return 'US';
  return 'TW'; // 舊資料保底走台股
}
export function currencyOf(m: Market) { return m === 'US' ? 'USD' : 'TWD'; }
```

不改 `instrument` 現有格式（`"AAPL Apple Inc."` / `"2330 台積電"`），symbol 由 `split(' ')[0]` 取出，這與 `daily-snapshot`、`schedulerCalc.extractSymbol` 一致。

## 二、資料庫 schema（single migration）

```
ALTER TABLE public.current_prices        ADD COLUMN market text NOT NULL DEFAULT 'TW',
                                         ADD COLUMN currency text NOT NULL DEFAULT 'TWD';
ALTER TABLE public.trade_records         ADD COLUMN market text,
                                         ADD COLUMN currency text;
ALTER TABLE public.expert_signals        ADD COLUMN market text;
ALTER TABLE public.daily_price_snapshots ADD COLUMN market text NOT NULL DEFAULT 'TW';
ALTER TABLE public.stock_names           ADD COLUMN market text NOT NULL DEFAULT 'TW';
CREATE INDEX ON public.current_prices (market);
CREATE INDEX ON public.trade_records (market) WHERE market='US';
```

- `market/currency` 在寫入時用 `detectMarket()` 回填。
- 舊資料 backfill：`UPDATE ... SET market='TW', currency='TWD' WHERE market IS NULL;`
- 美股 `limit_up/limit_down` 保持 NULL（美股無 10% 漲跌停）。

## 三、取價瀑布：新增美股專用管線

新增 `supabase/functions/_shared/usStockPriceWaterfall.ts`（不動 `stockPriceWaterfall.ts`）：

- L1 Yahoo Finance：`https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval=1d&range=1d`（symbol 無後綴）。回傳 regularMarketPrice / previousClose / regularMarketDayHigh / Low / Volume。
- L2 Stooq：`https://stooq.com/q/l/?s={symbol.toLowerCase()}.us&i=d&f=sd2t2ohlcv`（CSV 兜底）。
- L3 記錄失敗到 `checkup_price_misses`（既有表）。

介面回傳統一為 `{ price, prev_close, day_high, day_low, volume, source }`，供上層 upsert 用。

`_shared/stockPriceWaterfall.ts` 加一個 dispatcher：`fetchQuote(symbol, market)` → market='US' 走上面，其餘走原本台股瀑布。呼叫端只認 dispatcher。

## 四、Edge Functions 改動

1. `supabase/functions/stock-price-sync/index.ts`
   - 讀取待更新 symbol 時，依 `market` 分兩批：TW 走原邏輯、US 走 `usStockPriceWaterfall`。
   - upsert `current_prices` 時同步寫入 `market/currency`，`limit_up/limit_down` 對美股寫 NULL。
   - Cron：**新增一個** `stock-price-sync-us`（cron `*/15 21-23,0-4 * * 1-5` UTC，含 DST 稍寬鬆），觸發時帶 `{ market: 'US' }`；`stock-price-sync` 原排程 body 加 `{ market: 'TW' }`；函式內以 body.market 決定分支，預設 both。

2. `supabase/functions/daily-performance/index.ts`
   - 讀 `trade_records` 時同時取 `market`；`fetchClosingPrice` 依 market 走 dispatcher。
   - `pnl_percent` 沿用 `calcDailyPnl`（原生幣別），不做 FX 換算。
   - `audit_logs.details` 標註 `market`。

3. `supabase/functions/daily-snapshot/index.ts`
   - 依 `market` 分開跑：
     - TW：現有邏輯不動（含 `is_limit_up`）。
     - US：`is_limit_up` 恆 false，快照 `symbol,trade_date` 之外，`market='US'`；`trade_date` 用 **紐約時區當日**（`Intl.DateTimeFormat` timezone `America/New_York`）避開週末錯位。
   - `expert_limit_up_hits` 只寫 TW 命中。

4. `supabase/functions/publish-weekly-journals/index.ts`
   - 送出 pending signal 時，用 `detectMarket(instrument)` 回填 `expert_signals.market`。
   - 同步 `trade_signals / user_performances` 也帶 market/currency。
   - Gate：若 `detectMarket=US` 但該 expert `markets` 陣列不含「美股」/「US」，寫警告 log 但仍發布（避免卡舊資料；硬擋另議）。

## 五、`_shared/weekBoundary.ts` 與時區

- 台股週界仍用 Asia/Taipei（既有）。
- 美股「trade_date」用 `America/New_York`，加 helper `nyTradeDate(d: Date)` 到 `_shared/marketDetect.ts` 同檔。
- 週績效聚合仍以 Taipei 週為單位（分析師發布節奏綁台北），美股只是每日快照日期改用 NY。

## 六、前端顯示（最小改動）

- 持倉 / 訊號卡片：讀到 `market='US'` 時，價格顯示 `USD $` 前綴；台股維持 `NT$`。
- `formatTaipeiYMD` 保留給發布時間戳；美股個股「當日交易日」欄位新增小 helper `formatUsTradeDate` 走 `America/New_York`。
- 排行榜 / 漲停榜：`expert_limit_up_hits` 天生不含美股 → 顯示層零改動。

## 七、Unit / Regression 測試

新增：
- `src/test/unit/marketDetect.test.ts`：symbol 判別（2330 / 00878 / AAPL / BRK.B / GOOG / 邊界字串）。
- `src/test/unit/usTradeDate.test.ts`：NY 時區跨日、DST 切換（3 月 / 11 月）、週末回推。
- `supabase/functions/_shared/__tests__/usStockPriceWaterfall.test.ts`（Deno test）：Yahoo 正常 / Yahoo 404 → Stooq 兜底 / 全失敗 → miss 記錄。
- `src/test/integration/us-scheduler.test.ts`：drift-detection 檢 `stock-price-sync`、`daily-performance`、`daily-snapshot` 三個 index.ts 是否含 `market === 'US'` 分支、`America/New_York`、`usStockPriceWaterfall` import、`limit_up` 對美股跳過。

原 `1.23-scheduler-sequencing.test.ts` 台股斷言全部保留。

## 八、上線步驟

1. `supabase--migration` 加欄位 + backfill。
2. 部署 `_shared/marketDetect.ts` / `usStockPriceWaterfall.ts` 與三支 edge functions。
3. `cron.schedule('stock-price-sync-us', ...)` 用 `supabase--insert` 建立（含 anon key，不進 migration）。
4. 讓阿基米德在 `/admin/<slug>/profile` 加「美股」標籤，發一筆測試訊號（如 `AAPL Apple Inc.`）→ 驗證 `current_prices`、`trade_records.current_price/pnl_percent`、`daily_price_snapshots` 三處都有 US 紀錄。

## 不做（本輪外）

- FX 換算 / 台幣化總資產（保留原生幣別，顯示層自行標註）。
- 美股 pre/post market、選擇權、複委託手續費模型。
- 美股「發布時窗」（沿用台北 週一 08:00–週五 20:00；若要改成 NY 交易日再議）。
- UI 把 `markets` 從自由文字改成 enum 下拉（本輪維持文字，用 `includes('美股')` 判斷）。
