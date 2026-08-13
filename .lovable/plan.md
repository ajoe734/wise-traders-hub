# Build1 收斂 + Build2 解鎖 — Plan v8（唯讀查證完成，待審核）

v7.3 撤回：exhausted 3/3 依賴「自然出現 daily_exhausted」，而 8/13 全日 0 rejected 已證明它不可保證，且 Build2 的目標（低速、額度友善的全市場輪替）本質上會**降低**再現機率 → 形成 Build1↔Build2 deadlock。本計畫以「證明改動面不涉及 exhausted 分支」取代「等待自然 exhausted」，不偽造證據、不人為耗 quota。

---

## §1 Build1f 改動面逐條稽核（唯讀，已完成）

Build1f 只動兩處：

| # | 位置 | 內容 | 是否觸及 quota/exhausted 分支 |
| --- | --- | --- | --- |
| 1 | `supabase/migrations/20260812211500_bsr_claim_token_slot.sql` → `public.claim_bsr_queue_jobs` | 新增 `token_slot` CTE（每次最多 1 個 `last_error='quota_recovery_token'`）、`normal` CTE 扣除 token 名額、輸出 `ORDER BY bucket, priority, next_run_at, id` | **否**。函式體內無 quota / reservation / admit / defer 任何呼叫，只讀 `tw_bsr_sync_queue` 並改 `status='running'` |
| 2 | `supabase/functions/tw-bsr-finmind-sync/index.ts` L40 / L539（commit `24ef128a`） | import `partitionTokenFirst`；`claimedJobs` → `jobs` 前做穩定 partition | **否**。純陣列重排，無副作用、不改長度、不接觸 quota |

未被 Build1f 觸及、且早於 Build1f 就已存在（commit `42063d31`，Build1 主體）的 exhausted 路徑：

- `isQuotaRejection(r.error)` → `decideQuotaDeferral()` → RPC `defer_bsr_job_quota(job_id, delay_minutes)` → `recordOutcome(job,'quota_deferred',0,'quota_deferred')`（index.ts L622–637）
- 統計欄位 `jobs_quota_deferred`（L673）
- DB 端 `finmind_admit_v2` / `bsr_recovery_budget(p_full_budget)` / `reserve_bsr_api_quota` / `settle_bsr_reservation` — Build1f 無任何 migration 觸及

**結論：exhausted branch 在 Build1f 完全未變更。**

### Safety evidence 清單（本計畫要求在 Build1 收斂報告中逐項附上，全部為既有資產、不新增任何檔案）

1. **Source / function hash**
   - canonical `supabase/tests/fixtures/bsr_claim_planned.sql` SHA256（凍結值 `a55fb89e…`，見 `bsr_claim_planned.sha256`）
   - production read-back `md5(prosrc(claim_bsr_queue_jobs)) = c28474cca7be420355edeefd6207104b`
   - `index.ts` / `lib.ts` 的 repo hash（Stage A 已記錄）
2. **Focused deterministic tests（既有，不新增）**
   - `supabase/tests/bsr_claim_token_slot_test.sql`（T1–T6、NC1–NC3）
   - `supabase/tests/finmind_admit_v2_test.sql`（quota 準入／拒絕的決定性測試 ＝ exhausted 分支的 deterministic 覆蓋）
   - `supabase/tests/bsr_recovery_write_test.sql`、`bsr_metrics_contract_test.sql`（`jobs_quota_deferred` 等 response schema 契約）
   - `supabase/functions/tw-bsr-finmind-sync/lib_test.ts`（`decideQuotaDeferral`、`isQuotaRejection`、`partitionTokenFirst`）
   - harness：`scripts/bsr-claim-equivalence.sh`（ephemeral PG17），無 production 連線
3. **Negative controls**：NC1–NC3（盤中 token 不得被 claim、非 token job 不得佔 token 名額、batch=0 不得回傳）＋ `partitionTokenFirst` 空陣列／全 token／無 token 三種輸入
4. **自然歷史 safety evidence**：8/10–8/12 每日 Taipei 16:00 後 `finmind_quota_ledger` 皆出現 `daily_exhausted`，對應 `:07` worker 回 HTTP200、`jobs_quota_deferred>0`、`rows_written=0`、無 fact delta — 這些是**同一份 exhausted 程式碼**在 production 的自然行為紀錄（改動面不含它，故 pre/post-deploy 等價）

### 為何「post-deploy 自然 exhausted 3/3」對本次變更不必要且互相衝突

