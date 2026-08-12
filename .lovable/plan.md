# Build 1c — Final Plan v2（ACL 收斂 + 測試可執行性）

範圍只有兩件事：把三個 BSR recovery 函式的執行權限收斂到 service_role，以及把 `supabase/tests/bsr_quota_recovery_test.sql` 拆成「在本環境能誠實執行」的層次。不動函式 body、Edge Function、cron、queue/fact/audit 資料、degrade/分類邏輯、全域 default privileges。Build 2 仍未授權。

## A. 已證實的 production 事實

三函式真實 signature 與 ACL（`pg_proc` 讀出，2026-08-12）：

```text
bsr_backlog_metrics()                        proacl: postgres=X, anon=X, authenticated=X, service_role=X, sandbox_exec_*=X
bsr_recovery_budget(p_full_budget integer)   proacl: 同上
recover_quota_failed_bsr_jobs(p_max integer) proacl: 同上
enqueue_chips_prefetch_gaps(int,int)         proacl: postgres=X, service_role=X, sandbox_exec_*=X   ← 無 anon/authenticated
```

三者皆 `SECURITY DEFINER`、`proconfig={search_path=public}`。body md5 基線：metrics `a419d519ff538c4352831cc0bab13cc0`、budget `eb9ee387fb9cbaf2651eaa3e758b5137`、recover `8a50211b18102cda54bdd99fca991a27`。

`information_schema.routine_privileges` 對這三個回 0 列（受限連線視角），故判讀一律以 `pg_proc.proacl` + `has_function_privilege()` 為準。

### ACL 來源（區分「已證實」與「推論」）

已證實：
- 全部 4 個相關 migration（`20260812072036`、`20260812073958`、`20260812103720`、`20260812103937`）中，**沒有任何一行 GRANT 給 anon 或 authenticated**；只有 `REVOKE ALL ... FROM PUBLIC` 與 `GRANT ... TO service_role`。
- `pg_default_acl` 存在 `supabase_admin / public / f → {postgres=X, anon=X, authenticated=X, service_role=X}`。
- 現況 proacl 內 anon/authenticated 的 grantor 是 `postgres`。
- 既有 migration 的 `REVOKE ... FROM PUBLIC` 對 anon/authenticated 的顯式條目無效（PUBLIC 與具名角色是不同 grantee）。

最可能來源（推論，未由歷史逐筆證實）：這兩個顯式 grant 是**函式首次 CREATE 時**由上述 default ACL 生成的。PostgreSQL 對既有函式做 `CREATE OR REPLACE` 會保留原 owner 與既有 privileges，因此不宣稱「每次 replace 都重新灌回」。
未證實的部分不寫進 migration 註解；註解只寫可驗證的操作要求：**任何未來新建（非 replace）同名函式，或以 DROP + CREATE 重建，都必須重跑本次 exact-signature REVOKE，並重做 read-back 矩陣**。

## B. Migration（唯一一段變更）

只針對三個 exact signature，不碰全域 `ALTER DEFAULT PRIVILEGES`：

```sql
REVOKE ALL ON FUNCTION public.bsr_backlog_metrics()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bsr_recovery_budget(integer)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bsr_backlog_metrics()                  TO service_role;
GRANT EXECUTE ON FUNCTION public.bsr_recovery_budget(integer)           TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) TO service_role;
```

無 `CREATE OR REPLACE`、無新表/view/欄位/index/endpoint/config/cron。同一份 migration 內附帶 B-readonly 正向契約斷言（見 D 節）與 read-back 斷言，全部是 `DO $$ ... ASSERT ... $$`，只讀不寫。

## C. 撤權不會造成 regression

- 全庫程式碼清點（`rg` 掃 `src/`、`supabase/`、`scripts/`）：三個函式在應用層**零 caller**——沒有 `supabase.rpc(...)`、沒有 Edge Function 呼叫、沒有前端引用。出現處僅 migrations 與測試檔。
- 唯一 production 呼叫路徑：cron job 106 → `SELECT public.enqueue_chips_prefetch_gaps(10, 300)`（直接 SQL），其內部再呼叫 `recover_quota_failed_bsr_jobs` → `bsr_recovery_budget` → `bsr_backlog_metrics`。
- job 106 由 pg_cron 以 postgres 執行；`enqueue_chips_prefetch_gaps` 為 SECURITY DEFINER、owner postgres，函式體內呼叫以 owner 權限求值，postgres 對三者皆保有 `X`。撤掉 anon/authenticated 對此鏈無影響。
- `enqueue_chips_prefetch_gaps` 本身早已無 anon/authenticated 執行權且每小時正常完成，是同一模式的現成反證樣本。

## D. 測試分層（誠實可執行，含本環境的實際執行方式）

### Tier A — catalog／ACL（本環境可實跑）
新檔 `supabase/tests/bsr_acl_metadata_test.sql`：只查 `pg_proc`（provolatile、prosecdef、proconfig、proacl）與 `has_function_privilege()`，不呼叫任何函式。
執行身分與指令（sandbox，`PG*` 已設定，角色 `sandbox_exec`）：

```bash
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/bsr_acl_metadata_test.sql
```

