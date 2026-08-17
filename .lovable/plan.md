# Plan v8.1 Stage B — v4（admission gate 收斂，仍只 Plan／唯讀）

保留 v2/v3 已核可部分：classifier 語意、upstream 簽章 sanitize、admin server-side probe、rollback 與 owner/ACL diff、natural cron 證據、holdings coverage 驗收，以及「BSR 不會自行恢復新鮮度、需合法／付費 provider」的誠實邊界。以下為 v4 針對九點矛盾的修訂與唯讀證據。

## 唯讀基線（本輪 catalog / 生產資料）

- `tw_bsr_sync_config`：已有 `key/config jsonb/version int/updated_at/updated_by/note`＋`tw_bsr_sync_config_snapshot_trg`。**不需要 ALTER TABLE。** `market_batch` 現值 `supported=false, last_probe_error='unsupported_plan:sponsor_level', last_probe_outcome='unsupported', probed_at=2026-08-14T13:30:03.691Z, version=6`，**無 `admission_blocked` key**。
- `tw_bsr_sync_queue` 狀態分布：`failed 1572 / pending 77 / done 9956`（total 11605）。active unique index `(stock_id, trade_date) WHERE status IN (pending,running,failed,skipped)`。
- 近 30 天 distinct `enqueued_by` 實際值包含：`backfill_seed_20260721`、`tier2_gaps:<hash>`（20+ 種）、`converge_bsr_windows`、`chips_prefetch_hourly`、`chips_prefetch_hourly:r1`、`chips_prefetch_hourly:r3`、`trade_insert_hook_backfill`、`enqueue_all_active_holdings`、`ensure_bsr_window`、`ensure_bsr_queued`、`tier1_first_fetch:<hash>`、`tier1_holdings:<hash>`、`runbook_verify`。
- 全表 `stock_id` 11605/11605 皆符合 `^[0-9]{4,6}[A-Z]?$`；`trade_date` 範圍 2026-04-06 ~ 2026-08-17。
- `public.tw_bsr_degrade_events` **已存在**（`api_name, from_mode, to_mode, reason, trigger_metric, trigger_value, threshold, correlation_id, detail jsonb, created_at`；PK id；index `(api_name, created_at DESC)`；**無 unique key**；RLS：company_admin 讀、service_role 全權）。

---

## 1. 完全不新增 payload validation（撤掉 v3 §7）

證據顯示 v3 的 `enqueued_by` allowlist 會誤殺現行正常來源（`chips_prefetch_hourly:r1/r3`、`tier1_first_fetch:*`、`tier1_holdings:*`、`tier2_gaps:*`、`backfill_seed_*` 全部不在 allowlist 內）。

- **v4 決議：gate trigger 只做 admission 擋／放，零業務驗證。** 不檢查 `enqueued_by`、不檢查 `stock_id` 格式、不檢查日期範圍、不檢查 batch 大小，也不改寫任何欄位。
- `priority` 既有 CHECK、`stock_id` NOT NULL 等既有約束的成功／失敗行為完全維持原狀（非法輸入照樣 raise，不被偷換成 `RETURN NULL`）。
- 相容性證明：上列 30 天 distinct 來源分布 + stock_id/date 範圍表，在 A1 clone 上以「gate open 時逐一重放這些 writer」對照 row delta 完全一致。

## 2. Terminalize 只針對本 run 真正 claimed 的 exact ids

`claim_bsr_queue_jobs`（唯讀 body 已取得）以 `FOR UPDATE SKIP LOCKED` 選 `status='pending'` 的列，`UPDATE ... SET status='running', started_at=now(), attempts=attempts+1 RETURNING q.*`。因此：

- v3 的 `WHERE status='pending' AND last_error LIKE 'quota_deferred%'` 對已 claimed 的列會更新 **0 列** — 修正。
- v4：worker 在該 run 內保留 claim 回傳的 `id[]`；terminalize 語句為
  `UPDATE public.tw_bsr_sync_queue SET status='failed', last_error=<terminal code>, finished_at=now() WHERE id = ANY($1) AND status='running' AND started_at IS NOT NULL AND correlation_id = ANY($2)`，`$1` 為本 run claimed ids、`$2` 為對應 correlation_id（ownership 檢查）。**絕不觸碰未 claim 的 pending 列。**
- 每批上限即 claim batch 大小（自然 worker 節奏），不做 bulk sweep。
- 測試：clone 上兩個併發 worker session claim 不重疊集合，各自 terminalize 只影響自己的 ids；未 claim 的 pending 計數不變。

## 3. 恢復路徑：用既有 recovery，terminal code 必須被它認得

唯讀 body 證據：

