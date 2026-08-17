# Plan v8.1 Stage B — v5（admission gate 收斂，仍只 Plan／唯讀）

保留並沿用 v2–v4 已核可內容：classifier 語意、upstream 簽章 sanitize、admin server-side probe、natural cron 證據、holdings coverage 驗收、v4 的唯讀基線與 P-ACL GAP-1，以及「BSR 不會自行恢復新鮮度、需合法／付費 provider」的誠實邊界。

## 本輪新增唯讀證據

- `tw_bsr_sync_queue` ownership 欄位分布：`pending 77` 筆 `correlation_id` **全部非 null 且 77 個各不相同**、`started_at` 全部為 null、`last_error` 全部為 `quota_deferred`；`failed 1572` 筆 correlation_id 亦全非 null、started_at 全 null；`done 9956` 筆僅 3 筆 correlation_id 為 null。
- `claim_bsr_queue_jobs` body（已唯讀取得）**不寫入也不改變 `correlation_id`**，只寫 `status='running', started_at=now(), attempts=attempts+1`。→ **`correlation_id` 是 enqueue-time 標記，不是 worker lease**，v4 的 ownership 條件因此無效。
- `reap_stale_bsr_queue_jobs(_stale_minutes default 60)`：把 `status='running' AND updated_at < now()-60min` 轉回 `pending`、`next_run_at=now()`，並刪過期 `tw_bsr_sync_locks`。→ terminalize 與 reaper 存在競態，必須用 claim 當下的 `started_at` 做 pairwise 比對。
- 其餘 v4 基線（config 欄位、queue 索引、enqueued_by 分布、degrade_events schema、writer ON CONFLICT 行為、Edge enqueue 程式碼）不變。

---

## 1. `recover_quota_failed_bsr_jobs` 納入 Stage B mutation scope（消除每小時噪音）

v4 的「gate 關閉期間每小時 recover 1 筆再 terminalize」不符合驗收（terminal gate 後 admission=0、pending 單調收斂、drain 後零噪音），撤回。

**CREATE OR REPLACE `public.recover_quota_failed_bsr_jobs(p_max int)`**，body 唯一變更是候選條件：

- 一般 quota/rate-limit 語意完全不變：`last_error LIKE 'finmind_admission_%'`（不含 terminal code）與 `last_error='quota_deferred'` 照舊可回收；`reconciled_fact_exists` 分支、budget/pools、cap=1、`max_attempts<8`、logging 全部不動。
- 新增排除條件：`last_error = 'finmind_admission_provider_plan_rejected'` 的列，**只有在** `private_bsr.admission_open()` 為 true（即 `market_batch.config->'admission_blocked'` 是 JSON boolean `false`）時才可入選；gate 為 `true`／key 缺失／型別非 boolean／row 不存在 → **永不入選**（fail-closed）。
- 兩處 candidate CTE（`pick` reconcile 與 `cand` token）皆套用同一條件；`candidates_inspected` 計數同步排除，避免 metrics 誤導。

Mutation 安全程序：

- mutation 前保存 `pg_get_functiondef`、`proowner`、`proacl`、`proconfig`、`obj_description`（存成 artifact 並記 sha256）。
- mutation 後 read-back：除 body 的預期 diff 外，`owner / ACL / proconfig / comment / 參數簽章 / return type` 必須完全相同（逐項 assert）。
- rollback = 以保存的 `pg_get_functiondef` **byte-identical** 還原，並再次 read-back 比對 sha256。

## 2. Recovery 完成條件（clone 實測腳本）

- **Blocked 階段**：gate blocked 後連續執行 3 次 hourly 等價 run（`enqueue_chips_prefetch_gaps()`，內含 `recover_stale_bsr_queue_jobs` 與 `recover_quota_failed_bsr_jobs`）。斷言：terminal failed 列 0 筆轉 pending；`quota_deferred` 計數不增加；`attempts`／`max_attempts` 不變；`audit_logs` 與 `tw_bsr_degrade_events` 無新增；queue 各 status 計數逐 run 相同（pending 單調收斂至 0 後保持 0）。
- **Recovery 階段**：admin server-side probe 成功 → gate explicit `false` → 之後每次 hourly run 至多 1 筆 terminal failed 轉 pending（實測 3 run = 至多 3 筆）→ worker 對該筆實際成功並轉 `done`。
- **再度惡化**：注入 exact terminal evidence → worker 先原子 block gate → 該 job 轉 failed(`finmind_admission_provider_plan_rejected`) → 後續 hourly run 再次 0 筆回收。
- 三階段各附前後 status 分布表與 fingerprint。

## 3. Terminalize 的 exact pairwise ownership

- 不使用 `correlation_id`（已證明非 lease）、不使用集合交叉匹配。
- worker 保留 `claim_bsr_queue_jobs` 回傳的 `(id, started_at, attempts)`，terminalize 語句為：

```text
UPDATE public.tw_bsr_sync_queue q
   SET status='failed', last_error='finmind_admission_provider_plan_rejected',
       finished_at=now(), updated_at=now()
  FROM unnest($1::bigint[], $2::timestamptz[], $3::int[]) AS c(id, started_at, attempts)
 WHERE q.id = c.id
   AND q.status = 'running'
   AND q.started_at IS NOT DISTINCT FROM c.started_at
   AND q.attempts IS NOT DISTINCT FROM c.attempts
```

