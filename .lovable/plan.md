# Build 1c — ACL 收斂 + 測試可執行性（最小修正）

範圍只有兩件事：把三個 BSR recovery 函式的執行權限收斂到 service_role，以及把 `supabase/tests/bsr_quota_recovery_test.sql` 拆成「現在真的跑得動」的層次。不動函式 body、Edge Function、cron、queue 資料、degrade/分類邏輯。Build 2 仍不在範圍。

## 已讀取的 production 事實

三函式真實 signature 與 ACL（`pg_proc` 讀出）：

```text
bsr_backlog_metrics()                  proacl: postgres=X, anon=X, authenticated=X, service_role=X, sandbox_exec_*=X
bsr_recovery_budget(p_full_budget integer)      同上
recover_quota_failed_bsr_jobs(p_max integer)    同上
enqueue_chips_prefetch_gaps(integer,integer)    proacl: postgres=X, service_role=X, sandbox_exec_*=X   <-- 已無 anon/authenticated
```

三者皆 `SECURITY DEFINER` + `search_path=public`。`information_schema.routine_privileges` 對這三個回 0 列（受限連線視角看不到），所以判讀必須以 `pg_proc.proacl` + `has_function_privilege()` 為準。

FAIL 的根因（已證實，不是猜測）：`pg_default_acl` 內有
`supabase_admin / public / f → {postgres=X, anon=X, authenticated=X, service_role=X}`。
每次 `CREATE OR REPLACE FUNCTION` 都會由這條 default privilege 產生 anon/authenticated 的**顯式** ACL 條目。既有 migration 只寫了 `REVOKE ALL ... FROM PUBLIC`，PUBLIC 條目本來就不存在，所以等於 no-op，anon/authenticated 的顯式授權完全沒被撤。`enqueue_chips_prefetch_gaps` 沒有這兩者，證明「逐 signature REVOKE」確實有效且不會破壞 cron。

## 1. Migration（唯一一段 SQL）

只針對三個 exact signature，不碰全域 `ALTER DEFAULT PRIVILEGES`（那條是 supabase_admin 擁有、影響 public schema 內所有函式，超出本次範圍且不可安全回滾）：

```sql
REVOKE ALL ON FUNCTION public.bsr_backlog_metrics()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bsr_recovery_budget(integer)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bsr_backlog_metrics()                  TO service_role;
GRANT EXECUTE ON FUNCTION public.bsr_recovery_budget(integer)           TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) TO service_role;
```

沒有 `CREATE OR REPLACE`、沒有新表/欄位/index/cron/config。因為未來若再 replace 這三個函式，default ACL 會重新灌回 anon/authenticated，所以同一份 migration 尾端加註解，要求任何後續 replace 必須把上述 REVOKE 一起帶上。

## 2. 撤權為何不會造成 regression

- 呼叫鏈全數清點（`rg` 掃 `src/`、`supabase/`、`scripts/`）：這三個函式在應用層**沒有任何 caller**——沒有 `supabase.rpc(...)`、沒有 Edge Function 呼叫、沒有前端引用。出現處只有 migrations 本身與 `supabase/tests/bsr_quota_recovery_test.sql`。
- 唯一 production 呼叫路徑是 cron job 106 → `public.enqueue_chips_prefetch_gaps(10, 300)`（直接 SQL，非 pg_net），其內部再呼叫 `recover_quota_failed_bsr_jobs` → `bsr_recovery_budget` → `bsr_backlog_metrics`。
- job 106 由 pg_cron 以 postgres 身分執行；`enqueue_chips_prefetch_gaps` 是 SECURITY DEFINER、owner 為 postgres，函式體內的呼叫一律以 owner 權限求值。postgres 對三者都保有 `X`，因此撤掉 anon/authenticated 對這條鏈完全無影響。
- `enqueue_chips_prefetch_gaps` 本身早已沒有 anon/authenticated 執行權，且 job 106 每小時正常跑完，這就是同一模式的現成反證樣本。

## 3. Read-back acceptance（migration 後立即執行，唯讀）