- 三個 enqueue writer（`enqueue_bsr_first_fetch_on_trade`、`enqueue_chips_prefetch_gaps`、`ensure_bsr_queued`）全部是 `INSERT ... ON CONFLICT DO NOTHING`。因為 active unique index 涵蓋 `failed`，**只要同 (stock_id, trade_date) 有 failed 列，新 INSERT 一律靜默 0 列** → 「probe 成功後 cron 自然重新入隊」在 v3 的寫法**不成立**。
- `recover_quota_failed_bsr_jobs(p_max)` 是 **UPDATE**（非 INSERT）：挑 `status='failed' AND (last_error LIKE 'finmind_admission_%' OR last_error='quota_deferred') AND max_attempts < 8`，每次呼叫最多 **1 筆**（`v_cap := LEAST(1, ...)`，再受 `bsr_recovery_budget` 限制），轉回 `status='pending', last_error='quota_recovery_token', max_attempts+1`；另外會把「fact 已存在」的 1 筆 reconcile 成 `done`。它由 `enqueue_chips_prefetch_gaps`（hourly cron）自然呼叫。

v4 決議：

- terminal code 取 **`finmind_admission_provider_plan_rejected`**（符合既有 `LIKE 'finmind_admission_%'`），使恢復完全走既有 path，不新增 bulk DML、不新增 recovery function。
- 天然節流：每次 hourly cron 至多回收 1 筆，且 `max_attempts+1` 累加至 8 後自動停止 → gate 仍關閉期間最多產生每小時 1 筆無效嘗試，worker 立刻再 terminalize，不會放大。
- audit：每次 terminalize 與每次 gate transition 都寫 `public.audit_logs`（action `bsr_job_terminalize` / `bsr_admission_block` / `bsr_admission_unblock`，detail 含 ids、before/after version、terminal code）。
- clone 必測完整迴圈：block → 同一 (stock, date) 進入 failed(`finmind_admission_provider_plan_rejected`) → 驗證此時 enqueue writer INSERT 為 0 列 → admin probe 成功 unblock → 呼叫 `enqueue_chips_prefetch_gaps` 走自然 recovery → 該列回到 pending → worker 能實際處理同一 stock/date。

## 4. 移除 per-enqueue TTL

- `admission_open()` **不含任何 freshness/TTL 判斷**。freshness 只在 `unblock_admission` 當下用來接受／拒絕 probe evidence（probe 必須是本次 server-side 執行、nonce 相符）。
- 成功 transition 後 gate 持續 explicit `false`，直到 worker 再次遇到 exact terminal evidence 才 block。沒有任何「自動重新關閉」。
- `admission_open()` 回 true 的唯一條件：gate row 存在 且 `config->'admission_blocked'` 為 JSON boolean `false`。key 缺失／型別非 boolean／row 不存在 → fail-closed（回 false）。

## 5. Volatility 與 row lock

- 不在 `admission_open()` 內做 row locking，且**不標 STABLE**：`private_bsr.admission_open()` 宣告 **VOLATILE**（純讀），只供 trigger 呼叫。
- Row lock 一律在 **VOLATILE 的 trigger function** 內執行：`PERFORM 1 FROM public.tw_bsr_sync_config WHERE key='market_batch' FOR SHARE`，隨後讀 state。
- v4 交付要求：`SELECT proname, provolatile, prosecdef, proconfig, proacl FROM pg_proc` read-back，斷言新函式 `provolatile='v'`；並附 clone 上 CREATE 成功與 `FOR SHARE` 實際執行成功的證據（若任何 STABLE 版本被 PostgreSQL 拒絕 row-locking，記錄該錯誤原文）。

## 6. 不新增 table；不做 per-row degrade event

- `tw_bsr_degrade_events` 已存在（欄位如上，**無 unique key**，故 v3 的「每 (reason, minute) 去重 insert」在該表上無法用 ON CONFLICT 實作）。
- v4 決議：**gate closed 時不寫任何 per-row event**（避免 closed batch 每列一次 insert 放大）。觀測改為：
  - gate transition（block/unblock）各寫 1 筆 `tw_bsr_degrade_events` + 1 筆 `audit_logs`；
  - 「本 run 被 gate 擋掉幾列」由 Edge/cron 自行以 `count` 差值回報在 HTTP response 與 `data_source_refresh_logs` metadata 中。
- 唯一 DDL 仍為：`CREATE SCHEMA private_bsr`＋其中 function＋`tw_bsr_sync_queue` 上一個 BEFORE INSERT trigger（gate trigger function 建在 public，供 trigger 使用）。JSON keys 只加在 `market_batch.config` 內：`admission_blocked`、`admission_reason`、`admission_blocked_at`、`last_blocked_at`、`admission_probe`、`admission_probe_at`、`admission_probe_schema_version`。

## 7. Edge 端不宣稱能區分 blocked vs duplicate（本 Stage 不改 Edge 寫入）

