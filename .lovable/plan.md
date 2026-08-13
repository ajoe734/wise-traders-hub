# Build2 Final Plan P2 — 市場整批 lane 修復（Stage P，唯讀查證）

**先更正你的前提（有實測反證）**：08-11 的 844 檔**不是** market batch 產生的。

```
tw_chip_fact by trade_date（實測）
date        stocks  rows      finmind_batch  finmind_per_stock
2026-08-13  63      39,388    39,388         0
2026-08-12  63      38,241    38,241         0
2026-08-11  844     214,253   28,094         186,159
2026-08-10  603     200,862    8,057         192,805
2026-08-03  1,014   249,966    7,501         242,465
```
且 `tw-bsr-finmind-sync/index.ts:229` 為 **per-stock** 路徑：`laneSource = tier === 1 ? 'finmind_batch' : 'finmind_per_stock'` —— 所以 `finmind_batch` 標籤**不代表市場整批**，tier1 的單股抓取也被標成 batch。高覆蓋日全部來自 `tier2_gaps` per-stock 大規模活動（queue `enqueued_by` 實測：tier2_gaps 各批 419–982 筆 done）。

---

## 1. 鏈路逐字（source 已讀）

```
runWorker(batch,maxPriority,budgetMs)            index.ts:463
 ├ mbCfg = loadMarketBatchConfig(supa)           finmindMarketBatch.ts:36  ← tw_bsr_sync_config[key='market_batch']
 ├ canMarketBatch = mbCfg.enabled && mbCfg.supported === true      index.ts:487
 ├ if (canMarketBatch && cappedMaxPriority >= 1)                   index.ts:488
 │   ├ 讀 tw_bsr_sync_queue status='pending' AND priority<=cap AND next_run_at<=now LIMIT 2000
 │   ├ 依 trade_date 分桶，filter total >= mbCfg.threshold_pending (15)，取 total 最大的前 3 天
 │   ├ fetchFinmindMarketDay(supa,date,cid,tier)  finmindMarketBatch.ts:63
 │   │    GET TaiwanStockTradingDailyReport?start_date=date（無 data_id），逾時 60s
 │   │    quota：fetchWithRateLimit(..., {tier, leaseSeconds:70}) → tier=1 → interactive 池
 │   └ fulfillDay(supa,date,cid,rows,'finmind_market_batch')  snapshotFulfillment.ts:183
 │        ├ claimSnapshot → rpc bsr_snapshot_claim(_trade_date,_correlation_id,_lease_seconds=90)
 │        │    未 claim（他人持有 / ready / exhausted）→ final_status='skipped_not_claimed'，直接返回
 │        ├ aggregate(rawRows)                    tw-bsr-finmind-sync/lib.ts
 │        ├ persistAggregated(...,'finmind_batch')  snapshotFulfillment.ts:104
 │        │    ① upsert tw_chip_fact，CHUNK=500，onConflict stock_id,trade_date,broker_id,source（冪等）
 │        │    ② rpc materialize_bsr_daily_from_fact(_trade_date, _stock_ids)  ← 只算本批 stock
 │        │    ③ rpc rebuild_bsr_rollup(_as_of,_stock_ids,_max_stocks=200)，每 200 檔一次
 │        ├ markSnapshot → rpc bsr_snapshot_mark(_trade_date,_status,_source,_coverage_stocks,_coverage_rows,_last_error,_sealed_by_lane)
 │        │    coverage.stocks>0 → 'ready'；=0 → 'partial'；throw → 'failed'+last_error
 │        └ fulfillJobsFromSnapshot → rpc bsr_snapshot_fulfill_jobs(_trade_date,_threshold=DONE_BROKER_THRESHOLD)
 │             回傳 {fulfilled, still_pending}；把該日 queue 行批次標 done
 └ Phase B：claim_bsr_queue_jobs（frozen）per-stock 補刀；若 batch 已清空 pending → note='snapshot_only'
```
Idempotency：fact upsert 唯一鍵去重；`materialize_bsr_daily_from_fact` 對 sealed 日回 `skipped_sealed`；`bsr_snapshot_claim` 保證同一 date 同時只有一個 fetch。
Expected date / 交易時段：market batch **不自帶** expected date 判斷，完全跟隨 queue 裡已有的 pending trade_date。

## 2. 觸發此 lane 的排程（實測 cron.job）

| jobid | schedule (UTC) | command |
|---|---|---|
| 45 | `30 7 * * 1-5` | `tw-bsr-finmind-sync {"mode":"enqueue","tier1":true,"tier2":false}` |
| 53 | `0,30 7-12 * * 1-5` | 同上（含 tier3:false） |
| 46 | `*/10 6-12 * * 1-5` | worker batch30 max_priority3 |
| 51 | `*/15 6-12 * * 1-5` | worker batch30 max_priority1 ignore_window |
| 98 | `*/10 * * * 6,0` | worker batch30 max_priority3 ignore_window |
| 107 | `7 * * * *` | worker batch30 max_priority3 ignore_window |
| 67 | `0 9 * * *` | `tw-bsr-finmind-sync {}`（預設 mode） |
| 106 | `2 * * * *` | `enqueue_chips_prefetch_gaps(10,300)` |