- 任何被 reaper 搶回 `pending`（started_at 改變或 status 改變）的列都不會被更新；回傳更新列數與 claim 筆數的差額列入 run report。
- clone 測試：(a) correlation_id 為 null 的 job 也能被正確 terminalize；(b) reaper 競態 — claim 後人為把 `updated_at` 推回 61 分鐘並執行 `reap_stale_bsr_queue_jobs()`，再執行 terminalize，斷言該列維持 reaper 的 pending 狀態且 terminalize 更新 0 列、worker 正確回報 lost lease。

## 4. 觀測：選定「service-role-only admission status read」（消除 v4 §6/§7 矛盾）

v4 同時說「blocked count 寫入 refresh log」又說「Edge 不能區分」，矛盾。v5 選擇明確方案 A：

- 新增 narrow public wrapper `public.bsr_admission_status()`：`REVOKE ALL FROM PUBLIC, anon, authenticated`、`GRANT EXECUTE TO service_role`；回傳 `{blocked, reason, blocked_at, version}`（不含 raw upstream body）。
- worker 每 run 開頭呼叫一次；enqueue 前後以 queue rowcount delta 計算本 run 被擋列數，連同 admission status 寫入 HTTP response 與 `data_source_refresh_logs.metadata`（`admission_blocked`、`admission_reason`、`admission_gate_version`、`enqueue_blocked_rows`）。
- 因此 blocked 與 duplicate 由 worker 端明確區分（duplicate 仍為 unique violation error，blocked 為 error=null + delta=0 + gate blocked）。舊 `tw-chips-detail` 與前端不變、不需要讀 gate。
- ACL read-back：列出 wrapper 的 `proacl`、`proconfig`、`provolatile`，並實測 anon/authenticated 呼叫被拒、PostgREST 對 `private_bsr` 不可達。

## 5. 兩座獨立 rehearsal clone

- **B6 與 B7**：各自從 production baseline 全新 restore（0 unexpected/0 expected errors），各自**完整**跑 A1 全流程：apply → §1 function replace read-back → §2 recovery 三階段 → §3 ownership/reaper 競態 → §8(v4) 逐支 writer open/closed row delta、deadlock／statement_timeout → §9(v4) 兩獨立 session barrier 與 fuzz → ACL/owner diff → rollback → 與 baseline 比對 schema/ACL/rowcount/hash。
- 兩座各自產出獨立 artifact 與 sha256（restore log、apply log、test log、fingerprint、functiondef before/after），不共用、不互相引用。

## 6. 最終 mutation scope（完整清單）

**Repo files**
- `supabase/functions/_shared/bsrProviderState.ts`：classifier（terminal / retryable / unknown 之 predicate 與 precedence）＋ `sanitizeUpstreamSignature`。
- `supabase/functions/tw-bsr-finmind-sync/index.ts`：run 開頭讀 `bsr_admission_status()`；terminal 時呼叫 block；pairwise terminalize；run report 欄位；enqueue blocked rows 統計。
- `supabase/functions/tw-bsr-finmind-sync/lib.ts`：以 shared classifier 取代 `isQuotaRejection`。
- admin probe handler（同一 function 內新增 `mode=admin_probe`，company_admin JWT 驗證後 server-side 執行真實 upstream 探測，成功才 unblock）。
- 對應測試檔（Deno）。

**DB（migration）**
- `CREATE SCHEMA private_bsr`；`private_bsr.admission_open()`（VOLATILE、`SET search_path=pg_catalog, private_bsr`、完全限定 `public.*`、無 dynamic SQL）、`private_bsr.block_admission(...)`、`private_bsr.unblock_admission(expected_version, nonce, evidence)`（鎖 row、重讀、idempotent transition）。
- `public.tw_bsr_sync_queue_admission_gate()` trigger function（VOLATILE、SECURITY DEFINER、只擋/放、零業務驗證、gate closed 時 `RETURN NULL` 不 raise）＋ `BEFORE INSERT FOR EACH ROW` trigger。
- `public.bsr_admission_status()` narrow wrapper（service_role only）。
- `CREATE OR REPLACE public.recover_quota_failed_bsr_jobs(int)`（§1，含 before/after functiondef artifact 與 byte-identical rollback）。
- **無 ALTER TABLE、無新 table**（`tw_bsr_sync_config` 已有 config/version；`tw_bsr_degrade_events` 已存在）。

**資料（DML）**
- `market_batch.config` 的 7 個 JSON keys（`admission_blocked`、`admission_reason`、`admission_blocked_at`、`last_blocked_at`、`admission_probe`、`admission_probe_at`、`admission_probe_schema_version`）**只由自然 worker block 與 admin probe unblock 寫入**，無手動 seed、無 bulk DML。
- `tw_bsr_sync_queue`：只有自然 worker 每 run 的 pairwise terminalize，以及既有 recovery 的每 run ≤1 筆轉換。
- `audit_logs` + `tw_bsr_degrade_events`：只在 gate transition（block/unblock）各寫 1 筆；gate closed 不寫 per-row event。

**Production staged deploy（本輪不執行，僅列項）**
1. migration（schema/function/trigger/wrapper/replace）；2. Edge `tw-bsr-finmind-sync` 部署；3. 觀察 3 次自然 cron；4. 需要時 admin probe。

**明確不碰**
- 舊 `tw-chips-detail`（v1/v2）、任何前端檔案、cron schedule、P-ACL GAP-1 的 13 個既有 function 的 owner/ACL、其他 table 的 RLS/GRANT、Publish。

---

驗收通過條件：兩座 clone（B6/B7）各自 all-green，且 §2 三階段行為、§3 競態、§5 fingerprint、§1 rollback byte-identical 全部有獨立 artifact 佐證。production 在本階段 0 touch。
