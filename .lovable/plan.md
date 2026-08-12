# Build 1e Final Plan v3 — test-only current-schema dependency slice

目標：在完全隔離的本機 PG17 上，用**正式環境真 function body**驗證 `recover_quota_failed_bsr_jobs` 的寫入語意（Tier B-write），同時**保留** 408 migration 無法從空庫還原的 FAIL 作為獨立技術債，不修、不掩蓋。

本 Plan 驗證的是**受測 dependency slice**，不是完整 current schema，任何報告用語都以此為準。

範圍鎖定：不改 `supabase/migrations/`、不改 Edge Function、不改 cron、不碰 production 物件與資料、不部署、不 Publish。Build 2 仍未授權。

---

## 1. Pinned baseline（本 Plan 已固定，generator 永遠不可覆寫）

`supabase/tests/fixtures/bsr_slice_expected.tsv` 的內容就是以下已審核的 production read-back，取得時間 2026-08-12 12:35–12:41 UTC（20:35–20:41 Taipei），全部為 read-only catalog 查詢。

### 1a. Function baseline（8 個，owner 全部為 `postgres`）

| function | identity args | returns | vol | secdef | proconfig | md5(pg_get_functiondef) |
|---|---|---|---|---|---|---|
| `bsr_backlog_metrics` | （無） | jsonb | s | t | `{search_path=public}` | `a419d519ff538c4352831cc0bab13cc0` |
| `bsr_recovery_budget` | `p_full_budget integer` | jsonb | s | t | `{search_path=public}` | `eb9ee387fb9cbaf2651eaa3e758b5137` |
| `recover_quota_failed_bsr_jobs` | `p_max integer` | jsonb | v | t | `{search_path=public}` | `8a50211b18102cda54bdd99fca991a27` |
| `bsr_get_degrade_state` | `_api text` | `TABLE(mode text, since timestamptz, reason text, trigger_metric text, trigger_value numeric, last_transition_at timestamptz, cooldown_until timestamptz)` | s | t | `{search_path=public}` | `9e6282f854489a9fae7edfb35982debb` |
| `check_kill_switch` | `_key text` | boolean | s | t | `{search_path=public}` | `c36021af6c310d08c8978c0d609f4e5b` |
| `expected_latest_bsr_date` | （無） | date | s | t | `{search_path=public}` | `48ea387eebe223cf04da2462ae668abb` |
| `checkup_prefetch_universe` | （無） | `TABLE(code text, supported boolean, reason text, sources text[])` | s | t | `{search_path=public}` | `cfcff9272446d21ce7494679be1c2c39` |
| `tw_bsr_sync_queue_touch_updated` | （無） | trigger | v | **f** | `{search_path=public}` | `fe1a2aca674d3a6b88ca2e2deaad7d7b` |

**八個全部是 hard-fail 對象**，不分核心／依賴：任一欄（identity args / return type / volatility / secdef / proconfig / owner / md5）不符即 exit≠0，行為測試不啟動。owner 語意：8 個皆 `postgres`，其中 7 個 SECURITY DEFINER 以 owner 權限執行；slice 內 owner 必須同為 cluster superuser `postgres`，否則 secdef 權限語意不等價 → hard fail。

### 1b. Relation shape fingerprint（11 張，本次已固定的 exact hash）

**Hash 演算法**：`sha256`，lowercase hex，即 `encode(sha256(convert_to(canonical,'UTF8')),'hex')`。

**Canonicalization（production 與 local slice 必須逐字重算一致）**

canonical 字串 =
```text
RELATION <relname>
#COLUMNS
<每列一行，依 attname 升冪排序>
#CONSTRAINTS
<每列一行，依 conname 升冪排序；無則單一行 ->
#UNIQUE_INDEXES
<每列一行，依 index name 升冪排序；無則單一行 ->
#TRIGGERS
<每列一行，依 tgname 升冪排序；無則單一行 ->
```

