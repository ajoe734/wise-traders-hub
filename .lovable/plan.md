# Build2 Final Execution Ticket P4（等待審核，未實作）

Root cause 與 Path A 選擇沿用 P3（job 67 payload `{}` ⇒ mode 預設 `worker`，probe 自 2026-07-25T08:54:27.674Z 起從未再執行；`supported:false` 永久凍結；Path B twse-bulk 只寫 `daily_price_snapshots`，無 BSR）。以下為修正後的可執行票。

---

## A. 排程時刻（避免同分鐘競跑，probe 後 ≥5 分鐘才由自然 worker 接手）

現有 UTC 佔用分鐘（已逐筆讀 `admin_list_cron_jobs()`）：

| job | schedule (UTC) | Taipei | 說明 |
|---|---|---|---|
| 106 | `2 * * * *` | 每時 :02 | prefetch enqueue |
| 107 | `7 * * * *` | 每時 :07 | worker hourly |
| 87 | `15 7 * * 1-5` | 15:15 | twse bulk |
| 99 | `20 7,13 * * 6,0` | 週末 | twse bulk 週末 |
| 45 | `30 7 * * 1-5` | 15:30 | post-close enqueue |
| 53 | `0,30 7-12 * * 1-5` | :00/:30 | holdings delta enqueue |
| 51 | `*/15 6-12 * * 1-5` | :00/:15/:30/:45 | worker tier1 catchup |
| 46 | `*/10 6-12 * * 1-5` | :00/:10/:20/:30/:40/:50 | worker trading |
| 96 / 69 | `*/10 * * * *` | :00/:10/… | reap / guardian |
| 70 | `*/30 * * * *` | :00/:30 | window converge |
| 80/81/82 | `35 7,9,11 * * 1-5` | 15:35 / 17:35 / 19:35 | orchestrator |
| 33 | `*/5 * * * *` | 每 5 分 | alerts-watchdog（內含 `refresh_bsr_coverage_daily(10)`） |

**Final recurring schedule（唯一變更）：**

```
'21 7 * * 1-5'   -- UTC 07:21 = Taipei 15:21
```

- 分鐘 `:21` 與上表所有 job 皆不重疊（最近的是 07:15 job87、07:20 job99-週末）。
- 下一個自然 worker 是 07:30 的 job 51 / 46 → 間隔 **9 分鐘 ≥ 5** ✓。
- 07:21 位於台股收盤（Taipei 13:30 = UTC 05:30）之後、post-close enqueue（07:30）之前，probe 結果在同一輪 enqueue+worker 前就已落地。
- **不使用一次性排程**：這是永久 recurring schedule，S1/S2/S3 全部由它與既有 job 自然觸發。

**now-3d 為何必為交易日**：週一→上週五、週二→上週六、週三→上週日、週四→週一、週五→**週二**。
週二/週三會落在週末，因此 P4 選擇 **E-2**（見 §E）在 source 內加 `resolveProbeDate()`（now-3d 後回捲到最近的平日），
使週二/週三分別回捲到上週五，五個工作日都是有效交易日；`1-5` 排程即可全部安全。
（另計國定假日：回捲後若該日整市場 rows=0 而 HTTP 200，歸類為 *inconclusive*，不寫 `supported=false`，見 §E。）

---

## B. Final acceptance 門檻（可稽核，不得寬鬆）

`min_stocks_in_response = 500` **只用來判定 endpoint capability**，不是全市場新鮮度門檻。全市場 PASS 需同時滿足下列六項，且每項都必須列出實際數字：

令 d = 目標交易日（= 該輪 pending 的 trade_date）。

1. **API 面**：本輪 HTTP body `snapshot_fulfilled[]` 的 `coverage_rows`（raw rows）與 distinct stock 數。
2. **FULL_MARKET(d)** = 回傳 distinct stock_id 中 `(tw_bsr_eligibility(stock_id)->>'eligible')::bool = true` 的集合大小。
3. **MISSING(d)** = `OBSERVED_60D_ELIGIBLE`（= 近 60 日 `tw_chip_fact` 中 eligible distinct stock，P1 實測 **1,551**）減去 FULL_MARKET(d)；需列出 count 與前 20 個 stock_id。
4. **fact**：`select count(distinct stock_id) from tw_chip_fact where trade_date = d and source='finmind_market_batch'`。
5. **daily / coverage**：`tw_bsr_daily` 於 d 的 distinct stock 數；`bsr_coverage_daily` 於 d 的列數與 `coverage_pct` 分布（正常／`missing_snapshot`／`broker_over_cover`）。
6. **使用者面**：指定 authenticated 帳號 holdings 全表逐檔套 `tw_bsr_eligibility`：
   - eligible 檔：**全部**必須在 d 有 `tw_bsr_daily` 資料，缺一即不 PASS；
   - ineligible 檔：逐檔列出 `ineligible_reason`（`unsupported_asset_type` / `invalid_stock_id`），明確標示「產品不支援分點資料」，**不得計入覆蓋率、不得宣稱全覆蓋**。

