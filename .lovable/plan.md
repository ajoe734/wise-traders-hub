# Plan v8.1 Stage B — v3（admission gate 收斂，仍只 Plan／唯讀）

保留 v2 已核可部分：classifier 語意、upstream 簽章 sanitize、admin server-side probe、natural cron 證據、holdings coverage 驗收、以及「BSR 不會自行恢復新鮮度，需合法／付費 provider」的誠實邊界。以下九點為 v3 修訂。

## 本輪唯讀 catalog 事實（v3 依據）

- `public.tw_bsr_sync_config` 已存在欄位 `key text PK, config jsonb, version int NOT NULL DEFAULT 1, updated_at, updated_by, note`，並有 `tw_bsr_sync_config_snapshot_trg` BEFORE INSERT OR UPDATE 快照觸發器。**不需要任何 ALTER TABLE。**
- `market_batch` row 現值：`enabled=true, supported=false, last_probe_error="unsupported_plan:sponsor_level", last_probe_outcome="unsupported", probed_at/last_probe_at=2026-08-14T13:30:03.691Z`，`version=6`。**目前沒有 `admission_blocked` key。**
- `public.tw_bsr_sync_queue`：欄位如 catalog（`stock_id, trade_date, priority smallint CHECK in (1,2,3), status, attempts, max_attempts, next_run_at, enqueued_by, correlation_id, post_close_only`），唯一索引 `tw_bsr_sync_queue_active_uniq (stock_id, trade_date) WHERE status IN (pending,running,failed,skipped)`，現有觸發器只有 `trg_tw_bsr_sync_queue_updated`（BEFORE UPDATE）。
- 觸及該 queue 的 function 共 18 個，其中 12 個 `prosecdef=true`；`anon`/`authenticated` 有 EXECUTE 的包含 `ensure_bsr_queued`、`enqueue_bsr_backfill`、`enqueue_bsr_first_fetch_on_trade`、`enqueue_all_active_tw_holdings_bsr`、`ensure_bsr_window`、`converge_bsr_windows`、`defer_bsr_job_quota`、`bsr_snapshot_fulfill_jobs`、`reap_stale_bsr_queue_jobs`、`bsr_snapshot_stats`、`bsr_trace_by_correlation`（另 `claim_bsr_queue_jobs`、`prune_bsr_sync_queue` 為 non-definer 但同樣對 anon 開 EXECUTE）。全部 owner=postgres、`proconfig={search_path=public}`。

## 1. 呼叫路徑：選 BEFORE INSERT trigger（不設計 PostgREST 打不到的 RPC）

Edge 不再呼叫任何 `private_bsr` RPC；Edge 維持既有 INSERT/UPSERT 寫法。

- `private_bsr.admission_state()`／`admission_open()`：SECURITY DEFINER，只給 trigger 與 gate function 內部使用，不對外授權。
- `public.tw_bsr_sync_queue_admission_gate()` trigger function（BEFORE INSERT FOR EACH ROW，SECURITY DEFINER，owner=postgres）：
  - gate closed → **`RETURN NULL`（靜默略過該列），絕不 RAISE**。理由：`enqueue_bsr_first_fetch_on_trade` 掛在 trade_records 寫入路徑上，任何 exception 會炸掉交易 transaction。
  - 每次略過寫一筆彙總觀測（`public.tw_bsr_degrade_events`，含 stock_id/date/enqueued_by/reason/gate version），以每 (reason, minute) 去重，避免 log 放大。
  - open → 原列原樣通過（`RETURN NEW`，不改寫任何業務欄位）。
- 「可理解結果」定義：呼叫端仍成功 commit，但 `INSERT ... RETURNING` 回 0 列、UPSERT 回 0 列、batch INSERT 回實際寫入列數；Edge 端據此把「被 gate 擋下」與「已存在」區分（查 gate state 一次即可）。
- 測試（clone A1）：closed 時 single INSERT／`ON CONFLICT DO NOTHING` UPSERT／1000 列 batch／`enqueue_bsr_first_fetch_on_trade` 觸發路徑（真的插一筆 trade_records）四種 caller 全部不 raise、trade_records 成功 commit；open 時列數與內容與 gate 前 baseline 完全相同，並量 1000 列 batch 的 p50/p95 latency，退步需 < 10%。

## 2. Linearization point：同一 gate row 的 lock