- COLUMNS 每行：`attname|format_type(atttypid,atttypmod)|attnotnull|default|identity|generated`。`default` 取 `pg_get_expr(adbin,adrelid)`，NULL 正規化為 `-`；`identity`/`generated` 空字串正規化為 `-`。只含 `attnum > 0 AND NOT attisdropped`，且取**全欄位**（是「closure 必要欄位」的嚴格超集，避免執行者主觀挑選）。
- CONSTRAINTS 每行：`conname|pg_get_constraintdef(oid)`，收 `contype IN ('p','u','c')`，以及 `confrelid` 落在這 11 張表內的 `f`（指向 closure 外的 FK 依第 4 節排除，不入 hash）。
- UNIQUE_INDEXES 每行：`index_name|pg_get_indexdef(indexrelid)`，只收 `indisunique`（`ON CONFLICT` 推斷語意）；純效能索引不入 hash。
- TRIGGERS 每行：`tgname|pg_get_triggerdef(oid)`，**只收保留的 trigger binding**，本 slice 僅 `trg_tw_bsr_sync_queue_updated` 一個；其餘 10 張表此段固定為 `-`（等同第 4 節「不建立那些 trigger」的宣告，並被 hash 鎖住）。因此 queue 的 trigger binding **併入 `tw_bsr_sync_queue` 的 relation hash**，不另立一行。
- Whitespace 正規化：所有 `pg_get_*def` 與 default 表達式先 `regexp_replace(x, '\s+', ' ', 'g')` 再 `trim`。大小寫與 schema qualification 保留 `pg_get_*def` 原樣輸出。
- 段落與行分隔一律 `\n`，無結尾換行。

**Pinned hashes（2026-08-12 12:41 UTC / 20:41 Taipei，production read-only catalog）**

| relation | sha256 |
|---|---|
| `checkup_storage` | `afb42032a3765932cd4607db5ad0dda569b51479f5a9b81d2ccb34e8b3088c3c` |
| `chips_prefetch_targets` | `7d2899dd8f16da2ef902ba4a4e1b37e5e4b9bd3a4649d9f02baf25b2d57bb609` |
| `data_source_refresh_logs` | `3cfef98085d26ed9f26450c66bd0c8cdbb58b3bf4f7c09fc2905387f23932543` |
| `expert_signals` | `867b6167c3559fbb10455dafbcf68ab02fbdb94711e72b6cfc92eda96265977d` |
| `finmind_quota_pools` | `1a43d033b34d1bcb66dfdbf75c7116edc6affe75707566229076540faa975ca8` |
| `system_kill_switches` | `ee8ded756d9abf0079fe0c756a5b06ef3f5e7caaf65265e5e3a33b58e1ca0535` |
| `trade_records` | `f75954554e5b1b2ef939d4292823eae42c10187ec4687e36977ed517fc9b38b3` |
| `tw_bsr_sync_config` | `0039f6901443ce5f296368953ba26b5e79260f524b0838aa1df8df21204170f7` |
| `tw_bsr_sync_queue` | `f7358406623859b24d3ce6895f965d140cc5f88f92a787676e1dedf556a2d0dd` |
| `tw_chip_fact` | `1a51a4fcd4d335cf59a61e928c33447742b944957a0e72f3ae1b9ce98889f7da` |
| `tw_market_holidays` | `eeb049296da3e71710726d0ca7636a32379ac37e8d3ae3683fb1bec858771ee9` |

11 張全部 `relkind = r`，無 view / matview。

### 1b-2. `bsr_slice_expected.tsv` 完整邏輯內容（Approve 的就是這 19 行）

TSV 格式，`#` 開頭為註解。標頭：

```text
# bsr_slice_expected.tsv  format_version=1  hash_algo=sha256  fn_hash=md5(pg_get_functiondef)
# pinned_at=2026-08-12T12:41Z (2026-08-12 20:41 Asia/Taipei)  approved_in=Build1e Final Plan v3
# columns: kind<TAB>name<TAB>detail...
```