**判定規則**

| 判定 | 條件 |
|---|---|
| **PASS** | FULL_MARKET(d) ≥ 1,400 **且** MISSING(d) ≤ 150 **且** fact distinct = FULL_MARKET(d)（差 0）**且** daily distinct ≥ 0.98 × fact distinct **且** `bsr_coverage_daily(d)` 列數 ≥ 0.95 × daily distinct **且** holdings∩eligible 缺漏 = 0 |
| **PARTIAL** | 500 ≤ FULL_MARKET(d) < 1,400，或 MISSING(d) > 150，或 daily/fact 落差 > 2% |
| **FAIL / STOP** | FULL_MARKET(d) < 500、或 holdings∩eligible 有缺漏、或 snapshot `failed`、或 `finmind_quota_pools` 出現 `daily_exhausted` |

**PARTIAL 處理**：不回滾，只記錄；連續 **2 個** 交易日 PARTIAL ⇒ 視同 FAIL，執行 §G rollback。

---

## C. 最近的 S1/S2/S3 自然窗口（以實際 cron 推導，不等候冒充）

現在：**UTC 2026-08-13 22:30 / Taipei 2026-08-14 06:30（週五）**。若今日 UTC 07:21 前完成 migration：

| Stage | jobid | UTC | Taipei | 內容 |
|---|---|---|---|---|
| **S1 probe** | 67（修正後） | 2026-08-14 07:21 | 08-14 15:21 | `{"mode":"probe","force":true}`，probeDate = 08-11（週二） |
| **S2a enqueue** | 45 / 53 | 07:30 | 15:30 | tier1 持倉入隊（pending ≥ 15 之來源） |
| **S2b worker Phase A** | 51 / 46 | 07:30、07:40、07:45… | 15:30… | `canMarketBatch` 成立則 1 call 覆蓋整日 |
| **S3a materialize/rollup** | 同 S2b（inline） | 同上 | 同上 | `persistAggregated` 內建，見 §D |
| **S3b coverage refresh** | 33 alerts-watchdog | S2b 後 ≤5 分鐘 | — | `refresh_bsr_coverage_daily(10)` |
| **S3c snapshot seal** | 81 / 82 | 09:35 / 11:35 | 17:35 / 19:35 | `reconcile_snapshot` 封存（非 fact/daily 必要條件） |

若今日 07:21 前未核准 ⇒ 最近窗口順延至 **2026-08-17（週一）UTC 07:21 / Taipei 15:21**（週末 job45/53/46/51 不排程，market batch 無 pending 可觸發）。不會為了湊證據新增臨時排程。

**每個 stage 的識別鏈（只讀查詢，逐一列出）**：
`cron.job_run_details.runid/status` → `cron_edge_call` 寫入的 `request_id`（`function_run_logs.payload->>'requestId'`）→ `net._http_response.id/status_code/content`（HTTP body）→ `function_edge_logs` 的 `version` / `deployment_id` / `execution_id` → body 內 `snapshot_fulfilled[]` → `tw_chip_fact` / `tw_bsr_daily` / `bsr_coverage_daily` 實際列數。

---

## D. S3 的正確歸屬（不把無關 job 當必要 stage）

已逐字讀 `_shared/snapshotFulfillment.ts`：

- `fulfillDay` → `persistAggregated`（L106-172）**在 worker 程序內**完成：
  1. `tw_chip_fact` upsert（chunk 500，`onConflict stock_id,trade_date,broker_id,source`）
  2. `materialize_bsr_daily_from_fact(_trade_date, _stock_ids)` → 寫 `tw_bsr_daily`
  3. `rebuild_bsr_rollup(_as_of, _stock_ids, _max_stocks)` → 寫 `tw_chips_rollup`
  4. `markSnapshot` + `fulfillJobsFromSnapshot`

⇒ **fact / daily / rollup 不依賴 job 80/81/82**。

