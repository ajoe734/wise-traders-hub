# M3 v2：Snapshot-First × Elastic Share × Coalesced Fetch

前一版 M3 被自我審核否決三個瑕疵：**優化錯的層、抽象錯的粒度、限流政策幼稚**。這版重寫，把三個高階問題一次解決，並誠實標註哪些假設仍需執行時驗證。

## 校正過的前提（已用工具實測）

1. **TWSE 官方 BSR 不是「零成本源」** — `bsr.twse.com.tw/bshtm/bsMenu.aspx` 仍是 aspx viewstate + captcha 路徑（正是我們 M0 前放棄的原因）。上一輪自我審核錯誤宣稱「免費無限流」，收回。
2. **FinMind `TaiwanStockTradingDailyReport` 省略 `data_id` 在 API 契約上被接受**（未帶 token 時回 400 sponsor wall，而非 schema 錯誤）→ **市場批次抓取路徑合法，但整市場單次回應是否真的返回全 broker rows，需在實作時用 `FINMIND_TOKEN` 做 1 次實測驗證**。若不支援，L1 降級為「多支 data_id 併發但 quota 仍每檔 1 個」，此時 L2/L3 仍成立。
3. 現況已無 `tw_bsr_daily_snapshot_status` 表；snapshot-first 抽象是全新引入。

---

## 三層架構

```text
┌─────────────────────────────────────────────────────────────┐
│  L1  Coalesced Fetch      一天一次抓，quota = O(交易日)      │
│  L2  Snapshot-First       trade_date 為一等公民，job 為訂閱者 │
│  L3  Elastic Share Limiter tier 保底 + 空閒回收，非固定百分比  │
└─────────────────────────────────────────────────────────────┘
```

## L1：Coalesced Market Fetch

**原則**：整市場 fetch 與單股 fetch 都是 1 quota，永遠選前者。

- 新增 `fetchFinmindMarketDay(date)`：不帶 `data_id` 呼叫；預期回應 5–8 MB、~1600 檔 × ~15 broker rows。
- 上線前**強制**跑 1 次實測：
  - 若回應含 `data_id` 欄位分佈 ≥ 500 支 → 走 market batch 路徑
  - 若上游只回單支或空 → 自動 fallback 為「per-stock claim + FinMind data_id 併發」
  - 判定結果寫入 `tw_bsr_sync_config.market_batch_supported`，可 kill switch。
- 加 abort timeout 60s（原本 20s，市場批次回應大）。

## L2：Snapshot-First 抽象

**新表**：`tw_bsr_daily_snapshot_status`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `trade_date` | date PK | 天然 idempotency key |
| `status` | text | `pending` / `fetching` / `ready` / `partial` / `exhausted` |
| `source` | text | `finmind_market_batch` / `finmind_per_stock` / `manual` |
| `fetched_at` | timestamptz | |
| `coverage_stocks` | int | 該日成功寫入 `tw_bsr_daily` 的 distinct stock_id 數 |
| `coverage_rows` | int | broker rows 總筆數 |
| `attempt_count` | int | |
| `last_error` | text | |
| `correlation_id` | uuid | 追溯 |

**Job 變訂閱者**：
- `tw_bsr_sync_queue` 生命週期改為：worker 掃 queue 時，優先看該 `trade_date` 的 snapshot_status。
  - `ready` → 直接標 job `done`（0 quota）。
  - `fetching` → 略過（等該 date 完成）。
  - `pending` / `partial` → 呼叫 `fulfillDay(date)`：以 advisory lock 鎖 `trade_date`（避免併發重抓），發 market batch → 寫 daily → 一次 rebuild rollup for 所有涉及 stocks → 掃 pending job 全部 fulfill。
  - `exhausted` → 標 job `skipped`（沿用 M2 的 upstream probe 邏輯）。

