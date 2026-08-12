# Final Plan — BSR 垂直切片，拆成 Build 1 / Build 2（分開批准）

所有現況皆以 2026-08-12 07:00–07:15Z 的 production catalog 查詢為依據。Build 2 未取得 Build 1 的自然排程證據前不得執行。

**批准範圍**：Approve 後**只執行 Build 1**，跑完自然驗收就停下回報，**絕不自動進入 Build 2**；Build 2 需要第二次明確批准。

### Cron 時區對照（pg_cron 一律 UTC）

| Job | cron（UTC） | Asia/Taipei |
| --- | --- | --- |
| 45 enqueue tier1+tier2 | `30 7 * * 1-5` | 15:30 |
| 53 enqueue tier1 | `0,30 7-12 * * 1-5` | 15:00–20:30 |
| 70 window-converge | `*/30 * * * *` | 每 30 分 |
| 80 / 81 / 82 orchestrator | `35 7` / `35 9` / `35 11`（1-5） | **15:35 / 17:35 / 19:35** |
| 96 reap stale | `*/10 * * * *` | 每 10 分 |
| 106 enqueue_chips_prefetch_gaps | `2 * * * *` | 每小時 :02 |
| 107 worker | `7 * * * *` | 每小時 :07 |
| 46 / 51 worker | `*/10 6-12` / `*/15 6-12`（1-5） | 14:00–20:xx |

自然驗收等待時間一律以上表 UTC 為準（例如今天 07:13Z 批准後，最近一輪 orchestrator 為 **07:35Z**，最近一輪 worker 為 **07:07Z 之後的下一個 :07 / :10 倍數**）。


## 1. v2 問題 → v3 修正

| # | v2 問題 | v3 修正 |
| --- | --- | --- |
| 1 | 一次性 requeue 1,728 筆（≈72 jobs/hr） | 取消 mass UPDATE。改為 function-level、每輪硬 cap 的漸進 recovery（預設 12 jobs/hr），與 lane 共用同一 budget 與 backpressure |
| 2 | 虛構 `skipped_quota` | 查證 CHECK 只允許 `pending/running/done/failed/skipped`。quota transition = `status='pending'`、`next_run_at` 延後、`last_error='quota_deferred'`、**attempts 不加** |
| 3 | 「attempts 全設 max-1」改資料語意 | 改為 recovery 發「單次 retry token」：`max_attempts = max_attempts + 1`（硬上限 8，等於一生最多 3 次 token），attempts 原值保留可審計 |
| 4 | worker 回報 materialized_rows | worker 只回 `rows_written` / `jobs_succeeded` / `jobs_partial` / `jobs_quota_deferred` / job IDs；`materialized_rows` 與 `tw_bsr_daily` delta 一律由 orchestrator trace 或 DB 查詢證明 |
| 5 | `tradeDate::date` TS 語法不成立 | 改為 RPC 傳完整兩參數 object，讓 PostgREST 命中雙參數 signature |
| 6 | 整支停 job 70 | 查證 job 70 → `tw-bsr-window-converge` **只呼叫 `converge_bsr_windows`（純 enqueue，無 materialize）**，停用不犧牲落地層；且可用 payload `max_stocks` gate |
| 7 | 6h backpressure 讓 lane B 永不啟動 | 兩級 backpressure（hard stop / micro-budget），且 Build 2 有明確前置門檻，由 Build 1 先把 backlog 降下來 |
| 8 | 兩個開關（laneB_cursor.enabled + laneB_enabled） | 收斂成單一 key `laneB_cursor`，`config.enabled` 為唯一開關 |
| 9 | 假設 workflow / 測試檔存在 | 已查證：`.github/workflows/finmind-bsr-tests.yml` 存在、`tw-bsr-finmind-sync/lib_test.ts` 存在 |
| 10 | Lane A 硬性 95% 覆蓋 | 拆成 available-and-fresh vs truthful-unavailable/partial 兩類指標 |