- 本次變更的**唯一風險面**是 claim 的挑選與排序；exhausted 行為發生在 claim 之後（抓取失敗 → defer），與挑選順序正交。
- exhausted 只在「可 claim 供給 × 高 quota 使用」同時成立時出現；Build2 的低速輪替設計刻意壓低單輪 quota 使用 → 要求 post-deploy exhausted 3/3 等於要求系統違反其產品目標，且唯一加速手段是人為耗 quota（已明令禁止）。

---

## §2 Remote identity 有限關閉（一次受控等價 redeploy）

目標：把 v6.2 §6 從 UNPROVEN 收斂成可稽核鏈，不新增 table / telemetry。

**Deploy 前（全部 read-only 或本機）**
1. 重跑 `scripts/bsr-claim-equivalence.sh`（ephemeral PG），確認 canonical SHA256 與 expected TSV 不變
2. production read-back `md5(prosrc)` 仍為 `c28474cc…`
3. 重跑 `lib_test.ts` 與 response-schema 契約測試
4. 記錄 repo commit + `index.ts`/`lib.ts` hash（**source 不做任何修改**，是位元等價 redeploy）

**Deploy**
5. `supabase--deploy_edge_functions(["tw-bsr-finmind-sync"])` — 只此一支，無 Publish、無其他函式、無 migration
6. 完整保留 deploy tool result 原文；若該 API 回傳 version / deployment_id / source identifier，優先採用為鏈的第一段

**Deploy 後**
7. **9 分鐘內**只讀 `function_edge_logs`（analytics）取 `version` / `deployment_id`（保留窗約 10 分鐘，逾時即失敗，不重試第二次 deploy）
8. 下一個自然 `:07`（job107）後 9 分鐘內再讀一次，核對**同一 version/deployment_id**，並比對行為（HTTP200、schema 欄位齊全、token-first 行為不變）

**Rollback / 停止條件**
- source 位元等價 → 無 rollback 必要；若 deploy 失敗或函式異常，立即重新部署同一 commit 並停止本項，identity 記 UNPROVEN
- 若 deploy window 落在 Taipei 交易時段（09:00–13:29）或任一 `:02`/`:07` 前後 3 分鐘 → 不執行，改排下一個空窗
- 若 9 分鐘擷取失敗 → 記 UNPROVEN／BLOCKED，**不得**再 deploy 一次以湊證據
- 任何一項 pre-deploy 測試 FAIL → 中止，不 deploy

---

## §3 Build1 PASS 規則（v8 定案候選）

Build1 判 PASS 需同時成立：

1. **Scheduler PASS**（job106 `2 * * * *`、job107 `7 * * * *`、job98 週末、job96 reap 皆 active，已讀回）
2. **Build1e/1f closure + tests PASS**（`bsr-slice-closure-check.sh`、`bsr-claim-equivalence.sh`、focused tests、negative controls）
3. **open 3/3 natural PASS**（Taipei 8/14 00:07 / 01:07 / 02:07，已取得完整證據）
4. **exhausted safety PASS**（§1：改動面不涉 exhausted branch 的 hash/測試證明 ＋ 8/10–8/12 自然歷史）
5. **controlled redeploy remote identity PASS**（§2）

明確聲明：第 4 項是**修正一個不可能／自相衝突的 gate**（等待不可保證的自然事件），不是偽造自然證據。原「post-deploy 自然 exhausted 3/3」維持 **未觀察**，**不再 blocking**；若日後任何改動觸及 quota admission / deferral / reservation 任一面，該 gate **自動恢復 blocking**。

---

## §4 Build2 Plan（先討論，唯讀盤點已完成）

### 現有控制面（一律復用，禁止新建平行系統）