- **8 行 function baseline**，欄位為 `fn <TAB> name <TAB> identity_args <TAB> returns <TAB> volatility <TAB> secdef <TAB> proconfig <TAB> owner <TAB> md5`，值即第 1a 表格逐字（`bsr_backlog_metrics`、`bsr_recovery_budget`、`recover_quota_failed_bsr_jobs`、`bsr_get_degrade_state`、`check_kill_switch`、`expected_latest_bsr_date`、`checkup_prefetch_universe`、`tw_bsr_sync_queue_touch_updated`）。
- **11 行 relation baseline**，欄位為 `rel <TAB> name <TAB> sha256`，值即第 1b 表格逐字。trigger binding 不另立行，已併入 `tw_bsr_sync_queue` 的 hash。

執行階段**只把本 Plan 已顯示的值逐字寫入檔案**，不得重新計算後改寫 expected。

### 1c. Baseline 更新規則（強制）

- `gen-bsr-slice-fixture.sh` **只**產生 `bsr_slice_schema.sql` 與 `bsr_slice_functions.sql`；程式內不含任何寫入 `bsr_slice_expected.tsv` 的路徑（以 grep 斷言該檔名不出現在任何寫入語句中）。
- generator 執行時先把 production actual 與**本 Plan 已固定的 expected** 比對，**任一欄不同就印 exact diff（欄位級 expected / actual）並 hard fail**，不產生 fixture、不自動採用新值。
- 任何 credential / DB URL 只從 secret env 讀取，永不輸出到 stdout、log 或檔案；fixture provenance 只允許寫入 project ref、timestamp（UTC + Taipei）、generator version、object hashes。
- 更新 `bsr_slice_expected.tsv` **不屬於 Build 1e 的正常執行**：只能是另一次人工審核 + 你的新批准，作為獨立變更提出。

---

## 2. Dependency closure 完整性（不靠手工解析）

`scripts/bsr-slice-closure-check.sh`（generator 內先跑一次，slice 載入後再跑一次）：

1. **Catalog 遞迴**：從三個核心函式出發，遞迴走 `pg_depend` / `pg_rewrite` 取得被引用的 relation、function、type、operator。
2. **Call graph 交叉檢查**：對每個 body 解析 `public.<ident>` 與 unqualified identifier，逐一以 `to_regclass` / `to_regprocedure` 解析。
3. **Hard fail 條件**（任一成立即 exit≠0）：
   - 出現 `EXECUTE` / `format(...)` 動態 SQL 且目標無法靜態解析；
   - 任何 public function / relation 解析不到；
   - 任何 unqualified 外部物件（非 slice、非 `pg_catalog` 內建）；
   - closure 內 relation 上存在未列入 baseline 的 trigger binding，或 baseline 有而 slice 缺。
4. 兩次結果（production 端與 slice 端）必須產出**相同的 closure 物件清單**，否則 hard fail。

**Preflight（fixture 載入後、Case A 之前）**
- 8 個 function 逐一 `CREATE` 成功（compile 期即抓 missing type / relation）；
- 對 **6 個**唯讀函式各做一次 read-only 呼叫：`expected_latest_bsr_date()`、`check_kill_switch('chips_all')`、`bsr_get_degrade_state('finmind')`、`checkup_prefetch_universe()`、`bsr_backlog_metrics()`、`bsr_recovery_budget(1)`；
- 對 `recover_quota_failed_bsr_jobs(0)` 做一次零預算 smoke 呼叫，**僅在本機 pristine synthetic DB（`bsr_ephemeral`，unix socket only）的 `BEGIN; … ROLLBACK;` 內執行，絕不對 production 呼叫**。預期 transaction 外差集為 0：`tw_bsr_sync_queue`、`tw_chip_fact`、`data_source_refresh_logs` 三表在 smoke 前後列數與內容完全相同（皆為 0 列），preflight 結束時再斷言一次。

任何 missing relation / function 都在此階段爆，不留到 Case A/B。

---

## 3. 三個 negative control（都必須在行為測試之前／之外證明 harness 會紅）

