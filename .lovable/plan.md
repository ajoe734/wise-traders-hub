# Build2 Final Plan P3（唯讀稽核完成，等待審核）

## 1. Exact root cause（已證，非推測）

**RC-A（決定性）：`job 67 tw-bsr-market-batch-probe-daily` 送出的 payload 是空的，根本沒有跑 probe。**

```
jobid 67 | tw-bsr-market-batch-probe-daily | 0 9 * * *
SELECT public.cron_edge_call('tw-bsr-finmind-sync', '{}'::jsonb, 120000);
```

`index.ts` HTTP entry：`const mode = String(body?.mode || 'worker')`。
payload `{}` ⇒ mode = **worker**，不是 probe。所以這個「每日探測」排程自建立以來每天跑的是一次普通 worker，
`probeMarketBatchSupport` 從 2026-07-25T08:54:27.674Z 之後**從未再被呼叫過**。

配合 `_shared/finmindMarketBatch.ts:105-114`：非 `force` 時，`probed_at` 24h 內直接沿用舊值；
但因為根本沒人呼叫 probe，`supported:false` 自 07-25 起**永久凍結**，
`index.ts:487 canMarketBatch = enabled && supported === true` 恆為 false ⇒ 市場整批 lane 完全不可能啟動。

**RC-B（次要，會造成偽陰性，必須一併處理）：probe 預設日期會落在假日。**
`finmindMarketBatch.ts:115-116`：`probeDate = now - 3 天`。
週二探測→週六、週三探測→週日，皆非交易日 ⇒ rows=0 ⇒ `supported=false` 被寫死。
07-25（週六）探測日=07-22（週三）為交易日，所以 07-25 那次**不是**被這條害的；但每日排程若修好 mode 後，
週二、週三兩天必然偽陰性覆寫，因此排程日必須避開。

**07-25 當次失敗原因：UNPROVEN（證據已不存在）。**
- `function_run_logs` 07-25 08:40–09:15 內 `fn ilike '%bsr%'` = 0 rows。
- `finmind_quota_ledger` 最早 = 2026-07-25 16:12:29Z（晚於 probe）。
- `tw_bsr_api_usage` 最早 bucket = 2026-08-01 05:40Z。
- `tw_bsr_degrade_events` 07-24～07-27 僅一筆 `recover_to_normal`（07-24 09:15）。
`probeMarketBatchSupport` catch 分支對**任何**例外（RateLimitExhaustedError／HTTP 非 200／JSON 壞／逾時）
一律寫 `supported:false` 且不落任何 log，所以外部方案是否支援 market batch **至今未證明**。
本 Plan 因此把「重跑 probe」定位為 *診斷步驟*，不預設它會成功。

## 2. Path A vs Path B 判定

**Path B（`backfill-snapshots-twse-bulk`，job 87 / 99）——不合格，已排除。**
其資料源為 `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`，只寫 `daily_price_snapshots`（價量），
原始碼中沒有任何 broker/分點欄位或 `tw_chip_fact` / `tw_bsr_daily` 寫入。
它呼叫 `refresh_bsr_coverage_daily(10)`，而該函式（已逐字讀 prosrc）是
`FROM public.tw_bsr_daily ... LEFT JOIN daily_price_snapshots` —— 只提供**分母**，不會產生任何 BSR。
⇒ Path B 在物理上無法補全市場 BSR。

**Path A（market batch）為唯一可行 lane，且它已完整存在、位元未動：**
`fetchFinmindMarketDay`（1 call / 整市場） → `fulfillDay`（`snapshotFulfillment.ts:183`）
→ `aggregate(rawRows)` → `persistAggregated`（寫入**回傳的全部個股**，非僅 pending）
→ `markSnapshot` → `fulfillJobsFromSnapshot` → orchestrator `materialize_bsr_daily_from_fact` / rollup
→ `refresh_bsr_coverage_daily`。整條鏈唯一被卡住的閘門就是 `supported=false`。

## 3. 最小變更範圍

- **Edge source 變更 = 0；Edge deploy = 0。**（不動 frozen claim、worker、quota/defer、UI）
- **不新增表、儀表板、告警、追蹤頁。**
- **唯一變更：以 migration 修正既有 job 67 的 payload 與排程日。**

```sql
-- 修正既有排程（不新增 job、不刪資料）
SELECT cron.unschedule('tw-bsr-market-batch-probe-daily');
SELECT cron.schedule(
  'tw-bsr-market-batch-probe-daily',
  '0 9 * * 1,4,5,6,0',   -- 避開週二/週三（now-3d 會落在週末）
  $$SELECT public.cron_edge_call(
      'tw-bsr-finmind-sync',
      '{"mode":"probe","force":true}'::jsonb, 120000);$$
);
```