- trigger 內：`SELECT config, version FROM public.tw_bsr_sync_config WHERE key='market_batch' FOR SHARE`（找不到 row → fail-closed）。
- `block_admission` / `unblock_admission`：對同一 row `SELECT ... FOR UPDATE`，再 UPDATE。
- 定義：**切點 = gate row 的 lock 取得並在該 transaction commit 的時刻**。FOR SHARE 與 FOR UPDATE 互斥，故任何 INSERT 與任何 block/unblock 之間必為全序：先拿到 lock 的先線性化；block 先 → 後續 INSERT 全部被擋；INSERT 先 → 該批寫入被 worker 之後 terminalize。
- 測試不看「function 內是否單一 transaction」，改用兩連線 barrier concurrency test（`pg_advisory_lock` 當 barrier）：
  - T1 開 INSERT transaction 停在 gate lock 後、T2 執行 block → 驗 T2 等待、T1 commit 後 T2 才成功，且 T1 的列存在、T2 之後的 INSERT 全被擋（0 列）。
  - 反向順序：T2 先 block、T1 後 INSERT → T1 寫入 0 列。
  - 各跑 3 次；並跑 8 連線 × 200 INSERT 與交錯 block/unblock 的 fuzz，斷言不存在「gate 已 blocked commit 之後仍新增的列」。

## 3. Initial convergence（77 筆舊 job 不能卡死）

Deploy 當下 `admission_blocked` key 不存在 → admission fail-closed（新 job 被擋），但 worker 尚不會 terminalize。收斂流程：

1. 第一個 natural worker run 讀 `market_batch`，把 `supported=false` 且 `last_probe_error` 精確等於 `unsupported_plan:sponsor_level`（exact string 比對，非模糊）交給 classifier；classifier 回 `terminal_provider_rejected` 時，worker 呼叫 `block_admission(reason='provider_plan_rejected', evidence=<sanitized>, expected_version=<讀到的 version>)`。
2. 該 DB function 在同一 transaction 內：鎖 gate row → 寫入 `admission_blocked=true, admission_reason='provider_plan_rejected', admission_blocked_at=now(), admission_probe=<sanitized evidence>, admission_probe_version=<gate version>` → 同 transaction 內 `UPDATE public.tw_bsr_sync_queue SET status='failed', last_error='provider_plan_rejected', finished_at=now() WHERE status='pending' AND last_error LIKE 'quota_deferred%'`（僅限本 run claimed 的 job id 集合，逐批 ≤ 200 筆，多 run 收斂），並寫 `public.audit_logs`（actor=service worker、action=`bsr_admission_block`、target=`tw_bsr_sync_config:market_batch`、detail 含 before/after version、terminalized 筆數）。
3. 未命中 exact evidence（例如 error 字串變成別的、或 supported=true）→ **只維持 fail-closed admission，worker 走 `unknown` 有限重試（attempts < max_attempts，指數退避），一律不 terminalize、不寫 gate**。
4. 預期 DML：`tw_bsr_sync_config` 1 列 UPDATE（version 6 → 7）＋ `tw_bsr_sync_queue` 至多 77 列 status 轉 failed ＋ audit_logs N 列。clone 上先跑一次，比對前後 rowcount 與 status 分佈表，附 before/after MD5 fingerprint。

## 4. unblock 語意：顯式 false，不是刪 key

- 成功 probe → 原子寫入 `admission_blocked=false, admission_reason=null, last_blocked_at=<原 admission_blocked_at>, admission_blocked_at=null, admission_probe=<current sanitized evidence>, admission_probe_at=now(), admission_probe_schema_version=1`。
- `admission_open()` 回 true 的**唯一**條件：gate row 存在 且 `config->'admission_blocked'` 為 JSON boolean 且等於 `false` 且 `admission_probe` 通過 schema 驗證（必要欄位齊全、`admission_probe_schema_version=1`、`admission_probe_at` 為可解析 timestamptz 且不超過設定的效期）。其餘（key 缺失／型別錯／malformed probe）一律 false。
- clone 測試：reopen 後**實際**執行 INSERT 與 trade_records trigger 路徑，斷言列真的寫進 queue（不是只讀 `admission_open()`）。

## 5. block/unblock 的併發語意（取代不安全的 CAS-loser-give-up）

- `block_admission`：DB function 內 `FOR UPDATE` 鎖 row → 重讀 → idempotent transition：
  - 已 `admission_blocked=true` → 視為成功（回 `already_blocked`），只補寫 evidence 若原本缺漏。
  - 仍 open → 用**重讀後的 current version** 寫入（不因無關更新造成的 version 變動而丟棄 terminal evidence）。
  - 只有 row 不存在／config 無法解析為 object 時回錯，worker 收到錯誤時**必須**視為 gate 未關閉（不得假裝已關），並在該 run 結束前不再 terminalize。
