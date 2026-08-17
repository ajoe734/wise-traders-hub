# Plan v8.1 Stage B — v6（admission gate 收斂，仍只 Plan／唯讀）

v5 全部內容保留（classifier／sanitize、recover_quota_failed_bsr_jobs 的 gate-aware CREATE OR REPLACE 與 byte-identical rollback、recovery 三階段實測、pairwise ownership、兩座獨立 clone、P-ACL GAP-1、production 0 touch）。v6 只修兩個 implementation blocker，並把新 wrapper 併入 scope。

## 本輪新增唯讀證據

- `supabase/functions/tw-bsr-finmind-sync/index.ts` 內**沒有任何** `data_source_refresh_logs` 寫入點（rg 0 命中）；近 7 天該表的 source_key 只有 `backfill_worker`、`bsr_quota_recovery`、`tw_keep_warm`、`tw_trading_calendar_catchup`、`backfill_gap_orchestrator`（`bsr_quota_recovery` 由 DB function 寫，非本 worker）。
- Edge enqueue 現行寫法為 `insert(chunk, { count: 'exact' })`，先以 select 過濾 pending/running 既有列，無 ON CONFLICT（`index.ts:377-392`）。
- 其餘 v4/v5 唯讀基線（config/queue schema、claim body 不寫 correlation_id、reaper 語意、writer ON CONFLICT、degrade_events schema）不變。

---

## 1. 三支 public service-role-only wrapper（唯一可達路徑）

`private_bsr` 不在 PostgREST exposed schemas，Edge 一律**不**直呼 private function。private implementation 保留為內部細節，只由 wrapper 呼叫。

### 1.1 `public.bsr_block_and_terminalize_claims(p_run_id uuid, p_claim_ids bigint[], p_claim_started_at timestamptz[], p_claim_attempts int[], p_terminal_code text, p_sanitized_evidence jsonb)`

單一 transaction 內依序：

1. `SELECT ... FROM public.tw_bsr_sync_config WHERE key='market_batch' FOR UPDATE`（linearization point：取得 lock 後讀到的 version/state；外部可見切點為本 transaction commit）。
2. idempotent block：已 blocked → 視為成功（回 `already_blocked`，必要時補寫缺漏 evidence）；仍 open → 依重讀後的 current version 寫入 `admission_blocked=true` 等 7 個 JSON keys。row 不存在或 config 非 object → RAISE（worker 不得假裝已關 gate）。
3. pairwise terminalize（v5 §3 的 `unnest(...) IS NOT DISTINCT FROM` 語句），只更新 `status='running'` 且 `started_at`/`attempts` 與 claim 當下相同的 exact ids。
4. 寫 1 筆 `public.audit_logs` + 1 筆 `public.tw_bsr_degrade_events`（gate transition；已 blocked 的 idempotent 呼叫不重複寫 event）。
5. 回傳 `{ gate_version, transition: blocked|already_blocked, updated_count, lost_lease_count, claim_count }`。

輸入驗證：三個陣列**等長**（不等長 RAISE）、長度上限 500、`p_terminal_code` 僅允許 allowlist（目前只有 `finmind_admission_provider_plan_rejected`）、`p_sanitized_evidence` 必須是 object 且不得含 `token`/`url`/`authorization` 等 key（含則 RAISE，避免 raw upstream body 落地）。

### 1.2 `public.bsr_unblock_after_probe(p_expected_version int, p_nonce text, p_sanitized_evidence jsonb, p_verified_actor uuid)`

- 由 Edge 的 admin probe 路徑呼叫；Edge 先在 code 內驗證 JWT 為 `company_admin`，再以 service_role 呼叫本 wrapper，並傳入已驗證的 actor id（wrapper 不信任其為授權依據，只作 audit 記錄；授權由 EXECUTE ACL = service_role only 保證）。
- 鎖 gate row → 重讀 → 檢查 `p_expected_version` 與 `p_nonce` 與 probe 開始時記錄一致（不符回 `stale_probe`，零寫入）→ evidence schema 驗證（`admission_probe_schema_version=1`、必要欄位齊全、無敏感 key）→ 原子寫入 `admission_blocked=false, admission_reason=null, last_blocked_at=<原 blocked_at>, admission_blocked_at=null, admission_probe=<evidence>, admission_probe_at=now()`；寫 audit + degrade event。
- 回傳 `{ transition: unblocked|already_open|stale_probe, gate_version }`。

### 1.3 `public.bsr_admission_status()`

read-only，回 `{ blocked, reason, blocked_at, version }`，不含 raw upstream body。

### 三支共同要求