`force:true` 的理由：`finmindMarketBatch.ts:105` 的 24h skip 會讓凍結中的 `supported:false` 永遠回不來；
force 使每次排程都是真實探測（每次 1 call，tier1）。

## 4. 容量

- Probe：每次 **1 call**，每週 5 次 ⇒ ≤5 calls/週，對 `FINMIND_HOURLY_LIMIT=1500` 可忽略。
- 若 probe 成功轉 `supported=true`：worker Phase A 每輪最多取 3 個 date candidate（`index.ts:504-506`），
  每個 date **1 call** 涵蓋全市場（~1,600 檔 × ~15 broker）。
  正常交易日僅 1 個 pending date ⇒ **每交易日 1–2 calls** 即達成全市場當日新鮮度。
- 觸發門檻 `threshold_pending=15`：job 45（07:30 UTC post-close）+ job 53（每半點）tier1 持倉入隊約 60+ 檔 ⇒ 交易日必然 ≥15，無須改門檻。
- Lane A（持倉）不退化：Phase A 先於 Phase B，且 `fulfillJobsFromSnapshot` 直接把持倉 job 標記完成，
  per-stock 消耗反而下降。
- 歷史補洞（Lane B stale-first）**本階段不做**，待 market batch 證實可用後另案。

## 5. 測試（不碰 production）

1. **Static**：`rg` 斷言 job 67 新 command 內含 `"mode":"probe"`；斷言 Edge source 檔案 hash 與 deploy 前一致（source 變更 = 0）。
2. **Ephemeral SQL**：在暫時 PG 上重放 migration，驗證 `cron.job` 只剩一筆同名 job、schedule 與 command 字面相符、其他 BSR job 未被動到。
3. **Fixture 端到端（離線）**：以固定 market batch JSON fixture 走
   `aggregate → persistAggregated → markSnapshot → fulfillJobsFromSnapshot → materialize → coverage`，
   斷言：ETF/非四碼被 `tw_bsr_eligibility` 排除、idempotent（重跑 0 新增）、jobs_fulfilled 正確、coverage 單調不減。
4. **Read-back**：migration 後只讀 `admin_list_cron_jobs()` 核對 jobid/schedule/command；不改 ACL/owner/proconfig。

## 6. 驗收（三個自然排程階段，全程只讀，不得 manual invoke）

- **S1｜probe 輪次（UTC 09:00）**：`tw_bsr_sync_config['market_batch'].probed_at` 更新至今日；
  記錄 `supported` 值與該輪 HTTP body（stocks 數、sample）。
  - `supported=true` → 進 S2。
  - `supported=false` → **BLOCKED**，判定為外部 FinMind 方案不支援 market batch（此時 body 的 `skipped: probe_error:*` 即為首次可稽核的外部能力證據），停止並回報。
- **S2｜下一個交易日 worker 輪次（job 45 07:30 入隊 → job 46/107 worker）**：
  HTTP body 的 `snapshot_fulfilled[]` 出現 `coverage_stocks ≥ 500`、`final_status='ready'`；
  `tw_bsr_daily_snapshot_status` 該 date = ready。
- **S3｜同日 orchestrator（job 80/81/82）+ coverage refresh**：
  `tw_chip_fact` / `tw_bsr_daily` 該 trade_date 個股數 ≥ 1,000 且 `bsr_coverage_daily` 覆蓋上升；
  Lane A 持倉檔 freshness 不退化；`finmind_quota_pools` 無 `daily_exhausted`。
- **Preview 驗收**：以 authenticated 帳號**不開抽屜**，直接查該帳號全部持股在 server 端皆已具當日 BSR；
  前端 enqueue 次數 = 0。

## 7. 判定原則

- 「Lovable 可改的」= DB schema / cron payload（本 Plan 全部變更落在此）。
- 「Lovable 不可證的」= FinMind 帳號方案是否支援省略 `data_id` 的整市場查詢 —— 只能由 S1 的自然 probe 回答。
  在 S1 之前，market batch 可用性維持 **UNPROVEN**；S1 若為 false 則 Build2 主路徑 **BLOCKED**，
  需改走另案（付費方案升級或 per-stock 長期輪轉），不在本 Plan 內偷渡。

## 8. Rollback / Stop

- 回復方式：`cron.unschedule` 後以原字面（`'{}'::jsonb`, `0 9 * * *`）重新 schedule 即可，無資料變更。
- Stop 條件（任一即回滾）：queue 發散（pending 連續 3 輪上升）、Lane A 持倉 freshness 退化、
  `daily_exhausted`、`tw_bsr_attempt_logs` 錯誤率上升、snapshot 連續 `failed`。
- 任何情況都不刪資料、不改 frozen `claim_bsr_queue_jobs`、不 redeploy Edge。