- `tw-chips-orchestrator`（job 80/81/82，`35 7,9,11 * * 1-5`，command `'{}'`）只做
  `materialize_bsr_daily_from_fact(date, null)`（防禦性全量）+ `reconcile_snapshot(date)`（封存/仲裁）。
  ⇒ 在驗收中**降級為 S3c「封存確認」**，非 fact/daily 的必要階段。
- `bsr_coverage_daily` 的唯一自動刷新者是 **job 33 alerts-watchdog**（`*/5 * * * *`，`checkBsrCoverage` 內 `refresh_bsr_coverage_daily(10)`）與 job 87（`refreshCoverage:true`）。
  ⇒ S3b 歸屬 job 33（最快 5 分鐘內），不必等 job 87。

---

## E. 失敗語意裁決：採 **E-2（最小 source 修正）**

現況（`_shared/finmindMarketBatch.ts:130-136`）：`catch` 對**任何**例外一律寫 `supported:false` + `probed_at=now`。
`RateLimitExhaustedError`（reserve 失敗，未發任何請求）、60s timeout、HTTP 5xx、壞 JSON 全部被誤判為「方案不支援」。

**選項 1（只改 cron）被否決**：
- 自癒週期 = 一個排程日（≥24h），而週末無 worker、遇連假可拖到 4 天以上；
- 現有唯一重試證據是 `fetchWithRateLimit` 對 retryable status/network 的 3 次退避重試，但
  `RateLimitExhaustedError` 是**在重試迴圈之前**丟出（`finmindRateLimit.ts:167-170`），完全不重試；
- 即 §E 要求的「現有自動重試/恢復證據」不成立 ⇒ 依指示改採 2。

**E-2 精確修改（僅 `supabase/functions/_shared/finmindMarketBatch.ts`，約 30 行）**

1. `resolveProbeDate(base = now-3d)`：回捲到最近平日（Sat→Fri、Sun→Fri）。
2. probe 回傳型別改 tri-state：`outcome: 'supported' | 'unsupported' | 'inconclusive'`。
3. 分類規則：
   - HTTP 200 且 `uniq.size >= min_stocks_in_response` ⇒ `supported=true`，寫 `probed_at`。
   - HTTP 200、payload 可解析、rows > 0 但 `uniq.size < min` ⇒ `supported=false`（**真正的 capability 判定**），寫 `probed_at`。
   - `finmind_api_*` 明示方案/權限錯誤（msg 含 `permission` / `level` / `upgrade`）⇒ `supported=false`，寫 `probed_at`。
   - `RateLimitExhaustedError`、network/timeout/abort、HTTP 429/5xx、`finmind_bad_json`、rows=0（疑似假日）⇒ **`inconclusive`：不動 `supported`、不動 `probed_at`**，只寫 `last_probe_error` / `last_probe_at` / `last_probe_outcome`（皆為既有 `config` jsonb 內新增鍵，無 schema 變更）。
4. `index.ts` 的 probe 分支不改（已 `...result` 展開，新鍵自動出現在 body）。

**回歸面**：需 redeploy `tw-bsr-finmind-sync`（`_shared` 為 bundle 一部分）。
Build1f frozen 物件（`claim_bsr_queue_jobs`、`partitionTokenFirst`、quota/defer、worker Phase B）**位元不動**，
但 deploy 後必須重新錨定 remote identity（依 Stage R 既有程序：deploy 後於下一個自然輪次的 9 分鐘窗內讀 `function_edge_logs` 取 version/deployment_id，並比對 HTTP body 23 個 top-level keys 之 added/removed = 0）。

---

## F. 測試（可直接執行的既有檔案 + 明確新增檔）

**既有、必須全部重跑（Build1 回歸）**

| 指令 | 內容 |
|---|---|
| `bash scripts/bsr-claim-equivalence.sh` | frozen `claim_bsr_queue_jobs` 等價 + md5 pin |
| `bash scripts/bsr-slice-verify.sh` / `bash scripts/bsr-slice-closure-check.sh` | slice 封閉性 |
| `deno test -A supabase/functions/tw-bsr-finmind-sync/lib_test.ts` | 25 cases |
| `deno test -A supabase/functions/tw-bsr-finmind-sync/{degrade_signal_test,enqueue_filter_test,manual_and_source_test,queue_simulator_test}.ts` | worker/queue/degrade 契約，含 `partitionTokenFirst` |
| ephemeral PG（`scripts/ephemeral-pg.sh`）跑 `supabase/tests/{bsr_claim_token_slot_test,bsr_acl_metadata_test,bsr_metrics_contract_test,bsr_recovery_write_test,ensure_bsr_queued_test,orchestrator_snapshot_test,chips_prefetch_universe_test,finmind_admit_v2_test}.sql` | 全部 DB 契約 |
| `npm run test:run` | 前端 vitest 全套（含 module boundaries） |

