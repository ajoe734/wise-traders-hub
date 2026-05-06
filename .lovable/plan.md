## 問題

`/expert/:slug` 「績效總覽」的「最佳 / 最差」在 週/月/年 三個 tab 切換時不會跟著區間變化，且目前出現 best=worst=同一檔（3006 晶豪科）的 bug。

## 根因（已用 SQL 與檔案核實）

1. `usePeriodPerformance.ts` 對未平倉部位**只在「今天」**用 `current_price`，歷史日期一律退回 `entry_price` → 歷史 bucket 內各檔 returnPct 全是 0%。
2. `PerformanceOverviewPanel.tsx` 跨所有 bucket reduce `topStock` / `bottomStock` 取極值 → best 抓到今天 +14.94%、worst 被歷史 0% bucket 蓋成同一檔 0.00%。
3. 即使修對 reduce，best/worst 也應該隨 tab 切換（週/月/年）對應不同區間，目前邏輯沒做這件事。

## 修正

### A. `src/hooks/usePeriodPerformance.ts`

新增「區間級」聚合，計算每檔在該 period 區間內的「區間報酬」：

- 區間定義
  - `weekly`：本週週一 00:00 ~ 今天
  - `monthly`：上個月 1 日 ~ 今天（沿用既有 `getMonthlyDays` 的起訖）
  - `yearly`：12 個月前的月初 ~ 今天（沿用既有 `getYearlyMonthEnds` 的起訖）

- 每檔 instrument 在區間內的計算
  - `pnlInRange`：用既有 `snapshotPnL` 的單股版本，計算「期末 PnL − 期初前一交易日 PnL」（已 exit 用 exit_price，未平倉今日用 current_price，其他日用 entry_price）。
  - `costBase`：區間內曾經持有的最大成本（簡化為 `Σ entry_price × quantity`，僅計入 entry_date ≤ rangeEnd 的部位）。
  - `returnPct = pnlInRange / costBase × 100`。
  - 若 `costBase = 0` 視為無持倉，跳過。

- 把結果掛在最後一個 bucket 的 `rangeStocks`（避免改動 `PeriodBucket` 對其他使用者的語意）。`PeriodBucket` interface 增加 `rangeStocks?: StockTrade[]`。

### B. `src/components/strategy/PerformanceOverviewPanel.tsx`

`periodStats` 改成讀「最後一個 bucket 的 `rangeStocks`」：

- `best` = sorted[0]
- `worst` = sorted.at(-1)，且 symbol ≠ best.symbol，否則回傳 undefined（單檔時 FloatingStatCard 只顯示 best）

不再跨 bucket reduce，週/月/年切換時 query key 已含 period，`rangeStocks` 區間不同 → best/worst 自動跟著變。

不動既有 bucket 內的 `topStock` / `bottomStock` 與 `stocks`（圖表點選 bucket 顯示 top5/bottom5 仍沿用舊邏輯）。

## 驗證

完成後在 `/expert/sharkgu#plans`：

- DB 現況：3006(+14.94%) / 3035(+7.40%) / 6526(+11.97%)，皆 2026/05/04 入場。
- 週 / 月 / 年三個 tab 預期：best = 3006 +14.94%、worst = 3035 +7.40%。
- 因為三檔都同一天進場，三個 tab 數字一致；後續若有跨期交易，三個 tab 會出現差異。

額外手動確認：點擊圖表上的 bucket 仍顯示該日的 top5 / bottom5（不受影響）。
