# Build 1e Final Plan — test-only current-schema dependency slice

目標：在完全隔離的本機 PG17 上，用**正式環境真 function body**驗證 `recover_quota_failed_bsr_jobs` 的寫入語意（Tier B-write），同時**保留** 408 migration 無法從空庫還原的 FAIL 作為獨立技術債，不修、不掩蓋。

範圍鎖定：不改 `supabase/migrations/`、不改 Edge Function、不改 cron、不碰 production 物件與資料、不部署、不 Publish。Build 2 仍未授權。

---

## 1. Dependency closure（read-only 盤點結果，2026-08-12 12:35 UTC 由 production catalog 取得）

三個核心函式與其被呼叫者的 body 已用 `pg_get_functiondef` 全文取出並解析 FROM/JOIN/UPDATE/INSERT/DELETE 目標。

**必須存在的 functions（一律使用 production 真 body，不 mock）**

| function | identity args | returns | vol | secdef | search_path | md5 |
|---|---|---|---|---|---|---|
| `bsr_backlog_metrics` | （無） | jsonb | s | t | public | `a419d519ff538c4352831cc0bab13cc0` |
| `bsr_recovery_budget` | `p_full_budget integer` | jsonb | s | t | public | `eb9ee387fb9cbaf2651eaa3e758b5137` |
| `recover_quota_failed_bsr_jobs` | `p_max integer` | jsonb | v | t | public | `8a50211b18102cda54bdd99fca991a27` |
| `bsr_get_degrade_state` | `_api text` | TABLE(...) | s | t | public | `9e6282f854489a9fae7edfb35982debb` |
| `check_kill_switch` | `_key text` | boolean | s | t | public | `c36021af6c310d08c8978c0d609f4e5b` |
| `expected_latest_bsr_date` | （無） | date | s | t | public | `48ea387eebe223cf04da2462ae668abb` |
| `checkup_prefetch_universe` | （無） | TABLE(...) | s | t | public | `cfcff9272446d21ce7494679be1c2c39` |
| `tw_bsr_sync_queue_touch_updated` | （無，trigger fn） | trigger | v | — | — | 生成時鎖定 |

為何必要：前三個是受測對象；`bsr_recovery_budget` 內部呼叫 `bsr_get_degrade_state`、`check_kill_switch`；`bsr_backlog_metrics` 與 recover 的 cohort 判定呼叫 `expected_latest_bsr_date` 與 `checkup_prefetch_universe`；`tw_bsr_sync_queue_touch_updated` 是 queue 的 BEFORE UPDATE trigger，直接決定「無 cohort 外 churn」斷言用的 `updated_at` 語意。

**必須存在的 relations（全部 relkind=r，無 view、無 matview）**

| relation | 為何在 closure |
|---|---|
| `tw_bsr_sync_queue` | recover 讀寫的主體（10 處引用） |
| `tw_chip_fact` | reconcile 判定「事實已存在」 |
| `data_source_refresh_logs` | audit exactly-once 的落地表 |
| `finmind_quota_pools` | budget 的 pool/issue_ok 判定 |
| `system_kill_switches` | `check_kill_switch('chips_all')` |
| `tw_bsr_sync_config` | `bsr_get_degrade_state` 讀 `key='degrade:finmind'` |
| `tw_market_holidays` | `expected_latest_bsr_date` 的台股交易日推算 |
| `chips_prefetch_targets` | metrics/universe 的優先名單 |
| `trade_records`, `expert_signals`, `checkup_storage` | `checkup_prefetch_universe` 的三個來源；測試中**保持空表**，但不能不存在 |

**types / extensions**：closure 內無自訂 enum/domain；不需要 pgvector / pg_cron / pg_net / pgcrypto（`gen_random_uuid()` 為 PG13+ 內建）。因此 Build 1e 的 cluster **不建立** auth / storage / cron / net 任何物件——它們不在 closure 內。

**不複製任何 production row**：只取 catalog metadata（欄位、型別、預設、nullability、約束、索引），fixture 資料一律由測試自行插入 `ZZ90xx` 假股號。

---