## 2. 合法狀態機與 recovery budget 算式

**CHECK 約束（實測）**：`status ∈ (pending, running, done, failed, skipped)`；`priority ∈ (1,2,3)`；`attempts` default 0、`max_attempts` default 5。

```text
claimed(running) ──成功 rows>0──────────────► done
                ──empty/partial & attempts<max─► pending (next_run_at 退避)   ← 現況，未壞
                ──empty/partial & attempts>=max► skipped (last_error=no_chip_data/partial_chip_data)
                ──quota 拒絕（v3 新）──────────► pending, attempts 不變,
                                                 last_error='quota_deferred',
                                                 next_run_at = now()+15~60min
                ──其他錯誤 & attempts>=max─────► failed
failed(quota 類) ──recovery token（硬 cap）───► pending, max_attempts+1 (≤8)
```

**現況 empty_response transition（查證，不需修）**：`finmind_empty` / `aggregated_empty` / `aggregated_partial` 走 pending 退避，attempts 達上限後 `skipped`——**沒有假 done**。v2 對此的指控作廢，本切片只修 quota 假 failed 與 `rows_written` 可觀測性。

**吞吐與 budget（production 數據）**：

- 非交易時段實測 **30 jobs/hr**（job 107 + job 46/51，batch 30）；台北收盤時段峰值 210/hr；近 24h 完成量 500–700 jobs/day。
- Quota ledger 24h：granted 1,074、rejected 997（keepwarm `daily_exhausted` 862）。keepwarm `daily_budget=960`、`used_today=499`。
- 保守持續吞吐取 **24 jobs/hr**（30 的 80%）。
- **Build 1 總 budget = 12 jobs/hr**（= 24 的 50%，另一半留給既有 job 45 tier1 + job 106 持股 gap）。
  - 1,728 ÷ 12 ≈ **144 小時 ≈ 6 天**清完。
  - Worst case：recovery 全部落在 priority 3，`claim_bsr_queue_jobs` 的 `ORDER BY priority ASC` 保證 p1 持股先被 claim；job 51（`max_priority:1`）為 A 專用通道，完全不受影響。
- **Build 2 總 budget = 24 jobs/hr**，切分：recovery ≤ 8、lane A ≤ 12、lane B ≥ 4（A 用不完則補到上限）。三者相加恆 ≤ 24。

**兩級 backpressure（enqueue 前評估）**：

| 條件 | 動作 |
| --- | --- |
| `chips_all` 關閉 或 degrade mode ≠ normal | 全停（recovery=0、B=0、A=0） |
| pending > 600 或 最老 ready-pending age > 12h 或 keepwarm `used_today ≥ 0.8×daily_budget` | hard stop：recovery=0、B=0；A 保留 4 jobs/hr |
| 最老 ready-pending age 2–12h | micro-budget：recovery ≤ 4、B ≤ 4、A ≤ 12 |
| 其餘 | 完整 budget |

**Queue 健康比較單位**：`newly_enqueued jobs` vs `jobs_with_fact_rows>0`（以 job id join `tw_chip_fact` 該 stock/date 是否有 rows），不用 materialized rows 數。

## 3. 責任矩陣（canary 前 / 後）