**沒有任何 cron 呼叫 `mode:'probe'`、`mode:'snapshot_fulfill'`、`mode:'market_batch_toggle'`。** 市場整批只能經由 worker 的 Phase A 自然觸發，無獨立 orchestrator、無 checkpoint。

## 3. 近 7 交易日狀態（實測）

- `tw_bsr_daily_snapshot_status` **只有 2 列**：08-13 / 08-12，皆 `status=partial`、`source=NULL`、`coverage_rows=0`、`attempt_count=0`、`lane_a=partial`、`lane_b/c=sealed`、`sealed_by_lane='BC_ONLY'`（由 DB 函式 `reconcile_snapshot` 寫，**非** `bsr_snapshot_mark`）。08-03～08-11 **完全沒有 snapshot 列** → `fulfillDay` 從未在這些日期成功執行過。
- `bsr_coverage_daily`：08-13=63、08-12=63、08-11=844、08-10=603、08-07=550。
- queue：pending **0**、running 3、failed **1661**（1359 `daily_exhausted:pool=keepwarm`、235 `rate_limited:keepwarm`、67 `daily_exhausted:interactive`）、近 24h done 138。
- `data_source_refresh_logs`(7d)：只有 `backfill_worker`(93 success/57 partial/18 failed)、`bsr_quota_recovery`(36 success)、`tw_keep_warm`、`tw_trading_calendar_catchup`(4 error)、`backfill_gap_orchestrator`(6 error)。**沒有任何 market batch 的 log**。
- `finmind_upstream_quota`：**0 列**（`recordUpstreamQuota(supa,'finmind_market_batch',...)` 從未寫入 → 該呼叫從未發生）。

**第一個斷點**：`tw_bsr_sync_config['market_batch'].config = {"enabled":true,"supported":false,"probed_at":"2026-07-25T08:54:27.674Z","threshold_pending":15,"min_stocks_in_response":500}` —— **自 2026-07-25 起 `supported=false`**，`canMarketBatch` 恆為 false。08-03～08-11 的覆蓋全靠 per-stock 大批活動；那批活動在 08-11 後停止（enqueue 母體縮回 `checkup_prefetch_universe` 的 63 檔），覆蓋因此掉到 63。

## 4. 08-13 逐段計數 → **BLOCKED**

| 段 | 實測 |
|---|---|
| market batch API 回傳 stocks/rows | **0 次呼叫**（upstream quota 表 0 列、無 log） |
| normalize (`aggregate`) | 未執行 |
| fact upsert | 39,388 列 / 63 檔，全部由 **per-stock tier1** 寫入（標籤 finmind_batch 屬誤標） |
| snapshot fulfill jobs | 未執行（無 snapshot source 記錄） |
| daily materialize | 39,388 列（per-stock 路徑內呼叫） |
| coverage refresh | 63 檔 |

→ 依你的規則「缺一步即 BLOCKED」：**08-13 market batch chain = BLOCKED（該 lane 當日完全未啟動）**。

## 5. Freshness universe 新定義（採納）

`FULL_MARKET(d) = { stock_id : 該日 market batch 回傳 且 tw_bsr_eligibility(stock_id).eligible }`，
missing 檢查 = `OBSERVED_60D_ELIGIBLE(1,551 檔) − FULL_MARKET(d)`。
不需 security master、不宣稱官方上市清單。
能否覆蓋任意使用者持股：**能**——只要該股當日在上游回傳中且為四碼普通股；四碼以外（ETF `0050`、ETN、權證）仍走既有 per-stock lane（`tw_bsr_eligibility` 會判 ineligible，此為既有語意，不在本票變更範圍）。

## 6. 最小修正（依根因排序）

**RC-1（主因）**：`market_batch.supported=false` 且無任何排程會重新 probe。`probeMarketBatchSupport` 在**任何例外**下也寫 `supported:false`（finmindMarketBatch.ts:130），因此 07-25 的 false **無法分辨「方案不支援」與「當次呼叫失敗」** → 這是唯一未知數。

修正 M1（唯一必要，最小）：新增 cron 呼叫既有 mode，**不改任何 function source**
```sql
-- 每週一 Taipei 09:05 重新探測（1 API call）
SELECT cron.schedule('bsr-market-batch-probe','5 1 * * 1',
  $$SELECT public.cron_edge_call('tw-bsr-finmind-sync','{"mode":"probe","force":true}'::jsonb,120000)$$);
```
**若 probe 回 supported=true**：**零程式碼變更**即可全鏈打通——job45/53 每交易日 enqueue tier1（63 檔同一 date，pending 63 ≥ threshold 15）→ job46/51/107 worker Phase A 觸發 `fetchFinmindMarketDay` → `fulfillDay` → 全市場單日 1 call 落 fact/daily/coverage，並 `bsr_snapshot_fulfill_jobs` 清空 queue。這正是「修既有 scheduler」而非新建 lane。

