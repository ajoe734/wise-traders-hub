# Build 1d — Tier B-write 真隔離 ephemeral 測試（Final Plan v2）

唯一目標：讓 `supabase/tests/bsr_recovery_write_test.sql` 在一個真正隔離的臨時資料庫上實際跑過（exit 0），並用 negative-control 證明它會失敗。不碰 production、不新增永久基礎設施。

## 環境事實（已 read-only 查證）

- **無 Docker**（`/var/run/docker.sock` 不存在）、**無 Supabase CLI** → `supabase db start` / `db reset` 在本環境無效，測試檔頂端註解要改成真正可執行的指令。
- **有本機 PostgreSQL 17.9 全套二進位**：`/bin/initdb`、`/bin/pg_ctl`、`/bin/postgres`、`/bin/psql`；`nix` 可用、有網路。
- 本機內建擴充只有 `pgcrypto`、`pg_trgm`；migrations 需要 `vector`、`pg_cron`、`pg_net`。
- 可沿用 harness：`.github/workflows/finmind-admit-sql-tests.yml`（bootstrap → 依檔名全量 apply → 跑 `supabase/tests/*.sql`）。Build 1d 是它的本地腳本版，**不新增 workflow**。

## 1) 全量 migration gate：408/408，零跳過

- 用 `nix build nixpkgs#postgresql_17.withPackages (p: [ p.pgvector p.pg_cron p.pg_net ])` 產生帶三個擴充的 PostgreSQL，並以該 build 的 `initdb/postgres` 起臨時 cluster；`postgresql.conf` 設 `shared_preload_libraries='pg_cron,pg_net'`、`cron.database_name='bsr_ephemeral'`。
- 這樣 migration 原文（`CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;`、`pg_net`、`vector`、`hnsw (embedding vector_cosine_ops)`、`::vector` cast、`cron.schedule/unschedule`、`net.http_post`）**全部原樣執行，零 sed、零 stub 函式、零跳檔**。bootstrap 只做 CI 已驗證過的那四件事：`CREATE SCHEMA IF NOT EXISTS extensions/auth`、最小 `auth.users` 與 `auth.uid()`、建 `anon/authenticated/service_role` role。
- Apply：`for f in $(ls supabase/migrations/*.sql | sort); do psql -v ON_ERROR_STOP=1 -f "$f"; done`，逐檔印出、計數，最後必須是 **408/408 applied, 0 skipped**。
- 任何 migration 失敗、被略過、或需要 `CREATE EXTENSION` 以外的 sed → **Build 1d 判 FAIL/PENDING**，不接受 caveat 版 PASS。
- 若 `nix build` 因網路或套件版本失敗 → 誠實回報 **PENDING**，不退回 partial migration、不使用 production。

## 2) 隔離與 guard（hard fail，不 SKIP）

臨時 cluster：`PGDATA=/tmp/bsr-eph-$$-pg17/data`、`listen_addresses=''`（**只有 unix socket，物理上無法連遠端**）、socket dir 同目錄、db `bsr_ephemeral`、superuser `postgres`。

guard 注入用 GUC，不用 `\set`：

```bash
PGOPTIONS='-c bsr.ephemeral=1' psql -h /tmp/bsr-eph-$$-pg17 -U postgres -d bsr_ephemeral \
  -X -v ON_ERROR_STOP=1 -f supabase/tests/bsr_recovery_write_test.sql
```

測試檔開頭 `DO $$ ... ASSERT ... $$`（任一不符即 exit 3）：
`current_setting('bsr.ephemeral', true) = '1'`；`inet_server_addr() IS NULL`；`current_setting('unix_socket_directories')` 以 `/tmp/bsr-eph-` 開頭；`current_database()='bsr_ephemeral'`；`current_user='postgres'`；`SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','supabase_auth_admin','authenticator')` = 0；`tw_bsr_sync_queue`、`tw_chip_fact`、`data_source_refresh_logs` 起始皆 0 列。
腳本層再以 `env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE` 清掉 production 連線變數，並拒絕在 `PGHOST` 非 `/tmp/bsr-eph-*` 時執行。不 link remote、不匯入 production data/secrets。

## 3) 三案各自獨立 transaction（互不污染）

每案結構固定為 `BEGIN → 前置斷言(queue/fact 皆 0 列) → 插 fixture → bsr_backlog_metrics()/bsr_recovery_budget() 前置條件斷言 → recover → 後置斷言 → ROLLBACK`。ROLLBACK 後下一案重新斷言 0 列，杜絕殘留假綠。測試代號用 `ZZ9001`/`ZZ9002`（`stock_id` 是無格式限制的 text，這兩個保證不是真實台股代號）。

共同 fixture（依 function body 的 exact 需求）：

- `finmind_quota_pools`：`backfill` 設 `daily_budget=600, used_today=0, tokens=600`（滿足 `used_today+1 <= daily_budget-30` 且 `floor(tokens) >= 31` → `issue_ok=true`）；`keepwarm`、`interactive` 設耗盡。
- **kill switch 語意**：`check_kill_switch` 的 `enabled=true` 代表「允許執行」。不插 `system_kill_switches` 列時預設就是 true（允許）；為明確起見插入 `('chips_all', true)`。
- **degrade**：不插 `tw_bsr_sync_config` 的 `degrade:finmind` 列 → `bsr_get_degrade_state` 回 `normal/initial`，budget 走 `cap_1` 分支。
- `expected_latest_bsr_date()` 由 `tw_market_holidays`（空表）＋週末規則決定，測試以 `SELECT public.expected_latest_bsr_date()` 取值寫入 fixture，不寫死日期。