| Job | 目前 command | 職責 | Build 1 | Build 2 |
| --- | --- | --- | --- | --- |
| 45 | `tw-bsr-finmind-sync {"mode":"enqueue","tier1":true,"tier2":true}` 07:30 UTC | tier1 持股 + tier2 全市場 T86 gap | **payload 改 `tier2:false`（止血，納入 Build 1）** | 維持 `tier2:false`；job 106 正式接手唯一 T86 owner |
| 53 | 同上 `tier2:false,tier3:false` | tier1 持股（盤中多次） | 不改 | 不改 |
| 70 | `tw-bsr-window-converge` */30 | 持股／訊號 window converge 的**純 enqueue**（`converge_bsr_windows`），**不做 materialize** | 暫留（僅確認不妨礙 materialize：orchestrator 為唯一 materialize owner，job 70 不呼叫任何 materialize RPC） | 停用或 payload `max_stocks:0` gate |
| 80/81/82 | `tw-chips-orchestrator` | materialize + reconcile（唯一落地層 owner） | 修 RPC signature | 不改 |
| 96 | `reap_stale_bsr_queue_jobs(60)` | 只回收 running 逾時 | 不改（唯一 running recovery owner） | 不改 |
| 106 | `enqueue_chips_prefetch_gaps(10,300)` :02 | 持股 gap enqueue + `recover_stale_bsr_queue_jobs` | 加 quota recovery batch（硬 cap） | 接 lane A/B + cursor |
| 107/46/51/98 | worker | claim + fetch + 寫 fact | 修 quota transition、加 `rows_written` | 不改 |

## 4. Build 1 — correctness / observability / backlog safety

### 變更物件

| 類型 | 物件 / 檔案 | 內容 |
| --- | --- | --- |
| Cron | job 45 payload → `{"mode":"enqueue","tier1":true,"tier2":false}` | **止血**：停掉每日 1,300+ 筆新 T86 gap，否則 pending gate 永遠到不了。純 cron payload 變更，rollback 只需改回 `tier2:true` |
| Edge Function | `supabase/functions/tw-bsr-finmind-sync/index.ts` | (a) quota 拒絕分支：`status='pending'`、`last_error='quota_deferred'`、`next_run_at=now()+15~60min`，**attempts 維持 claim 前的值**。實作前必須先讀 `claim_bsr_queue_jobs` 定義、確認 claim 是否真的 `attempts+1` 以及 worker 收到的 `attempts` 是 claim 前或後；抵銷一律用單一原子 `UPDATE ... SET attempts = GREATEST(attempts - 1, 0) WHERE id=$1 AND status='running'`（或等價 RPC），**不得預設 +1、不得產生負值、不得 read-modify-write race**。(b) response body 新增 **per-job 明細** `jobs:[{id, stock_id, trade_date, outcome, rows_written}]` 與彙總 `rows_written`/`jobs_succeeded`/`jobs_partial`/`jobs_quota_deferred`；既有欄位（`processed`/`success`/`results`/`degrade_mode` 等）全部保留，確保三輪 trace 可從 request body 連回 queue |
| Edge Function | `supabase/functions/tw-chips-orchestrator/index.ts` | 最小 diff：`supa.rpc('materialize_bsr_daily_from_fact', { _trade_date: tradeDate })` → `{ _trade_date: tradeDate, _stock_ids: null }`，命中雙參數 signature、消除 ambiguity |
| Migration | `public.recover_quota_failed_bsr_jobs(p_max int default 12)` 新函式 | 只挑 `status='failed' AND last_error LIKE 'finmind_admission_%' AND max_attempts < 8`，依 `trade_date DESC, stock_id` 決定順序，硬 cap `p_max`；設 `status='pending'`、`next_run_at=now()`、`max_attempts=max_attempts+1`、`last_error='quota_recovery_token'`；回傳 jsonb（`recovered`、`remaining`、`skipped_reason`） |
| Migration | `public.enqueue_chips_prefetch_gaps(int,int)` | 僅新增一段：先算 backpressure，再呼叫 `recover_quota_failed_bsr_jobs(<budget>)`，並把結果放進回傳 JSON。持股 gap 邏輯不動；**不加 lane B** |
| SQL test | `supabase/tests/bsr_quota_recovery_test.sql`（新增） | cap 生效、非 quota 類不被復活、`max_attempts` 上限 8、attempts 不被竄改、backpressure 命中時回 0 |
| Deno test | `supabase/functions/tw-bsr-finmind-sync/lib_test.ts`（既有，擴充） | quota-deferred 分支決策（不算 failed、退避區間）；**attempts 邊界三例：0 / 1 / max**，驗證抵銷後不為負、不超過原值 |
| CI | `.github/workflows/finmind-bsr-tests.yml`（既有）掛上新 SQL test；不新增 workflow |