- `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`
- `SECURITY DEFINER`、`SET search_path = pg_catalog, private_bsr`（不含 public 且 public 不在前）、body 完全限定 `public.*`、禁止 dynamic SQL、VOLATILE。
- 建立後 read-back：`proname/prosecdef/provolatile/proconfig/proacl/proowner` 全列出。
- clone 驗證可達性：以真實 supabase-js（service_role key）對 PostgREST 呼叫三支 rpc 成功；以 anon key 與 authenticated JWT 呼叫皆得 403 / `permission denied for function`；並驗證 `private_bsr.*` 經 PostgREST 不可達（404 schema not exposed）。

## 2. `enqueue_blocked_rows` 改用 per-chunk count（不用全表 delta）

- 每個 chunk：`filtered_candidate_count - inserted_count = blocked_count`，**僅當**該 run 的 `bsr_admission_status()` 明確 `blocked=true` 且該次 insert `error === null` 時採計。
- `error !== null`（含 unique violation）→ 該 chunk 記為 `unknown`／`error`，不硬算 blocked。
- 跨 chunk 相加後寫入 HTTP response：`{ admission: { blocked, reason, version }, enqueue: { candidates, inserted, blocked, unknown, error_chunks } }`。
- **持久化誠實邊界**：`tw-bsr-finmind-sync` 目前沒有 `data_source_refresh_logs` 寫入點（唯讀證據如上）。v6 **不新增**該表寫入，blocked 統計只出現在 HTTP response 與 Edge log；gate transition 的持久化證據由 `audit_logs` + `tw_bsr_degrade_events`（wrapper 內寫）提供。
- clone 測試：worker enqueue 進行中，另一獨立 session 併發插入無關列，斷言 per-chunk 統計不受污染（與全表 delta 算法對照，證明後者會誤報）。

## 3. 最終 mutation scope（在 v5 §6 上補齊）

**Repo files**：`_shared/bsrProviderState.ts`（classifier + sanitizer）、`tw-bsr-finmind-sync/index.ts`（run 開頭讀 `bsr_admission_status()`、terminal 時呼叫 `bsr_block_and_terminalize_claims`、per-chunk blocked 統計、run report）、`tw-bsr-finmind-sync/lib.ts`（改用 shared classifier）、admin probe handler（company_admin JWT 驗證 → server-side 真實探測 → `bsr_unblock_after_probe`）、對應 Deno 測試。

**DB（migration）**
- `CREATE SCHEMA private_bsr` + `private_bsr.admission_open()/block_admission()/unblock_admission()`（內部用，不對外 GRANT）。
- **新增三支 public wrapper**：`bsr_block_and_terminalize_claims`、`bsr_unblock_after_probe`、`bsr_admission_status`（ACL/search_path/驗證如 §1）。
- `public.tw_bsr_sync_queue_admission_gate()` + `BEFORE INSERT FOR EACH ROW` trigger（只擋/放、零業務驗證、closed 時 `RETURN NULL` 不 raise）。
- `CREATE OR REPLACE public.recover_quota_failed_bsr_jobs(int)`（gate-aware 候選條件，before/after functiondef artifact，byte-identical rollback）。
- 無 ALTER TABLE、無新 table。

**DML**：`market_batch.config` 7 個 JSON keys 只由 worker block／admin probe unblock 寫入；queue 只有自然 worker pairwise terminalize 與既有 recovery 每 run ≤1 筆；audit_logs／degrade_events 只在 gate transition 各 1 筆。

**Rollback**：`DROP FUNCTION` 三支 wrapper、trigger + gate function、`DROP SCHEMA private_bsr CASCADE`、以保存的 functiondef byte-identical 還原 `recover_quota_failed_bsr_jobs`；再跑 18 個 queue-touching function 的 `proowner/proacl/proconfig` diff（要求 0 差異）與全表 fingerprint。

**明確不碰**：舊 `tw-chips-detail`（v1/v2）、前端、cron schedule、P-ACL GAP-1 的既有 function ACL、其他 table 的 RLS/GRANT、Publish。

## 4. 兩座 clone（B6 / B7）驗收增列

各自從 baseline 全新 restore、完整跑：apply → wrapper ACL/可達性（service_role 成功、anon/authenticated 403、private schema 404）→ §2 per-chunk 併發污染測試 → v5 §2 recovery 三階段 → v5 §3 ownership/reaper 競態 → 逐支 writer open/closed row delta、deadlock/statement_timeout → 兩獨立 session barrier 與 fuzz → owner/ACL diff → rollback → fingerprint。各自獨立 artifact 與 sha256，不共用。

production 本階段 0 touch。