**新增測試（2 檔）**

1. `supabase/functions/_shared/finmindMarketBatch_test.ts`（Deno，純函式 + stub supa）
   - `resolveProbeDate`：Tue/Wed 輸入回捲到 Fri；Mon/Thu/Fri 不變。
   - tri-state：
     - stub fetch 回 600 檔 ⇒ `outcome='supported'`，config patch 含 `supported:true` 與新 `probed_at`；
     - 回 12 檔 ⇒ `unsupported`，`supported:false`；
     - throw `RateLimitExhaustedError` ⇒ `inconclusive`，patch **不含** `supported`、**不含** `probed_at`；
     - throw `AbortError` / HTTP 503 / bad JSON / rows=0 ⇒ 同 `inconclusive`；
     - `finmind_api_402:permission denied, upgrade level` ⇒ `unsupported`。
   - 指令：`deno test -A supabase/functions/_shared/finmindMarketBatch_test.ts`
2. `supabase/tests/market_batch_fulfill_e2e_test.sql`（ephemeral only）
   - fixture：1,600 檔 × 15 broker 合成 rows（含 3 檔 `0050/00878/2330A` 非 eligible）。
   - 斷言：`tw_chip_fact` distinct = eligible 檔數（ETF 被排除）；重跑 idempotent（新增 0）；
     `materialize_bsr_daily_from_fact` → `tw_bsr_daily` distinct 相符；
     `refresh_bsr_coverage_daily` 後 `bsr_coverage_daily` 列數單調不減；
     queue jobs 全部由 `fulfill_jobs_from_snapshot` 標記完成。
   - 指令：`bash scripts/ephemeral-pg.sh supabase/tests/market_batch_fulfill_e2e_test.sql`

**production 限制**：所有 DB 寫入只允許發生在 ephemeral PG 或核准的 migration。
production 只做 pre/post read-back：`admin_list_cron_jobs()` diff 必須「只有 job 67 一列不同」，
`pg_proc` md5、ACL、owner、proconfig 全部零漂移。

---

## G. Migration / Deploy / Rollback / Stop（逐物件）

**Migration（1 個，僅動 job 67，不新增 table/queue/UI）**

```sql
SELECT cron.unschedule('tw-bsr-market-batch-probe-daily');
SELECT cron.schedule(
  'tw-bsr-market-batch-probe-daily',
  '21 7 * * 1-5',
  $$SELECT public.cron_edge_call(
      'tw-bsr-finmind-sync',
      '{"mode":"probe","force":true}'::jsonb, 120000);$$
);
```

**Deploy（1 個 function）**：`tw-bsr-finmind-sync`（因 `_shared/finmindMarketBatch.ts` 變更）。
變更檔僅 `supabase/functions/_shared/finmindMarketBatch.ts`。deploy 後依 Stage R 程序重新錨定 version/deployment_id。

**不變更**：`claim_bsr_queue_jobs`、`partitionTokenFirst`、quota/defer、worker Phase B、`snapshotFulfillment.ts`、任何 UI/表/index/policy。

**Rollback（逐物件）**
1. cron：`unschedule` 後以原字面 `'0 9 * * *'` + `'{}'::jsonb` 重新 schedule。
2. Edge：`git revert` 該單檔後 redeploy `tw-bsr-finmind-sync`。
3. 立即熄燈開關（不需 deploy）：`update tw_bsr_sync_config set config = config || '{"enabled":false}' where key='market_batch'` ⇒ `canMarketBatch` 立刻 false，回 per-stock。
4. 任何情況都不刪資料。

**Stop 條件（任一即停並回滾）**
- 連續 2 個交易日 PARTIAL，或任一次 FAIL（§B）；
- Lane A 持倉 freshness 退化（持倉檔 d 缺漏 > 0）；
- `finmind_quota_pools` 出現 `daily_exhausted`；
- `tw_bsr_sync_queue` pending 連續 3 輪上升；
- `tw_bsr_daily_snapshot_status` 連續 2 日 `failed`。

**外部能力仍為 UNPROVEN**：FinMind 方案是否支援省略 `data_id` 的整市場查詢，只能由 S1 的自然 probe 回答。
S1 若判定 `unsupported`（capability 真失敗），Build2 主路徑 **BLOCKED**，另案處理（方案升級或 per-stock 長期輪轉），本票不偷渡。