### Build 1 驗收（自然排程，不手動觸發）

1. 至少 1 輪自然 worker（job 107 `:07 UTC` 或 job 46/51）：HTTP body 含 per-job 明細（id / stock_id / trade_date / outcome / rows_written），可逐筆對回 `tw_bsr_sync_queue`；出現 quota 拒絕時該 job 為 `pending` + `last_error='quota_deferred'`，`attempts` 與 claim 前相同。
2. 至少 1 輪自然 orchestrator（job 80/81/82 = **07:35 / 09:35 / 11:35 UTC**，即台北 15:35 / 17:35 / 19:35）：無 `materialize_snapshot: Could not choose the best candidate function`；`tw_bsr_daily` 對應日 rows 增加，或 `tw_bsr_daily_snapshot_status` 誠實 partial。
3. Recovery：三輪 job 106（`:02 UTC`）合計 `recovered ≤ 36`；quota-failed 總數單調下降；無任何一次 UPDATE 超過 cap。
4. 止血生效：job 45 於 07:30 UTC 執行後，當日新增 `enqueued_by` 為 tier2 的 jobs = 0。
5. Backlog 改善：pending 不高於 baseline+50；最老 ready-pending age 呈下降趨勢（baseline 現值：`oldest next_run_at = 2026-08-11 07:30Z`，約 23.5h）。
6. 測試範圍（**不跑全量 vitest**）：
   - `tw-bsr-finmind-sync` quota/transition focused Deno tests；
   - orchestrator materialize focused regression；
   - 新增 SQL contracts（`bsr_quota_recovery_test.sql`）；
   - 既有直接相關的 BSR pipeline regressions；
   - `tsgo` typecheck + `npm run check:module-boundaries`。
   - 全量測試中與本切片無關的既有 failure 只記錄、不修改。

**Build 1 rollback**：job 45 payload 改回 `tier2:true`；還原兩支 Edge Function 前一版；`recover_quota_failed_bsr_jobs` 以 `p_max=0` 或還原 `enqueue_chips_prefetch_gaps` 舊函式體即停止未來 recovery。已成功抓回的 fact/daily rows 不倒回（本來就是正確資料）。

## 5. Build 2 — single-owner lane A/B + durable cursor canary

**前置門檻（全部滿足才可開始，已移除 `failed(quota) ≤ 300`）**：

1. Build 1 PASS；
2. `pending ≤ 200`；
3. 最老 ready-pending age ≤ 6h；
4. 最近 2 個自然 worker windows：`jobs_with_fact_rows>0 ≥ newly_enqueued + recovered`（消化量不低於灌入量，代表 queue 穩定收斂）；
5. quota pool 正常、degrade mode = normal；
6. quota-failed 數量單調下降，且 recovery 每輪未超 cap。

**Lane B 與 quota-failed 的互動**：lane B 選到的 stock/date 若已存在 quota-failed row（被 partial unique index 擋住），**不得默默 dedupe 跳過**；必須在該輪 recovery budget 內對它發 retry token（`max_attempts+1`、`status='pending'`），budget 用盡則本輪停止，**cursor 只前進到該 blocker 已處理的位置**，不得越過。

### 變更物件