**若 probe 回 supported=false**：主路徑不可用 → **Build2 BLOCKED**，須另議兩條備援（本票不實作、也尚未查證）：
- 既有 `backfill-snapshots-twse-bulk`（job 87 `15 7 * * 1-5`、job 99 `20 7,13 * * 6,0`）為何未產出全市場 BSR — **未查證，列為 P2 待查**；
- FinMind 方案升級。

**不做**：新表、平行 queue、改 `claim_bsr_queue_jobs`(frozen, md5 `c28474cca7be420355edeefd6207104b`)、改 `runWorker`、改 UI、改 `detect_chip_gap_jobs`/job106。
per-stock stale-first 依 P1 結論**僅作歷史補洞**，不在本票。

## 7. 容量

- 每交易日：market batch **1 call**（失敗重試上限 3 個候選日 → 最多 3 calls/輪，由 `threshold_pending` 與 pending 桶自然收斂）；probe 每週 1 call。
- 池預算（實測）：`interactive` 240/日（market batch tier=1 走此池，用量 <1%）、`keepwarm` 960/日（used 28）、`backfill` 600/日（used 46）；三池 capacity 240、refill 1/min。
- Lane A 不退化：market batch 產出是 Lane A 的超集（63 檔 ⊂ 全市場），且 Phase A 先於 Phase B，per-stock 名額不受擠壓。

## 8. 測試（deterministic，禁 manual invoke 當驗收）

端到端 fixture（合成 rawRows，不打上游）：`market batch rows → aggregate → tw_chip_fact upsert → materialize_bsr_daily_from_fact → bsr_snapshot_mark → bsr_snapshot_fulfill_jobs → bsr_coverage_daily`，逐段斷言列數。
分支：empty rows（→ partial）、partial（部分股 broker <threshold → still_pending>0）、quota reject、rate-limit（`RateLimitExhaustedError` → `rateLimitedStop`）、duplicate（同批重跑 fact 列數不變）、stale-running（claim 未取得 → `skipped_not_claimed`）、failed-date（throw → status=failed 且 last_error 落地）。
Negative control：`supported=false` 時斷言 `fetchFinmindMarketDay` 呼叫次數 = 0。
Production pre/post：`claim_bsr_queue_jobs` md5、`bsr_snapshot_*`／`materialize_*`／`rebuild_bsr_rollup` 的 `md5(prosrc)`/owner/`proconfig`/ACL 皆須不變（本票不改 SQL 函式）；新增 cron job 前後 `cron.job` diff 只多 1 列。

## 9. 驗收

三輪 = **三個自然 scheduled stages**（由現有 schedule 證明可在一日內完成）：
1. 交易日 UTC 07:30 job45 enqueue → pending ≥ 15
2. UTC 07:40 job46 worker → Phase A 觸發，HTTP body 含 `snapshot_fulfilled:[{date, coverage_stocks>500, jobs_fulfilled>0, final_status:'ready'}]`
3. UTC 08:07 job107 worker → 同日 note=`no_jobs`（已清空），`bsr_coverage_daily(該日) > 500`、`tw_bsr_daily_snapshot_status.source='finmind_market_batch'`、`sealed`

每輪均需 cron dispatch log → function edge log(HTTP 200 + version) → fact/daily 列數 → coverage 全鏈對齊。
Preview（authenticated，**不開抽屜**）：該帳號全部持股於 server 端已具 expected latest date 資料，network 面板 enqueue 呼叫 = 0。

## 10. Rollback / Stop

- Rollback：`SELECT cron.unschedule('bsr-market-batch-probe')`；必要時 `mode:'market_batch_toggle' {enabled:false}` 立即降回 per-stock（既有 kill switch）。不刪任何資料。
- Stop 條件：任一池 `daily_exhausted`、market batch 連續 2 次 `finmind_http_*`／逾時、`materialize_failed`、Lane A 覆蓋較前一交易日下降。

---

### 待你裁決
1. 批准 M1（新增 weekly probe cron，1 API call/週）？這是唯一能把「supported=false 是方案限制還是 07-25 當次錯誤」判定出來的自然路徑。
2. 若你要更快得到答案，可否允許**一次**受控 `mode:"probe"` 呼叫（1 call，唯讀上游、只寫 config）？否則需等下週一自然輪次。
3. 是否同時授權我下一票**唯讀**查證 `backfill-snapshots-twse-bulk`（job87/99）為何無產出，作為 supported=false 的備援路徑？