| control | 做法 | 期望 |
|---|---|---|
| **function drift** | 對 slice 內一個 function 做語意等價竄改（註解加一字元使 md5 變動） | `verify` exit≠0，行為測試不啟動 |
| **schema drift** | 對一張必要 relation 改一項：欄位型別／`NOT NULL`／default／unique constraint／unique index／trigger binding（各跑一輪，共 6 子案） | 每輪 `verify` exit≠0，行為測試不啟動 |
| **behavior** | Case A fixture 故意不插 `tw_chip_fact`，仍斷言 `reconciled=1` | `test --negative-control` exit≠0 |

---

## 4. 明列的簡化（test-only slice，非完整 schema）

| 簡化 | 為何不影響受測語意 |
|---|---|
| 不建立 RLS policy（11 表 production 皆 `relrowsecurity=t`） | 7 個 SECURITY DEFINER 函式以 owner `postgres` 執行；ACL/RLS 由已 PASS 的 Tier A 與 production 覆蓋 |
| `expert_signals` / `trade_records` 的 12 個 trigger 不建立 | 測試對兩表零寫入，只被 `checkup_prefetch_universe` 讀取，trigger 不可能觸發 |
| `tw_bsr_sync_config_snapshot_trg` 不建立 | 只影響 config 變更的稽核副作用，不改 `bsr_get_degrade_state` 讀取語意；避免把 history 表拉進 closure |
| 指向 closure 外表（experts / profiles…）的 FK 不建立、不入 hash | 測試不填這些欄位；保留會使 closure 無限外擴 |
| 純效能索引省略；unique / `ON CONFLICT` 相關索引全數保留並入 hash | 不改變結果集與衝突語意 |

`trg_tw_bsr_sync_queue_updated` **保留**，因為 churn 斷言依賴它的 `updated_at` 語意。

---

## 5. Exact commands（production 讀取與 slice 執行完全分離）

**A. Production catalog generator — 獨立、明確 opt-in、read-only**

```bash
BSR_SLICE_ALLOW_PROD_READ=1 bash scripts/gen-bsr-slice-fixture.sh --project-ref yqacmrgdjlenbijclngi
```
- 未設 `BSR_SLICE_ALLOW_PROD_READ=1` 直接拒絕執行。
- guard：連線 host 必須符合 managed PG host pattern 且 project-ref 相符，否則 hard fail。
- 只允許 `SELECT` catalog metadata 與 `pg_get_functiondef` / `pg_get_triggerdef` / `pg_get_constraintdef` / `pg_get_indexdef`；不查任何業務表 row、不讀 secret 值、不碰 `auth` / `storage`。
- 先跑第 1c 的 expected 比對，通過才寫 fixture。

**B. 正常 slice 流程 — 完全離線，只讀 committed fixtures + pinned expected**

```bash
bash scripts/ephemeral-pg.sh up-slice          # 本機 PG17，unix socket only
bash scripts/ephemeral-pg.sh load-slice        # schema + functions fixture
bash scripts/ephemeral-pg.sh verify            # closure check + drift gate + preflight
bash scripts/ephemeral-pg.sh test              # Case A/B/C，期望 exit 0
bash scripts/ephemeral-pg.sh test --negative-control          # 期望 exit != 0
bash scripts/ephemeral-pg.sh verify --drift-control function  # 期望 exit != 0
bash scripts/ephemeral-pg.sh verify --drift-control schema    # 期望 exit != 0（6 子案）
bash scripts/ephemeral-pg.sh down              # 前綴 + PG_VERSION 雙驗證後銷毀
```
這條路徑內建 `unset PG*`，且 cluster `listen_addresses=''`，物理上不可能連 production。

**C. 診斷用（不是測試 gate）**

```bash
bash scripts/ephemeral-pg.sh diagnose-migrations   # 預期 nonzero；標示 408 restore FAIL
```
`migrate` 子命令改名為 `diagnose-migrations`，檔頭與輸出印明「repo migration history 不自足，本命令的失敗是已知獨立技術債，非 Tier B-write gate」。非零退出且永不輸出 PASS 字樣，不可能被誤當綠燈。

---

## 6. Guards / 隔離（沿用 Build 1d）