1. `pg_get_function_identity_arguments` 逐一確認三個 signature 未變（`()`、`p_full_budget integer`、`p_max integer`）。
2. `pg_proc.proacl` 讀回：不得出現 `anon=`、`authenticated=`；必須留 `service_role=X`。
3. `has_function_privilege()` 矩陣，四個 grantee × 三個函式：
   - `anon` / `authenticated` / `public` → 必須 `false`
   - `service_role` → 必須 `true`
4. 正向行為檢查：以 service_role 連線僅呼叫 **read-only** 的 `bsr_backlog_metrics()` 與 `bsr_recovery_budget(12)`，確認回傳 jsonb 且 key 契約完整。
5. `recover_quota_failed_bsr_jobs` **禁止手動呼叫**，write path 只採信自然 job 106 的 audit 列。

## 4. 測試分層（誠實可執行）

現況：sandbox 的 `sandbox_exec` 角色雖然 proacl 裡有 `X`，但受限連線本來就不允許執行 DB 函式（`permission denied for function ...`），所以原檔第 3/4/5 段在此環境永遠跑不動。把單一檔案拆成三層：

- **Tier A — `supabase/tests/bsr_acl_metadata_test.sql`（純 catalog，受限連線可跑）**
  只查 `pg_proc`（volatility / prosecdef / proconfig / proacl）與 `has_function_privilege()`。不呼叫任何函式，因此在目前 sandbox 就能執行並得出真 PASS/FAIL。這一層涵蓋原檔第 1、2 段以及本次 ACL 驗收。
- **Tier B — `supabase/tests/bsr_quota_recovery_behavior_test.sql`（行為層，需 service_role/管理連線）**
  保留原檔第 3、4 段（metrics JSON 契約、budget gates），第 5 段（recover 寫入）改包在 `BEGIN; ... ROLLBACK;` 內，並在檔頭加 `\if` 守門：若 `has_function_privilege(current_user, ..., 'EXECUTE')` 為 false 就 `\echo SKIPPED (insufficient role)` 並以非 0 標記為 **pending**，不得印 PASS。此層在 CI（ephemeral、service_role/postgres 連線）執行。
- **Tier C — production write path**
  只由自然 job 106 的 `data_source_refresh_logs(source_key='bsr_quota_recovery')` 證明，不手動呼叫。

原 `bsr_quota_recovery_test.sql` 由 Tier A + Tier B 取代（內容搬移，不改斷言語意）。

**明確 pending gate**：在目前 sandbox 只能得到 Tier A 的真 PASS。Tier B 在拿到 service_role/管理連線（或 CI job 接上）之前一律標示 `PENDING`，不得計為 PASS；Build 1c 的結案報告會分開列 Tier A PASS / Tier B PENDING / Tier C 自然證據。

## 5. Regression 防線

- migration 前後對三個函式取 `md5(pg_get_functiondef(oid))`，必須逐一相同（現值：metrics `a419d519…`、budget `eb9ee387…`、recover `8a50211b…`）。
- 不新增表、view、endpoint、config、cron；Edge Function 不需重新部署。
- 下一個自然 job 106：仍恰好 1 筆 audit、duration ≤ 30s、最多 1 reconcile / 1 token。此為結案條件之一，read-only 蒐證。

## 6. Rollback

只還原 ACL：

```sql
GRANT EXECUTE ON FUNCTION public.bsr_backlog_metrics()                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bsr_recovery_budget(integer)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_quota_failed_bsr_jobs(integer) TO anon, authenticated;
```

不碰 queue / fact / audit / cron / 函式定義。

## 7. 執行順序

1. 前置 read-back（signature + md5 + proacl 基線）
2. ACL migration
3. 後置 read-back（第 3 節五項）
4. 測試分層重構（Tier A / Tier B 檔案）
5. 跑 Tier A，回報 PASS；Tier B 標 PENDING
6. 等下一個自然 job 106，只讀驗證第 5 節三條，結案

12:02 / 12:07 那輪在核准前不讀不觸發。
