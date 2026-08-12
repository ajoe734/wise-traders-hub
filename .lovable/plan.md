# Build 1d — Tier B-write 真隔離 ephemeral 測試（Final Plan）

唯一目標：把 `supabase/tests/bsr_recovery_write_test.sql` 從 PENDING 變成「真的跑過且 exit 0」，全程不碰 production。不做 Build 2、不新增永久環境／workflow／table／endpoint。

## 環境事實（已 read-only 查證，不要再假設）

- **沒有 Docker**（`/var/run/docker.sock` 不存在）、**沒有 Supabase CLI**（`command -v supabase` 無輸出）→ **`supabase db start` / `supabase db reset` 在本環境是無效指令**，測試檔頂端那段註解要改成實際可跑的指令。
- **有完整本機 PostgreSQL 17.9 二進位**：`/bin/initdb`、`/bin/pg_ctl`、`/bin/postgres`、`/bin/psql`。→ 可在 `/tmp` 起「用完即銷毀」的臨時 cluster，不需要 Docker、不留永久基礎設施。
- 本機 PG 內建擴充有 `pgcrypto`、`pg_trgm`；**沒有 `vector`、`pg_cron`、`pg_net`**（migrations 有引用）。`nix` 可用，必要時可 `nix build nixpkgs#postgresql_17.withPackages (p: [p.pgvector])` 取得 pgvector。
- 既有可沿用的 harness：`.github/workflows/finmind-admit-sql-tests.yml` 已經是「postgres service → bootstrap(auth stub + anon/authenticated/service_role roles) → 依檔名全量 apply `supabase/migrations/*.sql` → 跑 `supabase/tests/*.sql`」。Build 1d 只是把同一套流程搬到本地臨時 cluster 的一支腳本，**不新增 workflow**。
- recover 路徑的真實依賴（來自 repo 內函式 body，非 production 查詢）：`tw_bsr_sync_queue`、`tw_chip_fact`、`data_source_refresh_logs`、`finmind_quota_pools`、`system_kill_switches`(`check_kill_switch('chips_all')`)、`bsr_get_degrade_state('finmind')`、`expected_latest_bsr_date()`、`bsr_backlog_metrics()`、`bsr_recovery_budget()`。全部是現有 schema，fixture 可 100% synthetic。

## 交付物（只有兩個新檔 + 一次測試檔重寫）

1. `scripts/ephemeral-pg.sh` — 建立／銷毀臨時 cluster 的一次性腳本（不常駐、不寫入 repo 以外永久狀態）。
2. `supabase/tests/_bootstrap_ephemeral.sql` — auth/storage/cron/net stub + 三個 role，沿用既有 CI bootstrap 內容。
3. 重寫 `supabase/tests/bsr_recovery_write_test.sql`：換掉無效的 CLI 註解、加硬性 guard、加三條語意斷言與 negative-control 開關。

## 隔離與 guard（任一不符 → hard fail，非 SKIP）

臨時 cluster 規格：`PGDATA=/tmp/bsr-eph-$$/data`、`listen_addresses=''`（**只開 unix socket，物理上無法連到遠端**）、socket dir `/tmp/bsr-eph-$$`、database `bsr_ephemeral`、superuser `postgres`。

測試檔開頭的 guard（全部 `ASSERT`，失敗即 exit 3）：

- `current_setting('bsr.ephemeral', true) = '1'`（由腳本 `-v` / `SET` 明確 opt-in；缺少即 fail）。
- `inet_server_addr() IS NULL`（unix socket）**且** `current_setting('unix_socket_directories')` 以 `/tmp/` 開頭。
- `current_database() = 'bsr_ephemeral'` 且 `current_user = 'postgres'`。
- production 指紋不得存在：`SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','supabase_auth_admin','authenticator')` 必須為 0；`tw_bsr_sync_queue` 在載入 fixture 前必須 0 列。
- 環境層：腳本拒絕在 `PGHOST` 指向非 `/tmp` 路徑、或 `SUPABASE_DB_URL`/`PG*` 指向 hosted 專案時執行；跑測試時以 `env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE` 清掉 production 連線變數。
- **絕不 link remote project、絕不匯入 production data 或 secrets**；fixture 全部是手寫 synthetic 值。

## 全量 migration 套用（假綠防線）

腳本依檔名序 `psql -v ON_ERROR_STOP=1 -f` 套用全部 408 個 migration，任何一個失敗即整體非 0。

`vector` / `pg_cron` / `pg_net` 處理順序：

1. 先嘗試 `nix build nixpkgs#postgresql_17.withPackages (p: [p.pgvector])`，成功就用該 build 的 `initdb/postgres`，`vector` 真裝。
2. `pg_cron`/`pg_net` 不裝真擴充：bootstrap 建立 `cron`、`net` stub schema 與 `cron.schedule/unschedule`、`net.http_post` no-op 函式，並在 apply 前以 `sed` 只跳過 `CREATE EXTENSION ... pg_cron|pg_net` 那幾行（不改 repo 檔，改的是 `/tmp` 內的副本）。
3. 若 pgvector 取得失敗，唯一被跳過的檔案（`20260709193317_*.sql` 及其後續 `::vector` cast）**必須在輸出中逐檔列名**，並在測試結論標成「full-apply caveat」。**不得靜默跳過、不得因此宣稱 full apply PASS**。