- **供給／入列**：`enqueue_chips_prefetch_gaps(p_lookback_days, p_max_stocks)`（job106，目前 `10,300`）、`chips_prefetch_targets` + `chips_prefetch_targets_touch()`、`checkup_prefetch_universe()`（**僅持倉/訊號/demo，不是市場**）、`enqueue_all_active_tw_holdings_bsr()`、`ensure_bsr_queued()` / `ensure_bsr_window()`、`enqueue_bsr_backfill()`
- **佇列／執行**：`tw_bsr_sync_queue`、`claim_bsr_queue_jobs`（Build1f frozen）、`tw-bsr-finmind-sync`（worker：job46 盤中 `*/10`、job107 每小時、job98 週末）
- **額度／准入**：`finmind_quota_pools`、`finmind_quota_ledger`、`finmind_admit_v2`、`reserve_bsr_api_quota` / `settle_bsr_reservation` / `purge_expired_bsr_reservations`、`bsr_check_tier_admission`、`bsr_recovery_budget`、degrade state（`bsr_get_degrade_state` / `bsr_apply_degrade_transition`）
- **回補／收斂**：`backfill-gap-orchestrator`（job103/104）、`backfill-worker`（job105）、`converge_bsr_windows`、`rebuild_bsr_rollup`、`materialize_bsr_daily_from_fact`
- **覆蓋率／新鮮度**：`refresh_bsr_coverage_daily(days)`、`get_coverage_stats(_scope,_window_days)`、`bsr_snapshot_stats`、`bsr_backlog_metrics`、`compute_bsr_series_readiness` / `get_bsr_readiness_v2`、`expected_latest_bsr_date()`
- **回收／自愈**：`reap_stale_bsr_queue_jobs`（job96）、`recover_stale_bsr_queue_jobs`、`recover_quota_failed_bsr_jobs`、`chips-guardian`、`chips-chaos-drill`
- **市場母體來源候選（唯讀待選型）**：`stock_names`、`tw_bsr_eligibility(p_stock_id)`、`tw_trading_calendar` 相關 catchup（job91–93）。**明令不得**把 `INIT_HOLDINGS` 或 `checkup_prefetch_universe()` 當作市場母體。

### Build2 設計骨架（雙 lane，共用既有 queue 與 admission）

- **Lane A（優先）**：任何使用者實際持有／訊號涉及的台股 — 由既有 `enqueue_chips_prefetch_gaps` 維持，priority 1–2，SLO 最嚴。
- **Lane B（保底輪轉）**：全市場普通股 active-universe，priority 3，**有界供給**（每輪固定上限 N 檔 × M 個日期），以 `chips_prefetch_targets` 既有欄位做 **checkpoint / cursor** 循環推進，走完一圈即從頭。
- **Quota-aware admission**：Lane B 只吃 `finmind_admit_v2` 在保留額度之上的剩餘；pool reserve 用盡即整個 Lane B 靜默停手（不產生 deferred 洪水）。
- **Idempotent upsert**：沿用 `tw_chip_fact` 既有唯一鍵與 `materialize_bsr_daily_from_fact`，重入不重複寫。
- **failed-date resume**：沿用 `no_chip_data` / `partial_chip_data` 與 `mark_bsr_upstream_probe`，非交易日／無資料日永久跳過，不重試。
- **stale running recovery**：沿用 job96 `reap_stale_bsr_queue_jobs(60)` 與 `recover_stale_bsr_queue_jobs`，Build2 不新建。
- **backlog aging**：Lane B 目標的等待時間納入排序（`next_run_at` + 既有 aging），避免尾端股票永遠排不到。
- **freshness SLO（用既有量測，不新建 table）**：Lane A ≤ 24h、Lane B 一圈 ≤ N 個交易日，以 `get_coverage_stats` / `refresh_bsr_coverage_daily` / `bsr_backlog_metrics` 讀出。

### Build2 測試矩陣（規劃）

- SQL 決定性測試（延伸既有 `chips_prefetch_universe_test.sql`）：universe 選取邊界、cursor 推進與環繞、有界供給上限、Lane B 不搶 Lane A 名額、admission 用盡時零入列
- Edge 單元測試（`lib_test.ts` 模式）：批次切分、預算耗盡提前收手
- 自然驗收：連續 3 個自然小時輪次觀察 Lane B 覆蓋單調上升、Lane A 不退化、quota 未耗盡
- **authenticated Preview 驗收（不開抽屜）**：以既有 preview session 進入持倉頁，**不點開任何個股抽屜**，直接 SELECT 驗證該使用者所有台股標的的最新 `tw_bsr_daily`／readiness 均在 SLO 內；並以 network log 確認前端未觸發任何 enqueue

### Build2 rollback / stop conditions

- Lane B 全部由單一開關（既有 config／cron active 狀態）控制，關閉即回到今日行為
- 停止條件：Lane A freshness 退化、`daily_exhausted` 連續出現、queue 長度單調發散、guardian 告警

---

## §5 執行順序與不做清單

順序：§2 受控 redeploy → Build1 收斂報告（§1+§3 證據）→ 你批准後才開 Build2 實作票。

**不做**：不修改盤中保護；不人為耗 quota、不手動 invoke job106/107/worker/RPC；不新增 table / view / column / telemetry / 監控腳本；不 Publish；不部署 `tw-bsr-finmind-sync` 以外的函式；不改 `claim_bsr_queue_jobs`（frozen）；不把 `INIT_HOLDINGS`／`checkup_prefetch_universe` 當市場母體；本回合不 Implement。