**Case A — terminal reconcile，零 token（隔離）**
只插一列 queue：`ZZ9001 / expected_latest / priority=1 / status='failed' / last_error='finmind_admission_daily' / max_attempts=5`，並插 `tw_chip_fact(ZZ9001, expected_latest, broker '9999', source 'test')`。
前置斷言：`cohort.satisfied_reconcilable = 1` 且 **`cohort.actionable_token_eligible = 0`、`actionable_still_required = 0`**（無任何 no-fact 候選 → tokens=0 是結構保證，不是碰巧）。
後置：`reconciled=1`、`reconciled_job_ids=[A.id]`、`tokens_issued=0`、`tokened_job_ids=[]`；A 列 `status='done'`、`last_error='reconciled_fact_exists'`、`max_attempts` 未變；`updated_at` 有變的列數 = 1（cohort 外 churn = 0）。

**Case B — still-required 至多一 token（隔離）**
只插一列 queue：`ZZ9002 / expected_latest / priority=3 / status='failed' / last_error='finmind_admission_daily' / max_attempts=5`，**不插任何 `tw_chip_fact`**。
分類依 body：`cand`（failed + admission/quota_deferred + `max_attempts<8` + 無 fact）→ `actionable`（`trade_date = expected_latest_bsr_date()` 這條直接成立，因此**不需要 readiness/have5 資料，也不需要任何 universe 表**）→ `eligible`（`priority=3 → pool='backfill'`，需該 pool `issue_ok=true`）。
前置斷言：`cohort.actionable_token_eligible = 1`、`cohort.satisfied_reconcilable = 0`，且 `bsr_recovery_budget(1) ->> 'budget_reason' = 'cap_1'`、`budget = 1`、pools 內 `backfill.issue_ok = true`。
後置：`tokens_issued=1`、`tokened_job_ids=[B.id]`、`reconciled=0`；B 列 `status='pending'`、`max_attempts=6`、`last_error='quota_recovery_token'`、`next_run_at <= now()`、`started_at/finished_at` 皆 NULL；被 update 的列數 = 1。無外部 API 呼叫（此測試不觸發任何 `net.http_post`，且 recover body 不含網路呼叫）。

**Case C — 原子性 / lock 競爭**
harness 步驟：
1. 背景 session：`psql ... -c "BEGIN; SELECT pg_advisory_xact_lock(771001); SELECT pg_sleep(20); ROLLBACK;" &`
2. 主 session 前輪詢 `pg_locks WHERE locktype='advisory' AND objid=771001`，**最多 15 秒**，逾時 hard fail（不進測試）。
3. 主 session（`lock_timeout='5s'`、`statement_timeout='30s'`）呼叫 `recover_quota_failed_bsr_jobs(1)`：`pg_try_advisory_xact_lock` 立即回 false，不會死鎖。
4. 斷言：`budget_reason='lock_contended'`、`tokens_issued=0`、`reconciled=0`；queue 完全無變動；`data_source_refresh_logs` 以該 `invocation_id` 恰 1 筆且 `status='skipped'`。
5. `wait` 背景 session 結束（它自己 ROLLBACK），主 session ROLLBACK。

每案都額外斷言：以 `invocation_id` 計 audit 筆數恰 = 1，且含 `metrics_before`、`metrics_after`、`budget_reason`、`pools`。

## 4) Negative control

`bash scripts/ephemeral-pg.sh test --negative-control`：**獨立第四個 transaction、獨立 fixture**（Case A 的 queue 列照插，但故意不插 `tw_chip_fact`），仍斷言 `reconciled=1`。預期 `ERROR: assertion failed` 且 **exit ≠ 0**。它在正常三案全部 ROLLBACK 之後才執行，且自身也 ROLLBACK；正常測試與 negative control 分兩次獨立 psql 呼叫，互不影響。

## 5) 交付物與 exact commands

新增兩檔 + 重寫一檔：`scripts/ephemeral-pg.sh`、`supabase/tests/_bootstrap_ephemeral.sql`、`supabase/tests/bsr_recovery_write_test.sql`。

```bash
bash scripts/ephemeral-pg.sh up        # nix build → initdb → 啟動（unix socket only）
bash scripts/ephemeral-pg.sh migrate   # 408/408 全量套用，逐檔回報
bash scripts/ephemeral-pg.sh test      # 期望 exit 0 且輸出 PASS
bash scripts/ephemeral-pg.sh test --negative-control   # 期望 exit != 0
bash scripts/ephemeral-pg.sh down      # 停止並刪除
```

**cleanup**：腳本只刪除自己建立、且同時滿足「路徑符合 `/tmp/bsr-eph-<PID>-pg17`」「該 PID 是本腳本」「`$PGDATA/PG_VERSION` 存在且內容為 `17`」的 exact 目錄；`trap 'cleanup' EXIT INT TERM` 保證失敗也清理；`pg_ctl stop -m immediate` 後 `rm -rf` 該目錄。

## 6) 報告必須列出

408/408 applied（0 skipped）、normal 測試 exit 0、negative control exit≠0、三案各自的 `invocation_id` / job id / audit 筆數 / before-after diff、以及 `inet_server_addr()=NULL`、socket 路徑、`current_database()`、`current_user` 證據。

## 7) 邊界（同 v1）

不改三個函式 body（md5 維持 `a419d519…` / `eb9ee387…` / `8a50211b…`）；不新增 workflow / table / endpoint / cron / config / 第二套 control plane；production 永不手動呼叫 recover；ephemeral 結果不得冒充自然證據。

**Approve 只執行 Build 1d ephemeral test。** 完成後仍停在 Build 1，等待三輪 exhausted / open-window 自然證據；Build 2 未授權。