- `unblock_admission(p_expected_version, p_nonce)`：以 **probe 開始時**取得的 version 與 nonce 作 stale 檢查；鎖 row 後重讀，version/nonce 不符 → 拒絕並回 `stale_probe`，不做任何寫入。
- 測試：兩連線同時 block（皆成功、單一寫入）；block 與無關 config 更新交錯（evidence 不丟失）；stale unblock 被拒。

## 6. SECURITY DEFINER 安全性

- 所有新 function：`SET search_path = pg_catalog, private_bsr`（**不含 public，且 public 不在前**），function body 內一律完全限定 `public.tw_bsr_sync_config` / `public.tw_bsr_sync_queue` / `public.audit_logs` / `public.tw_bsr_degrade_events`。
- 禁止任何 dynamic SQL（無 EXECUTE format）。
- 建立後 read-back：`SELECT proname, pg_get_userbyid(proowner), prosecdef, proconfig, proacl FROM pg_proc ...`，逐一列出並斷言 `proconfig = {search_path=pg_catalog,private_bsr}`、`proacl` 不含 PUBLIC/anon/authenticated（trigger function 由 trigger 以 table owner 身分執行，不需要對外 EXECUTE）。

## 7. 寫入 payload 的 server-side 驗證

gate trigger 只做「擋或放行」＋輸入驗證，**不改寫任何業務欄位**（測試以逐欄比對 NEW vs 實際寫入列證明）。驗證規則（違反者與 gate closed 相同處理：`RETURN NULL` ＋ 記 reason，不 RAISE）：

- `stock_id`：`^[0-9]{4,6}[A-Z]?$`。
- `trade_date`：不得早於 today-400 天、不得晚於 today+1 天（Asia/Taipei）。
- `priority`：1–3（與既有 CHECK 一致）。
- `enqueued_by`：allowlist（`prefetch`、`drawer`、`trade_trigger`、`backfill`、`admin`、`worker`；null 視為 `unknown` 並記錄）。
- 未知欄位：queue 是固定 schema table，無 arbitrary jsonb 灌入面；gate 不接受任何 jsonb payload。
- 單一 statement 批量上限：同一 transaction 內超過 5000 列時記 `oversized_batch` 觀測（不擋，避免破壞既有批次），並列入驗收報告。

## 8. P-ACL GAP（明列，不順手擴 scope）

- 既存風險（唯讀證據見上）：至少 11 個觸及 BSR queue 的 SECURITY DEFINER function 對 `anon`/`authenticated` 開 EXECUTE，另 `claim_bsr_queue_jobs`、`prune_bsr_sync_queue` 亦對 anon 開放。**Stage B 不修**，登記為獨立 **P-ACL GAP-1**（後續兩段式：先建 v2 → 前端切換 → 撤舊）。
- 本次不對這些既有 function 執行 `CREATE OR REPLACE`；Stage B 只 CREATE 全新物件（`private_bsr` schema、gate function、trigger）。驗證：apply 前後對這 18 個 function 取 `proowner/proacl/proconfig` 的完整快照做 diff，要求 **0 差異**；rollback 腳本同樣只 DROP 新物件並重跑同一 diff。

## 9. Schema DDL vs JSON keys（避免 Apply 誤加欄位）

- **不新增任何 column。** `tw_bsr_sync_config` 已有 `config jsonb` 與 `version int`（catalog read-back 如上），Stage B 不含 ALTER TABLE。
- 實際新增的是 `market_batch.config` 內的 JSON keys（共 7 個，v2 誤述為「三個 jsonb 欄位」）：`admission_blocked`、`admission_reason`、`admission_blocked_at`、`last_blocked_at`、`admission_probe`、`admission_probe_at`、`admission_probe_schema_version`。
- 唯一 DDL：`CREATE SCHEMA private_bsr`、其中的 function、以及 `tw_bsr_sync_queue` 上的一個 BEFORE INSERT trigger。

## 交付與驗收（clone-only，production 0 touch）

- clone A1：baseline restore 0 errors → apply → 完整跑 §1/§2/§3/§4/§5 測試（含兩次完整 run 的 idempotency）→ rollback → 與 baseline 比對 schema/ACL/rowcount/hash。
- clone A2：只跑 rollback 演練與 §8 的 owner/ACL diff。
- 全程不碰 production DB、Edge deploy、cron、ACL、Publish。