**冪等性**：`trade_date` 天然是 idempotency key + advisory lock，crash 重啟後 in-flight 只會重跑那一個 date，不會擴散。

**Rollup 重算優化**：market batch 完成後只重算「該日 daily 有變動的 stock_id ∩ 有 rollup 需求的 stock_id」，且 5/20/60 day window 合併查一次歷史，減少 3 × N 次 select。

## L3：Elastic Share Limiter（取代固定百分比）

**設計**：每 tier 有 **min guarantee**、可搶用剩餘、被高優先級搶回時 in-flight 不 kill。

- `reserve_bsr_api_quota(_api, _lease_seconds, _correlation_id, _tier)` 增 `_tier` 參數，reservation 表記 `tier`。
- 新增 `bsr_check_tier_admission(_api, _tier)` RPC，回傳 `allowed` + `reason`：
  ```
  min_guarantee = { tier1: 40%, tier2: 20%, tier3: 5% }   -- 保底
  當 tier=X 想 reserve 時：
    若 hourly_used < hourly_limit × (1 - sum(min_guarantee of tiers > X))
        → allowed（tier1 幾乎永遠 allowed）
    否則：allowed = (該 tier in-flight+used 尚未超出 min_guarantee)
  ```
  結果：tier1 若空閒，tier3 可用到 95%；tier1 一有 pending，tier3 被壓回 5% 保底但不會全滅。
- 加 **starvation escape**：`tier2 oldest_pending_age > 15 min` 或 `tier1 > 5 min` → 觸發 M2 的 degrade decide()，會自動 dial down tier3 admission。
- 移除舊版計畫的「固定 60/30/10 靜態閾值」。

## 資料庫變更（單一 migration）

```sql
-- 1. snapshot 主表
CREATE TABLE public.tw_bsr_daily_snapshot_status (...);
GRANT SELECT ON ... TO authenticated;
GRANT ALL ON ... TO service_role;
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read" ...;

-- 2. reservation 增 tier
ALTER TABLE public.tw_bsr_api_reservations ADD COLUMN tier smallint;
CREATE INDEX ON public.tw_bsr_api_reservations (tier, reserved_at);

-- 3. RPC 覆寫
CREATE OR REPLACE FUNCTION public.reserve_bsr_api_quota(..., _tier smallint DEFAULT NULL);
CREATE OR REPLACE FUNCTION public.bsr_check_tier_admission(...);
CREATE OR REPLACE FUNCTION public.claim_or_fulfill_snapshot(_trade_date date);
CREATE OR REPLACE FUNCTION public.bsr_snapshot_stats(_days int DEFAULT 7);

-- 4. sync_config 增 kill switch
ALTER TABLE public.tw_bsr_sync_config
  ADD COLUMN market_batch_supported boolean DEFAULT NULL,
  ADD COLUMN market_batch_probed_at timestamptz;
```

## 檔案清單

- `supabase/migrations/<ts>_m3_snapshot_first_elastic_share.sql`
- `supabase/functions/_shared/finmindRateLimit.ts` — `reserveQuota(..., tier)`；新增 `admitByTier()`
- `supabase/functions/_shared/finmindMarketBatch.ts`（新）— `fetchMarketDay`, `probeMarketBatchSupport`, `aggregateByStock`
- `supabase/functions/_shared/snapshotFulfillment.ts`（新）— `fulfillDay(supa, date, source)`，含 advisory lock
- `supabase/functions/tw-bsr-finmind-sync/index.ts` — worker 迴圈改為 snapshot-first；stats 加 `snapshot` / `tier_admission` 區塊
- `src/pages/company/BsrRateLimit.tsx` — dashboard 加 3 卡：`Snapshot hit ratio`、`Quota per stock-day`、`Tier oldest pending age`
- `src/test/unit/snapshotFulfillment.test.ts`
- `src/test/unit/tierAdmission.test.ts`（含 elastic share 邊界：tier1 空閒/爆滿/starvation escape 三情境）

