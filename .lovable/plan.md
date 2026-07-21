## 問題根因（已核對）

趨勢圖只有 5 天骨架、折線畫不出來，**不是前端 clamp 的問題，是資料庫本來就只有那幾天**：

- `tw-institutional-daily-sync` 是「每日一次、抓當日全市場」的排程，新加入的持倉只會從加入那天起累積。
- `enqueue_bsr_first_fetch_on_trade` trigger（`20260721060335`）只在 `trade_records` insert 時塞**1 筆**當天的 BSR 佇列，`tw-bsr-finmind-sync` 也沒有 per-stock 的多日回補入口。
- `tw-chips-detail` 抓 `.limit(65)` 已經沒問題，是上游沒資料。

上一輪只在前端 `ChipsTrendChart.tsx` 加 clamp/fallback，是治標。使用者要「找過去的」= 補歷史。

## 修正範圍

### 1. 三大法人 per-stock 歷史回補（新增能力）

`supabase/functions/tw-institutional-daily-sync/index.ts` 加入新模式：

```
POST /tw-institutional-daily-sync
body: { mode: "backfill_stock", stock_id: "2330", days: 60 }
```

- 改走 FinMind `TaiwanStockInstitutionalInvestorsBuySell`（單檔多日，1 次 request 拿 60 天），避開 TWSE T86「單日全市場」限制。
- 沿用既有 `finmindRateLimit` 保留額度（1 request、weight=1）。
- upsert 進 `tw_institutional_daily`（`stock_id,trade_date` 去重）。
- 失敗回退：FinMind 失敗時逐日呼叫 TWSE T86（保留現有邏輯），但只掃該檔。

### 2. BSR 首次抓取一次補 60 天

修改 `supabase/migrations/*` 新增 migration，改寫 `enqueue_bsr_first_fetch_on_trade`：

- 新持倉插入時，一次塞 **N 個工作日**（N=60，跳過假日）的 P1 pending 到 `tw_bsr_sync_queue`，`post_close_only=false`，`enqueued_by='trade_insert_hook_backfill'`。
- 用 `ON CONFLICT DO NOTHING` 避免與現有 pending 撞。
- 只對 chip-eligible（4 碼、首位 1-9）觸發，維持既有規則。
- 舊 trigger 保留邏輯做為「已有資料就跳過」的短路。

Worker（`tw-bsr-worker-tier1-catchup`）不動，它會依 rate limit 消化這批 60 筆。

### 3. 新持倉自動觸發三大法人回補

在同一個 trigger（或另建 `enqueue_inst_backfill_on_trade`）用 `pg_net` / `supabase_functions.http_request` 非同步呼叫 `tw-institutional-daily-sync` 的 `backfill_stock` 模式，days=60。已存在 `tw_institutional_daily` 該檔任一筆就跳過。

### 4. 前端「補歷史」手動入口

`src/checkup/components/freecheckup/ChipsSection.tsx`：

- 當 `series.institutional_daily.length < 20` 或 `bsr_concentration.length < 5` 時，在資料稀疏提示旁加「回補過去 60 日」按鈕。
- 按下呼叫兩個 edge functions（inst backfill + 塞 BSR 佇列 RPC `enqueue_bsr_backfill(stock_id, days)`）。
- 呼叫成功 toast「已排入回補，約 5–15 分鐘內完成」，並啟動既有 60s 自動重抓。

### 5. 前端 clamp/fallback 保留

`ChipsTrendChart.tsx` 上一輪加的 fallback 不動——回補到位前仍需優雅顯示；到位後自然畫出完整折線。

## 技術細節

- **新 RPC** `public.enqueue_bsr_backfill(p_stock_id text, p_days int default 60) returns int`：
  - `security definer`、限管理員或 owner（呼叫者持有該 instrument 的 trade_records）。
  - 產生過去 N 個工作日的 pending 行，回傳實際 insert 數量。
  - GRANT EXECUTE TO authenticated, service_role。
- **FinMind endpoint**：`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInstitutionalInvestorsBuySell&data_id={stock_id}&start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}`，欄位 `Foreign_Investor / Investment_Trust / Dealer` 需合併 self/hedge 兩支 dealer。
- **速率**：60 天新持倉 = 1 次 FinMind inst + 60 次 BSR queue（分散在 rate limiter 5 req/min → 約 12 分鐘吃完），符合現有 1500/hr 總額。
- **Migration 順序**：先建 RPC 與新 trigger，再重跑一次現有持倉的 backfill（一次性 seed script，寫在 migration 尾部 `DO $$ ... $$`，掃 `trade_records` 找 chip-eligible 且 `tw_bsr_daily` 少於 20 天者，補齊）。

## 驗證

- Seed migration 執行後，`select stock_id, count(*) from tw_bsr_daily group by 1 having count(*) < 20` 應在 15 分鐘後歸零（或僅剩上市不足 60 天者）。
- 打開任一台股抽屜切「20 日 / 60 日」應能畫出完整折線，X 軸有 ≥ 20 個日期點。
- 新增 `e2e/chips-trend-backfill.spec.ts`：mock `tw-chips-detail` 回 60 點資料，斷言 SVG 內 `<path>` 的 `d` 屬性有 ≥ 60 個 `L` 指令。
- Edge function deno test：`tw-institutional-daily-sync` 的 `backfill_stock` 模式對 mock FinMind 回應能正確 upsert 60 筆。

## 不動

- `tw-chips-detail`（讀取端已足夠）。
- `ChipsTrendChart` 的 clamp/fallback（做為安全網保留）。
- rate limiter / worker 排程時窗（14:00–20:59）——回補走 P1，本來就繞過時窗限制。