實際程式碼證據（`supabase/functions/tw-bsr-finmind-sync/index.ts:377-392`）：enqueue 先 `select` 已存在的 pending/running，再 `insert(chunk, { count: 'exact' })`，**沒有 `.select()`、沒有 ON CONFLICT**；重複列會回 unique violation error（走 `console.warn`），gate 擋下則是 error=null、count=0。private schema 對 PostgREST 不可達，Edge 無法查 gate state。

- v4 決議：Stage B **不修改 Edge 寫入路徑**，也不宣稱它能區分兩者。行為描述只寫「gate closed 時 insert 成功但寫入 0 列，Edge 會將該 chunk 記為 inserted=0」。
- 後續（獨立 staged deploy，非本 Stage）若要區分，contract 為：新增 `public.bsr_admission_status()`（service_role only）供 worker 每 run 查一次，並在 response 加 `admission: { blocked, reason, version }`；先在 clone 以 harness 驗證後才排 deploy。

## 8. A1 逐支 writer 驗證

open/closed 兩種狀態下逐支呼叫並記 row delta：

- 可安全在 clone 直接呼叫：`ensure_bsr_queued`、`ensure_bsr_window`、`converge_bsr_windows`、`enqueue_bsr_backfill`、`enqueue_all_active_tw_holdings_bsr`、`enqueue_chips_prefetch_gaps`（含其內部 recovery 呼叫）、`bsr_snapshot_fulfill_jobs`。
- 需 fixture：`enqueue_bsr_first_fetch_on_trade`（需插入一筆 TW `trade_records`，並確保該 stock 在 `tw_bsr_daily` < 20 列）；`detect_chip_gap_jobs` / `checkup_prefetch_universe` 依賴 holdings fixture。
- 另外：Edge 風格的 raw batch INSERT（500 列 chunk）一支。
- 每支記錄：呼叫前後 queue rowcount、該 writer 回傳值、是否 raise、耗時。
- 額外測 deadlock 與 timeout：兩 session 反向順序取 gate row lock 與 queue row lock；`SET statement_timeout='2s'` 下 block transaction 持鎖時，enqueue 端行為與錯誤訊息需記錄，且不得造成 trade_records transaction 失敗（trade trigger 路徑單獨測一次）。

## 9. Linearization 文字修正

- 定義：**linearization point = transaction 取得 `market_batch` gate row lock 後所讀到的 (version, admission_blocked) 狀態**；此順序由 lock 佇列決定。block/unblock 的變更對外部可見的切點為該 **block transaction 的 commit**。
- Barrier test 用**兩個真正的 DB session**（兩條獨立連線，以檔案／table 旗標當 barrier 協調，不用同 session 的 advisory lock 假裝並行）：
  - S1 開 transaction 執行 INSERT（停在 gate lock 之後、commit 之前），S2 執行 block → 驗 S2 阻塞；S1 commit 後 S2 才 commit；S2 commit 之後的所有 INSERT 皆 0 列。
  - 反向：S2 先 block 並 commit，S1 後 INSERT → 0 列。
  - 各 3 次；另跑 8 連線 × 200 INSERT 與交錯 block/unblock 的 fuzz，斷言「gate blocked commit 之後不存在新增列」。

---

## 交付與驗收（clone-only，production 0 touch）

- clone A1：restore 0 errors → apply → 跑 §1/§2/§3/§5/§8/§9 全部測試（含兩次完整 run 的 idempotency）→ rollback → 與 baseline 比對 schema/ACL/rowcount/hash。
- clone A2：rollback 演練 + 18 個 queue-touching function 的 `proowner/proacl/proconfig` diff（要求 0 差異；Stage B 不 CREATE OR REPLACE 任何既有 function）。
- **P-ACL GAP-1（不在本 Stage 修）**：`ensure_bsr_queued`、`enqueue_bsr_backfill`、`enqueue_bsr_first_fetch_on_trade`、`enqueue_all_active_tw_holdings_bsr`、`ensure_bsr_window`、`converge_bsr_windows`、`defer_bsr_job_quota`、`bsr_snapshot_fulfill_jobs`、`bsr_snapshot_stats`、`bsr_trace_by_correlation`、`reap_stale_bsr_queue_jobs`（SECURITY DEFINER）以及 `claim_bsr_queue_jobs`、`prune_bsr_sync_queue`（non-definer）目前對 `anon`/`authenticated` 開 EXECUTE，全部 owner=postgres、`proconfig={search_path=public}`。列為獨立待修項。
- 新函式一律 `SET search_path = pg_catalog, private_bsr`（不含 public，且 public 不在前）、body 完全限定 `public.*`、禁止 dynamic SQL；建立後附 `proconfig`／`proacl`／`provolatile` read-back。
- 全程不碰 production DB、Edge deploy、cron、ACL、Publish。