## 2. Schema-drift gate（行為測試之前執行，不過就 exit≠0）

`scripts/bsr-slice-verify.sh`：
1. 對 fixture 建好的本機 DB 重跑同一組 catalog 查詢，逐一比對 identity args / return type / volatility / security definer / `proconfig` / `md5(pg_get_functiondef)`。
2. 期望值寫死在 `supabase/tests/fixtures/bsr_slice_expected.tsv`（含上表 8 行）。
3. 任一欄不符 → 立即 hard fail，行為測試不啟動。
4. **Negative control (drift)**：`--drift-control` 模式會在 fixture 載入後對某一個 core function 做一次語意等價的 body 竄改（例如在註解加一字元使 md5 改變），gate 必須在行為測試之前 exit≠0。這證明綠燈不是拿舊 body 換來的。

核心 function body 在任何情況下都不得為了讓測試通過而修改；fixture 檔內的 body 由生成腳本從 production 原文寫入，人工不得編輯（檔頭寫明並以 md5 gate 強制）。

---

## 3. Fixture 生成方式與 provenance

`scripts/gen-bsr-slice-fixture.sh`（read-only，只跑 SELECT）產生兩個檔：

- `supabase/tests/fixtures/bsr_slice_schema.sql` — 11 張表的 DDL，欄位/型別/default/nullability 由 `information_schema.columns` 還原；PK、UNIQUE、CHECK、FK 由 `pg_constraint` 還原後**篩選**；索引由 `pg_indexes` 還原後篩選。
- `supabase/tests/fixtures/bsr_slice_functions.sql` — 8 個 function 的 `pg_get_functiondef` 原文 + queue 的 BEFORE UPDATE trigger 綁定。

兩檔檔頭都寫入 provenance：`generated_at`（UTC + Asia/Taipei）、來源 project ref、生成腳本版本、每個物件的 md5。

**明列的簡化（test-only snapshot，不自稱 current schema 完整複製）**

| 簡化 | 影響評估 |
|---|---|
| 不建立 RLS policy（11 表 production 皆 `relrowsecurity=t`） | 三核心皆 SECURITY DEFINER + owner，且測試以 `postgres` 執行，RLS 不進入受測路徑；ACL/RLS 由 Tier A（已 PASS）與 production 覆蓋 |
| `expert_signals` / `trade_records` 的 12 個 trigger（audit、unit consistency、capital limit、first-fetch enqueue…）不建立 | 這兩張表在測試中**零 INSERT/UPDATE**，只被 `checkup_prefetch_universe` 讀取；trigger 不可能被觸發 |
| `tw_bsr_sync_config_snapshot_trg`（寫 history 表）不建立 | 只影響 config 變更的稽核副作用，不影響 `bsr_get_degrade_state` 的讀取語意；避免把 `tw_bsr_sync_config_history` 拉進 closure |
| 不建立與 closure 無關的 FK（指向 experts/profiles 等 closure 外表） | 測試不插入這些欄位的非 NULL 值；保留會迫使 closure 無限外擴 |
| 只保留 queue/fact 上參與 `WHERE`、`ORDER BY`、`ON CONFLICT` 的索引與唯一鍵 | 唯一鍵語意（`ON CONFLICT`）保留；純效能索引省略不改變結果 |

`tw_bsr_sync_queue_touch_updated` trigger **保留**，因為它承載 churn 斷言語意。

---

## 4. 執行流程（`scripts/ephemeral-pg.sh` 重用，新增 `slice` 子命令）

```text
up-slice  → nix PG17（不需 pgvector/pg_cron/pg_net，改用最小 postgresql_17）
            initdb → listen_addresses='' → unix socket 於 /tmp/bsr-eph-<pid>-pg17
            降權 uid 1000（root 無法跑 initdb）
load      → bsr_slice_schema.sql + bsr_slice_functions.sql（不套任何 migration）
verify    → schema-drift gate（第 2 節）
test      → bsr_recovery_write_test.sql（Case A/B/C）
down      → 前綴 + PG_VERSION 雙重驗證後銷毀
```