`bsr.ephemeral=1` GUC、`inet_server_addr() IS NULL`、socket 路徑前綴 `/tmp/bsr-eph-`、`current_database()='bsr_ephemeral'`、`current_user='postgres'`、production role 指紋（`supabase_admin` / `supabase_auth_admin` / `authenticator`）為 0、pristine（queue / fact / audit 三表為空）。root 環境降權 uid 1000 執行 initdb / postgres。cleanup 只刪符合 `/tmp/bsr-eph-<pid>-pg17` 且 `PG_VERSION=17` 的目錄。

closure 內無 auth / storage / cron / net 物件，因此 slice **完全不建立**它們；亦不需 pgvector / pg_cron / pg_net / pgcrypto。

---

## 7. Case A/B/C（內容不變，核心 body 不得為通過測試而改動）

各自獨立 transaction、ROLLBACK 收尾、前置 cohort/budget assertions、exact job ids、audit exactly-once、cohort 外 `updated_at > created_at` 必為 0。

- **A** terminal reconcile：precondition `satisfied_reconcilable=1 / still_required=0 / token_eligible=0` → `reconciled=1`、`tokens_issued=0`、`status=done`、`last_error=reconciled_fact_exists`、`max_attempts` 不變、audit 恰一列含 `metrics_before / metrics_after / budget_reason / pools`。
- **B** still-required：precondition `token_eligible=1`、`budget_reason=cap_1`、backfill pool `issue_ok` → `tokens_issued=1`、`status=pending`、`last_error=quota_recovery_token`、`max_attempts` 5→6、`next_run_at<=now()`、`started_at/finished_at` 清空、audit 恰一列。
- **C** 外部 session 持 advisory lock 771001 → `budget_reason=lock_contended`、tokens/reconciled 皆 0、queue row 逐欄不變、audit 恰一列且 `status=skipped`。

---

## 8. Exact files（Build 1e 會新增／修改的全部檔案）

新增：
- `scripts/gen-bsr-slice-fixture.sh`（opt-in production read-only generator）
- `scripts/bsr-slice-closure-check.sh`（遞迴 closure + call graph 交叉檢查）
- `scripts/bsr-slice-verify.sh`（drift gate + preflight，被 `ephemeral-pg.sh verify` 呼叫）
- `supabase/tests/fixtures/bsr_slice_expected.tsv`（pinned baseline，逐字寫入本 Plan 已批准的 19 行）
- `supabase/tests/fixtures/bsr_slice_schema.sql`（generator 產出）
- `supabase/tests/fixtures/bsr_slice_functions.sql`（generator 產出，body 為 production 原文）

修改：
- `scripts/ephemeral-pg.sh`（新增 `up-slice` / `load-slice` / `verify`；`migrate` → `diagnose-migrations`）
- `supabase/tests/bsr_recovery_write_test.sql`（僅 guard 訊息微調）
- `supabase/tests/_bootstrap_ephemeral.sql`（僅加檔頭：只服務 `diagnose-migrations`）

不提交：production rows、secrets、完整 schema dump、任何 `supabase/migrations/` 變更。

---

## 9. 判定分界

1. **Tier B-write 行為驗證**由本 slice 判定 PASS/FAIL；綠燈只代表「recover / budget / metrics 在受測 dependency slice 上的語意正確」。
2. **408 migration restore 仍 FAIL**（第 11 檔 `line_binding_codes` 缺 pre-history baseline，全量續跑 176 errors），本測試不修復、不掩蓋。結案報告兩欄並列，**不得**出現「Build 1 全面可還原」字樣。
3. **是否阻止 Build 1 結案：不阻止。** 本輪市場資料修補全部是對既有 production schema 的增量變更，正確性由 production 自然排程證據 + Tier A ACL 目錄測試 + 本 slice 語意測試共同覆蓋，沒有任何一步依賴「從空庫重建整庫」。migration history 不自足只在 DR／建立全新環境時成為阻斷點，屬獨立 DR 工單。

---

## 10. 批准範圍

Approve 只准執行 **Build 1e test-only slice**（第 1–8 節）。完成後仍停在 Build 1，等待 production 自然排程的 exhausted / open-window job106 / job107 證據；ephemeral 測試結果**不得**冒充自然證據。Build 2 未授權。
