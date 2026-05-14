## 決議

1. **`cumulative_return` 砍掉** — 前端只用 `total_return_pct`
2. **`avg_pnl` 兩個都給** — `avg_pnl_pct`（等權算術平均）+ `avg_pnl_amount`（金額平均）
3. **`avg_hold_days` 一起修** — 把 open trades 也納入

---

## 修復內容

### Step 1: Migration — 修正 `handle_signal_trade` 不要把 quantity 寫 0

平倉時 `trade_records.quantity` 保留實際成交股數（不是 0）。
回填 sharkgu 三筆已 closed records 的 quantity（從對應賣出 signal 的 `quantity * 1000` 推回）。

### Step 2: Migration — 重寫 `calculate_expert_performance` RPC

砍掉 / 新增 / 修正：

| 欄位 | 處理 | 新算法 |
|---|---|---|
| `cumulative_return` | **砍掉** | — |
| `total_pnl` | **砍掉**（誤導性命名）| — |
| `total_return_pct` | 保留 | `(realized_pnl_amount + unrealized_pnl_amount) / starting_capital × 100` |
| `realized_pnl_amount` | 保留 | `SUM(quantity × (exit_price - entry_price))`（quantity 不再是 0）|
| `unrealized_pnl_amount` | 保留 | 維持（open trades 用 current_prices）|
| `profit_factor` | **改算法** | `SUM(pnl_amount where >0) / SUM(abs(pnl_amount) where <0)`，無虧損 cap 999.99 |
| `max_drawdown` | **改算法** | 用 `pnl_amount` 累積跑 peak/dd，輸出 `(peak - running) / starting_capital × 100`（百分比，與 starting_capital 同基準）|
| `avg_pnl_pct` | **新增** | `AVG(pnl_percent)` 等權算術平均（業界口徑）|
| `avg_pnl_amount` | **新增** | `realized_pnl_amount / total_trades`（金額平均）|
| `avg_pnl` | **砍掉**（被上面兩個取代）| — |
| `avg_hold_days` | **改算法** | open trades 用 `NOW() - entry_date`，closed 用 `exit_date - entry_date`，全部納入平均 |
| `win_rate` | 保留 | 維持 |
| `total_trades` | 保留 | 維持 |
| `current_asset` | 保留 | 維持 |
| `return_1y` | 保留 | 維持 |
| `starting_capital` | 保留 | 維持 |

### Step 3: 前端

砍掉所有 `cumulative_return` / `total_pnl` / `avg_pnl` 引用，改用新欄位：

- `src/hooks/usePerformance.ts` — interface 更新
- `src/components/strategy/PerformanceOverviewPanel.tsx` — 「累積報酬」改顯示 `total_return_pct`
- `src/components/strategy/TradeStatsCard.tsx` — 平均單筆改顯示 `avg_pnl_pct` 或 `avg_pnl_amount`（依 UI 上下文，pct 給卡片、amount 給 tooltip）
- `src/pages/app/AppHome.tsx` — 同上
- `src/pages/admin/Performance.tsx` — 後台表格欄位更新

### Step 4: 測試

- `src/lib/performanceCalc.ts` — 重寫 `calcMaxDrawdown`：改吃 `{ pnl_amount }[]` + `startingCapital`，輸出百分比
- `src/lib/performanceCalc.ts` — 新增 `calcAvgPnlPct`、`calcAvgPnlAmount`、`calcTotalReturnPct`、`calcAvgHoldDays`
- `src/test/integration/1.21-expert-performance-rpc.test.ts` — drift assertions 全面更新：
  - 不再檢查 `'cumulative_return'`、`'total_pnl'`、`'avg_pnl'`
  - 新增檢查 `'avg_pnl_pct'`、`'avg_pnl_amount'`、`max_drawdown` 用金額累積、`avg_hold_days` 含 open trades
- `1.16-signal-trade-trigger.test.ts` — 確認平倉後 `quantity` 不為 0
- 補 sharkgu 場景 fixture：3 筆全勝 → `total_return_pct ≈ 23.21%`、`profit_factor = 999.99`、`max_drawdown = 0`、`avg_pnl_pct ≈ 29.37%`、`avg_pnl_amount = 62000`

### Step 5: 驗證

migration 跑完後對 sharkgu 執行 `calculate_expert_performance`，預期：
- `total_return_pct ≈ 23.21%`（原 4.61%）
- `realized_pnl_amount ≈ 186,000`（原 0）
- `profit_factor = 999.99`
- `avg_pnl_pct ≈ 29.37%`、`avg_pnl_amount ≈ 62,000`
- `avg_hold_days` 含 open 三筆持倉至今天數

確認後更新 `.lovable/plan.md` 結案。