Guards 沿用 Build 1d：`bsr.ephemeral=1` GUC、`inet_server_addr() IS NULL`、socket 路徑前綴、`current_database()='bsr_ephemeral'`、production role 指紋為 0、pristine（queue/fact/audit 三表為空）。

Case A/B/C 各自獨立 transaction、以 ROLLBACK 收尾，內容沿用 Build 1d 已寫好的測試檔：
- **A** terminal reconcile：precondition `satisfied_reconcilable=1 / still_required=0 / token_eligible=0` → `reconciled=1, tokens_issued=0`、exact job id、`status=done`、`last_error=reconciled_fact_exists`、`max_attempts` 不變、audit 恰一列且含 metrics_before/after/budget_reason/pools。
- **B** still-required：precondition `token_eligible=1`、`budget_reason=cap_1`、backfill pool `issue_ok` → `tokens_issued=1`、exact job id、`status=pending`、`last_error=quota_recovery_token`、`max_attempts` 5→6、`next_run_at<=now()`、`started_at/finished_at` 清空、audit 恰一列。
- **C** advisory lock 771001 由外部 session 持有 → `budget_reason=lock_contended`、tokens/reconciled 皆 0、queue row 逐欄不變、audit 恰一列且 `status=skipped`。
- 三個 case 皆斷言 cohort 外 `updated_at > created_at` 的列數為 0。

退出碼：`test` 全綠 exit 0；`test --negative-control`（缺 fact 卻斷言 reconciled=1）必須 exit≠0；`verify --drift-control` 必須 exit≠0。

---

## 5. Build 1d 產物處置

| 檔案 | 處置 | 理由 |
|---|---|---|
| `scripts/ephemeral-pg.sh` | **修改重用**：`migrate` 子命令改名 `migrate-full` 並在檔頭標註「已知 FAIL：repo migration history 不自足，保留為診斷工具」；新增 `load-slice` / `verify` | 兩條路徑用途明確分離，不會出現兩套互相冒充的 harness |
| `supabase/tests/_bootstrap_ephemeral.sql` | **僅供 `migrate-full` 診斷用**，slice 路徑不載入 | slice 不需要 auth/storage/cron/net |
| `supabase/tests/bsr_recovery_write_test.sql` | **保留、僅微調** guard 訊息 | 測試內容本身與載入方式無關 |

不刪除診斷路徑，但它不再是 Tier B-write 的 gate。

---

## 6. 判定分界（Plan 承諾的三件事）

1. **Tier B-write 行為驗證可由 dependency slice 判定 PASS/FAIL。** 受測的是 production 真 body 與真 relation 形狀，md5 gate 確保沒有舊 body 假綠；本 slice 綠燈只代表「函式語意正確」。
2. **408 migration restore 仍為 FAIL，且不被此測試修復或掩蓋。** 結案報告會分兩欄並列：`Tier B-write: PASS/FAIL`、`migration bootstrappability: FAIL（第 11 檔 `line_binding_codes` 缺 pre-history baseline，全量續跑 176 errors）`，後者列為獨立 open tech debt。
3. **這筆技術債是否阻止 Build 1 結案：不阻止。** 論證：本輪市場資料修補的所有變更（recover/budget/metrics 三函式、ACL、cron payload）都是**對既有 production schema 的增量 ALTER/CREATE OR REPLACE**，其正確性由 (a) production 自然排程證據、(b) Tier A ACL 目錄測試、(c) 本 slice 的語意測試共同覆蓋；沒有任何一步依賴「從空庫重建整個資料庫」。migration history 不自足只在災難還原或建立全新環境時才成為阻斷點，屬於 DR 議題，不是本次資料修補的正確性前提。因此預設**不順手修 history**；若之後要做 DR，才另開獨立工單補 pre-history baseline。

---

## 7. 批准範圍

Approve 只執行 **Build 1e test-only dependency slice**（第 1–5 節）。完成後停在 Build 1，繼續等待 production 自然排程的 exhausted / open-window 證據；ephemeral 測試結果**不得**冒充自然證據。Build 2（lane A/B、全市場輪轉）仍未授權。