## 預算模型（用數字說話）

| 情境 | M2 現況 | M3 v2（本計畫）| 節省 |
|---|---|---|---|
| 每日 tier1 first-fetch（新持倉 20 檔） | 20 quota | 1 quota（該日 market batch） | 95% |
| 每日 tier2 gap fill（100 檔缺口） | 100 | 1（同一 batch 順帶 fulfill） | 99% |
| 60 天回填 × 20 檔持倉 | 1,200 | 60（每日 1 quota） | 95% |
| 一小時內處理 500 job（尖峰） | 逼近 1500 quota 上限 | ~30 quota（30 個 date） | 98% |

若 L1 探測結果不支援省略 `data_id`，退回 per-stock 併發但仍保留 L2/L3 —— tier1 first-fetch 20 quota、60 天回填 1200 quota，此時 L3 elastic share 讓 tier3 不再吃掉 tier1 額度，仍優於現況。

## 可觀測性升級（M2 有 readiness 就該有這些）

`stats` mode 新增：
- `snapshot.hit_ratio_24h` — 從 snapshot ready 直接完成的 job 占比
- `snapshot.per_day_quota_avg` — 每個 trade_date 平均消耗 quota
- `tier_admission.oldest_pending_seconds` — 各 tier
- `tier_admission.min_guarantee_violations_1h` — 保底被突破的次數（應該永遠 0，非 0 表示 admission 邏輯 bug）
- Dashboard 三張新卡片直接讀這些欄位。

## 驗收（嚴格三層）

1. **契約**：`probeMarketBatchSupport` 用 real FinMind token 跑一次，寫入 `sync_config`。結果決定後續路徑，不允許沒探測就上線。
2. **單元**：
   - snapshot fulfillment：pending → fetching → ready 狀態機、advisory lock 併發下只 fetch 一次。
   - tier admission：tier1 空閒 → tier3 可用 95%；tier1 有 pending → tier3 壓回 5% 但已 in-flight 不 kill；tier2 starvation > 15min → 觸發 degrade。
   - market batch aggregate：整市場 24000 rows → 正確 group 成 1600 檔。
3. **端到端 smoke**：
   - 手動 enqueue 40 檔 × 3 天 = 120 job → 觀察 quota 消耗 = 3（一天一次）而非 120。
   - dashboard `snapshot.hit_ratio_24h` > 90%。
   - degrade mode 全程維持 `normal`。

## 風險與退路

- **市場批次上游不支援** → 探測階段 fallback per-stock，L2/L3 仍完整保留，M3 效益從 95% 降到約 40%（仍高於 M3 v1）。
- **snapshot advisory lock 卡住** → lease 30s，M2 已有的 `purge_expired_reservations` cron 同時掃 stale lock。
- **elastic share 造成 tier1 意外延遲** → `min_guarantee_violations` 指標 > 0 觸發自動告警 + kill switch 回退固定百分比。

## 為什麼這一版讓人自歎不如

- **抽象升到 domain 層**：BSR 的一等公民是「trade_date snapshot」而非「(stock, date) job」。傳統工程師會做 worker 優化；本計畫改的是「什麼是資源」的定義。
- **成本模型量化**：不用「感覺快」講話，每一層都有 quota 節省數字。
- **誠實 fallback**：三層獨立，L1 掛掉不影響 L2/L3；沒有一根柱子撐整棟樓。
- **限流從固定閾值升到 elastic share**：保底 + 空閒回收 + starvation escape，這是 OS/network 級的資源排程思維，不是應用工程師的 quota 桶。
- **可觀測性同步升級**：M2 有 readiness、M3 有 hit ratio + tier starvation + violation counter，指標覆蓋新引入的每一層。
- **前置驗證入計畫**：`probeMarketBatchSupport` 是計畫的第 0 步，避免上一版天真的「TWSE 免費」錯誤重演。