## Fixture（最小 synthetic，載入後只驗證這三條語意）

固定 `stock_id` 用 `T0001/T0002`（現實不存在的代號），`trade_date` 用 `expected_latest_bsr_date()` 回傳值：

- `finmind_quota_pools`：`backfill` 有餘裕（`used_today+1 <= daily_budget-30` 且 `tokens >= 31`）、`keepwarm/interactive` 耗盡。
- `system_kill_switches('chips_all')` 開啟；degrade 狀態設為 `normal`（無 `tw_bsr_degrade_events` 或補一列 normal）。
- Case A（terminal reconcile）：queue 一列 `status=failed, last_error='finmind_admission_x'`，且 `tw_chip_fact` 已有同 `(stock_id, trade_date)`。
- Case B（still-required 發 token）：queue 一列 failed、`max_attempts=5`、priority 3（→ `backfill` pool）、`tw_chip_fact` 無對應列。
- Case C（原子性）：在同一 session 開 transaction 取得 advisory lock 771001 後，另一 session 呼叫應得 `budget_reason='lock_contended'`、tokens=0、reconciled=0，且恰一筆 `skipped` audit。

## 斷言（含數量、job id、before/after、exactly-once、無 cohort 外 churn）

每次呼叫前後對 `tw_bsr_sync_queue` 取 snapshot（`id, status, max_attempts, next_run_at, last_error, updated_at`）：

- A：回傳 `reconciled=1` 且 `reconciled_job_ids=[<A.id>]`、`tokens_issued=0`；A 列 `status='done'`、`last_error='reconciled_fact_exists'`、**`max_attempts` 未變**；差集（除 A 以外被 update 的列）= 0。
- B：`tokens_issued=1`、`tokened_job_ids=[<B.id>]`；B 列 `status='pending'`、`max_attempts` +1、`last_error='quota_recovery_token'`、`next_run_at <= now()`；差集除 B 外 = 0；**未發生任何外部 API 呼叫**（本測試無 `pg_net`，物理上不可能）。
- 每次呼叫 `data_source_refresh_logs` 以 `invocation_id` 計數恰 = 1，且含 `metrics_before/metrics_after/budget_reason/pools`。
- C：lock 競爭時 queue 完全無變動、audit 恰一筆 `skipped`。
- 結束以 `ROLLBACK`（行為測試包在 transaction 內）**並且**腳本最後銷毀整個 cluster（`pg_ctl stop -m immediate; rm -rf /tmp/bsr-eph-$$`）。production row count 不需檢查，因為連線物理上不可能到達 production——輸出會印出 `inet_server_addr()=NULL` 與 socket 路徑作為證據。

## Negative control（證明 harness 會非 0）

腳本支援 `--negative-control`：對 Case A 故意刪掉 `tw_chip_fact` 對應列後仍斷言 `reconciled=1`。預期輸出 `ERROR: assertion failed` 且 **exit ≠ 0**。報告必須同時附「正常跑 exit 0」與「negative control exit≠0」兩段輸出，否則 Tier B-write 不算 PASS。

## Exact commands（Approve 後才執行）

```bash
bash scripts/ephemeral-pg.sh up            # initdb + start（unix socket only）
bash scripts/ephemeral-pg.sh migrate       # 全量套用 migrations，逐檔回報
bash scripts/ephemeral-pg.sh test          # bsr_recovery_write_test.sql，期望 exit 0 + 'PASS'
bash scripts/ephemeral-pg.sh test --negative-control   # 期望 exit≠0
bash scripts/ephemeral-pg.sh down          # 停止並刪除整個 /tmp cluster
```

執行身分：本機 `postgres` superuser（臨時 cluster 內），非 sandbox 受限角色、非 service_role 連線。失敗復原：任何步驟失敗直接 `down`，刪 `/tmp/bsr-eph-*` 即完全復原，repo 與 production 皆無痕跡。

## 不做 / 邊界

- 不對 production 呼叫 `recover_quota_failed_bsr_jobs`（連 rollback transaction 也不）。
- 不新增 workflow、table、endpoint、cron、config、第二套 control plane；不修改三個函式 body（ACL migration 後 md5 維持 `a419d519…` / `eb9ee387…` / `8a50211b…`）。
- ephemeral 結果**不得**冒充自然證據；Tier C 仍只由自然 job 106 累積。

## 驗收判定

- Tier B-write PASS = 全量 migration apply 成功（或明列 caveat 檔案）+ 正常跑 exit 0 + negative control exit≠0 + 上列斷言全綠。
- 若 pgvector 與 stub 兩條路都失敗導致 cluster 起不來 → 誠實回報 **仍為 PENDING**，不降級用 production rollback transaction 替代。

**Approve 只執行 Build 1d ephemeral test。** 完成後仍停在 Build 1，等待三輪 exhausted / open-window 自然證據；Build 2 未授權。