| 類型 | 物件 / 檔案 | 內容 |
| --- | --- | --- |
| Cron | job 45 已於 Build 1 設為 `tier2:false` | Build 2 不再變更；lane B 上線後 job 106 才是唯一 T86 owner |
| Cron | job 70 → `active=false`（或 payload `max_stocks:0`） | 純 enqueue（持股／訊號 converge），停用不影響落地層 |
| Migration | `enqueue_chips_prefetch_gaps(int,int)` | 加 lane A/B：A = 現有持股 gap（`priority=1`, `post_close_only=false`, `enqueued_by='lane_a_holdings'`）；B = T86 全市場 cursor 輪轉（`priority=3`, `enqueued_by='lane_b_rotation'`）。參數語意：`p_lookback_days`(10) = lane A 回看天數上限；`p_max_stocks`(300) = 每輪 `candidates_inspected` 上限。既有 cron 呼叫不需改。 |
| Config | `tw_bsr_sync_config` 新 key `laneB_cursor`，`config = {enabled, last_code, universe_date, wraps, inspected_total}` | **唯一開關**即 `config.enabled`；CAS：`UPDATE ... WHERE key='laneB_cursor' AND version=$expected`（實測 `tw_bsr_sync_config_snapshot_trg` 會自動 `version+1` 並寫 history；`relacl` 顯示 `service_role=arwdDxtm`，SECURITY DEFINER 函式可寫） |
| 原子性 | 單一 transaction 涵蓋掃描→insert→cursor update，外層 `pg_try_advisory_xact_lock`；取不到只回 `{skipped_locked:true}`，不推進 cursor | |
| SQL test | `supabase/tests/bsr_lane_ab_test.sql`（新增） | A/B/recovery 三者總和 ≤ 24；cap 用盡即停且 cursor 不跨過未 enqueue 的 gap；CAS 版本衝突不覆寫；wrap 後不重複不漏；backpressure 兩級 |
| CI | 掛到既有 `finmind-bsr-tests.yml` | |

**單位定義**：`candidates_inspected`（掃過代碼數，可 300）、`stocks_selected`、`queue_jobs_inserted`（唯一受 cap 約束者）、`api_calls`。

### Build 2 驗收（三輪自然 :02 / :07）

1. 每輪 job 106 回傳含 `lane_a_inserted`、`lane_b_inserted`、`recovered`、`candidates_inspected`、`cursor_from/to`、`backpressure`、`skipped_locked`。
2. 三輪 `queue_jobs_inserted` 合計 ≤ 72，且 recovery+A+B 每輪 ≤ 24。
3. 至少 **5 個非持股代碼** 完成 inserted → claimed → `tw_chip_fact` 該 stock/date rows > 0（附 job id 對照表）。
4. Lane A SLA 二分計：
   - **available & fresh**：`expected_latest_bsr_date()` 前進後 6h 內，63 檔中「上游有資料」者 ≥ 95% 已寫入 `tw_bsr_daily`；
   - **truthfully unavailable/partial**：其餘標記 `skipped(no_chip_data)` 或 `upstream_exhausted`，UI 正確降級顯示，不得補假資料，也不計入成功。
5. Authenticated `pf-holdings-v2` 路徑：真登入帳號（非 demo），記錄開抽屜前後 `max(id)` 與 `count(*)`——必須不變、且無 enqueue RPC 呼叫；資料在開抽屜前已存在。若無可用登入 session → 標 blocker，不以 demo 代替。
6. Queue 健康：pending ≤ 200 + 50；最老 ready-pending age ≤ 6h；三輪 `newly_enqueued jobs ≤ jobs_with_fact_rows>0 × 1.2`。
7. 落地層雙證：`tw_chip_fact` 增加，且對應日 `tw_bsr_daily` materialized rows 增加或 snapshot_status 誠實 partial。
8. 不 Publish。

**Build 2 rollback**：`laneB_cursor.config.enabled=false`（立即在 enqueue 前生效，queue 不再成長）；還原 `enqueue_chips_prefetch_gaps` 舊函式體；job 45 payload 還原 `tier2:true`；job 70 重新啟用。

## 6. Blocker / 待決

- **無待決設計問題。**
- 唯一潛在 blocker：Build 2 驗收第 5 項需要一組真實登入的 pf-holdings-v2 帳號 session。若屆時無法取得，該項標 blocker，Build 2 不得判 PASS。