涵蓋原檔第 1、2 段與本次 ACL 驗收。**此層必須實跑並回報 PASS/FAIL。**

### Tier B-readonly — metrics/budget JSON 契約正向呼叫
`sandbox_exec`（psql）與 `read_query` 連線皆已實測回 `42501 permission denied for function bsr_backlog_metrics`，因此**不能**在這兩條路徑上做正向呼叫。
本環境唯一可用的管理連線是 migration 執行通道（以 postgres 身分）。做法：把原檔第 3、4 段（metrics key 契約與 cohort 加總、budget gates 與 pool 排除）改寫為 `DO $$ ... ASSERT ... $$`，**併入 B 節的 ACL migration**，只呼叫 read-only 的 `bsr_backlog_metrics()` 與 `bsr_recovery_budget(12)`；任一 ASSERT 失敗會讓整份 migration 回滾，等同 gate。斷言語意與原檔一致，不新增副作用。
檔案面保留 `supabase/tests/bsr_metrics_contract_test.sql` 供未來管理連線／CI 重跑，內容與 migration 內的 DO block 相同。

### Tier B-write — recover 行為測試
`recover_quota_failed_bsr_jobs` 在 production **永不手動執行**，連 rollback transaction 也不做。
新檔 `supabase/tests/bsr_recovery_write_test.sql`，只在真正 ephemeral 資料庫執行：

```bash
supabase db start           # 本機 ephemeral Postgres
supabase db reset           # 套用 supabase/migrations 全量
psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/bsr_recovery_write_test.sql
```

檔頭加守門：`current_database()` 不得為 production、且 `has_function_privilege(current_user, ..., 'EXECUTE')` 必須為真，否則 `\echo SKIPPED (non-ephemeral or insufficient role)` 並以非 0 結束，標記為 PENDING，不得印 PASS。
目前 Lovable 環境沒有本機 ephemeral DB 通道，因此本層在核准後仍為 **PENDING**。

### Tier C — production write contract
recover 的實際寫入語意由**自然 job 106** 的 `data_source_refresh_logs(source_key='bsr_quota_recovery')` 證明：exactly-one audit、duration ≤ 30s、最多 1 reconcile / 1 token、無 mass update。
Tier C 是 production write contract 的**替代 gate**，與 Tier B-write（單元語意驗證）不可互相冒充，報告中分開列示。

### 結案矩陣
| 層 | 本次可得結論 |
|---|---|
| Tier A（ACL/catalog） | 可 PASS |
| Tier B-readonly（JSON 契約） | 可 PASS（經 migration DO block 正向呼叫） |
| Tier B-write（recover 單元語意） | **PENDING**（缺 ephemeral DB） |
| Tier C（自然 job 106 write contract） | 修補後下一輪自然執行時可 PASS |

Tier B-write PENDING 期間，**不得宣稱 Build 1c 或 Build 1b 全部結案**；只能宣告「ACL FAIL 已修復、production write contract 由自然 job 106 證明、recover 單元語意仍 PENDING」。

原 `bsr_quota_recovery_test.sql` 由上述三檔取代，斷言語意搬移不改。

## E. Read-back acceptance（migration 後立即，唯讀）

1. `pg_get_function_identity_arguments` 確認三個 signature 未變（``、`p_full_budget integer`、`p_max integer`）。
2. `md5(pg_get_functiondef(oid))` 必須等於 A 節基線三值。
3. `pg_proc.proacl` 不得出現 `anon=` / `authenticated=`；必須保留 `service_role=X`。
4. `has_function_privilege()` 矩陣：`anon`、`authenticated`、`public` → false；`service_role` → true（三個函式各一組）。
5. 負向實測：以 `sandbox_exec`／`read_query` 呼叫 metrics → 仍為 permission denied（撤權前後皆然，記錄為環境限制而非驗收證據）。
6. 正向實測：僅 Tier B-readonly 的 read-only 呼叫；`recover_quota_failed_bsr_jobs` 禁止手動呼叫。
7. **修補後的下一個自然 job 106**：恰一筆 audit、duration ≤ 30s、最多 1 reconcile / 1 token。

## F. Rollback（非預設動作）

撤權後不預期任何 regression（C 節已證明零 caller）。**不會自動、也不預設回復 anon/authenticated 授權**——那等同把漏洞放回去。
只有在同時滿足：(a) 明確判定有合法 caller 因此 regression，且 (b) 使用者另行批准，才處理；且處理方式優先為「只對被證實需要的那一個 signature、授權那一個被證實需要的角色」，而非整組還原。任何情況都不碰 queue / fact / audit / cron / 函式 body。

## G. 執行順序（核准後）

1. 前置 read-back 基線（signature + md5 + proacl）
2. ACL migration（含 Tier B-readonly DO 斷言）
3. 後置 read-back（E 節 1–4、6）
4. 建立 Tier A / B-readonly / B-write 三個測試檔，刪除舊檔
5. 實跑 Tier A 並回報；B-write 標 PENDING
6. 等修補後第一個自然 job 106，只讀驗證 E-7，出結案報告（含 PENDING 清單）

12:02 / 12:07 那輪在核准前不讀、不觸發。
