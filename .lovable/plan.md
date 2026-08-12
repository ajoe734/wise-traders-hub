# Build 1f Final Plan v4 — token slot 公平性（DB 保證最多 1 + Edge 穩定分區）

Build 2 仍未授權。本計畫只涵蓋 claim 層公平性 + worker processing-first，不含 lane A/B、不含 freshness。

## 0. Read-only 已確認事實（本輪重查）

- `claim_bsr_queue_jobs(_batch integer, _max_priority integer)` production actual md5(pg_get_functiondef) = **`bf25e3deaefe24ee761e95e2e6d75391`**。此為全文唯一有效舊值；先前文件出現的 `938a714b…` 與 `9b12fcc4…` 皆作廢，不再引用。
- `is_tw_trading_hours()` production actual md5 = **`9da38e982089a7da7364219dc5816d2f`**（STABLE SQL、`search_path=public`、非 SECDEF）。
- `tw_bsr_sync_queue` relation 既有 pinned sha256（Build 1e baseline 第 rel 行，逐字沿用）= **`f7358406623859b24d3ce6895f965d140cc5f88f92a787676e1dedf556a2d0dd`**。
- repo migrations 最大檔名為 `20260812114447_…`。
- Edge 測試慣例：`supabase/functions/tw-bsr-finmind-sync/*_test.ts`（已存在 `lib_test.ts`、`queue_simulator_test.ts` 等），以 `deno test --allow-env --no-check <file>` 執行，純函式、不連 DB。

## 1. 為什麼 DB ORDER BY 不能當唯一保證

`claim_bsr_queue_jobs` 回傳 `SETOF tw_bsr_sync_queue`，PostgREST 以外層 `SELECT * FROM rpc(...)` 呼叫；呼叫端沒有 outer ORDER BY，函式內 final ORDER BY 不是契約。而 worker 的處理順序確實決定 liveness（read-only 引用 `supabase/functions/tw-bsr-finmind-sync/index.ts`）：

- L523-525 `supa.rpc('claim_bsr_queue_jobs', …)` → `jobs`
- L550-556 `let idx = 0; while (idx < jobs.length) { if (Date.now()-started > budgetMs) return; if (rateLimitedStop) return; const job = jobs[idx++]; … }`
- L648 `Promise.all(Array.from({ length: Math.min(cappedConcurrency, jobs.length) }, worker))`（N 條 worker 共用同一 idx 游標）

超時或 rateLimitedStop 時尾端 job 直接被丟下，因此必須在 TS 端建立可執行契約。

**分工**：DB migration 負責「eligible token 最多 1 + 其餘 normal」；SQL final ORDER BY 僅作 defense-in-depth；processing-first 的唯一保證來自 Edge 端穩定分區。

## 2. Edge 修改（唯一 Edge 變更，且只改這一支）

新增純函式到 `supabase/functions/tw-bsr-finmind-sync/lib.ts`（與既有 `decideQuotaDeferral` 同區塊，跟隨現有 export 慣例）：

```ts
export const QUOTA_RECOVERY_TOKEN = 'quota_recovery_token';

/** 穩定分區：token 在前、非 token 相對順序不變。DB 已保證最多 1 個 token。 */
export function partitionTokenFirst<T extends { last_error?: string | null }>(jobs: T[]): T[] {
  const tokens: T[] = [];
  const rest: T[] = [];
  for (const j of jobs) (j.last_error === QUOTA_RECOVERY_TOKEN ? tokens : rest).push(j);
  return [...tokens, ...rest];
}
```

`index.ts` 修改位置：在 L526 的 `claim_failed` 檢查與 L527 的空集合檢查之後、L537 `jobOutcomes` 宣告之前，插入一行

```ts
const orderedJobs = partitionTokenFirst(jobs as Array<Record<string, any>>);
```

並將 L552-556 共享 idx 迴圈與 L648 `Math.min(cappedConcurrency, jobs.length)` 的 `jobs` 全數改為 `orderedJobs`（`jobs.length === 0` 早退路徑不變）。同時在 worker 回應 body 追加 `token_first: orderedJobs[0]?.last_error === QUOTA_RECOVERY_TOKEN` 與 `claimed_ids: orderedJobs.map(j => j.id)`，供自然稽核比對。

Focused Deno test：新檔 `supabase/functions/tw-bsr-finmind-sync/token_partition_test.ts`
- P1：token 在陣列尾端 → 回傳第一筆是 token。
- P2：非 token 相對順序逐一 assert 不變（含 priority 交錯的 6 筆固定 fixture，無隨機）。
- P3：0 個 token / 空陣列 → 原陣列內容順序不變。
- P4：即使輸入含 2 個 token（防禦性），仍全部排在前面且不丟失元素。
- P5（早停等價）：以 `budget=1` 模擬只處理第一筆的取件語意（純函式模擬 idx 迴圈，註解逐字引用 index.ts L550-556 行號），assert 被處理的唯一 job 是 token。

## 3. Migration（唯一 SQL 變更）

檔名 `supabase/migrations/20260812211500_bsr_claim_token_slot.sql`：大於 repo actual max `20260812114447`，格式為 14 位 UTC timestamp + snake_case 描述，符合專案慣例（既有檔案多為工具產生的 uuid 後綴，人工命名不違反排序語意），無碰撞。

```sql
CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(_batch integer DEFAULT 20, _max_priority integer DEFAULT 3)
RETURNS SETOF tw_bsr_sync_queue
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  in_hours boolean := public.is_tw_trading_hours();
BEGIN
  RETURN QUERY
  WITH token_slot AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending' AND priority <= _max_priority
      AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error = 'quota_recovery_token'
    ORDER BY next_run_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(1, GREATEST(_batch, 0))
  ),
  normal AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending' AND priority <= _max_priority
      AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error IS DISTINCT FROM 'quota_recovery_token'
    ORDER BY priority ASC, next_run_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(_batch - (SELECT count(*) FROM token_slot), 0)
  ),
  picked AS (
    SELECT id, 0 AS bucket FROM token_slot
    UNION ALL
    SELECT id, 1 AS bucket FROM normal
  ),
  updated AS (
    UPDATE public.tw_bsr_sync_queue q
    SET status = 'running', started_at = now(), attempts = q.attempts + 1
    FROM picked WHERE q.id = picked.id
    RETURNING q.*
  )
  SELECT u.* FROM updated u
  JOIN picked p ON p.id = u.id
  ORDER BY p.bucket ASC, u.priority ASC, u.next_run_at ASC, u.id ASC;
END; $function$;
```

- `normal` 以 `IS DISTINCT FROM`（NULL-safe）排除**所有** token 列 → 每次 invocation 最多 1 token。
- `_batch <= 0` → 空集合。
- 併發：`FOR UPDATE SKIP LOCKED` 下不同 worker 可拿到不同 token，但同一 id 絕不重複。
- 屬性逐字保留 production actual：`SECURITY INVOKER`、`search_path=public`、owner `postgres`；**不新增也不撤銷任何 GRANT**（Build 1c ACL 收斂原樣保留）。
- 不動 `cron_edge_call`、cron 排程、queue 資料、degrade/budget/metrics 函式 body。

## 4. Build 1f 獨立 pinned fixture（Build 1e baseline 逐字不變）

- `supabase/tests/fixtures/bsr_slice_expected.tsv`（9 fn + 12 rel）**完全不改**，closure 不擴寫為 11+12。
- 新增獨立檔 `supabase/tests/fixtures/bsr_claim_expected.tsv`，在本計畫批准時即固定下列 3 行，執行階段 generator **只能 compare，絕不寫入／更新**：
  - `fn claim_bsr_queue_jobs old_md5=bf25e3deaefe24ee761e95e2e6d75391`（migration 前必須相符，否則 abort）
  - `fn is_tw_trading_hours md5=9da38e982089a7da7364219dc5816d2f`（production actual，全程不得變動）
  - `rel tw_bsr_sync_queue sha256=f7358406623859b24d3ce6895f965d140cc5f88f92a787676e1dedf556a2d0dd`（沿用 Build 1e pinned 值）
  - `fn claim_bsr_queue_jobs new_canonical_md5=<TBD-AT-APPROVAL>`：新定義的 canonical md5 由本計畫第 3 節 SQL 逐字在 ephemeral cluster 上 `CREATE OR REPLACE` 後計算，於**批准前**由我在此填入固定值；執行階段只比對，不回寫。若 production 套用後 md5 與此值不符即 FAIL。
- **順序強制**：local ephemeral test 全綠 → 才允許 production migration → 才允許 deploy Edge。任一步不綠即停。

## 5. 本機測試如何真的跑得起來

SQL 測試新檔 `supabase/tests/bsr_claim_token_slot_test.sql`，由既有 `scripts/ephemeral-pg.sh test` 的 `psql_run -f` 清單載入（與 `bsr_recovery_write_test.sql` 相同方式）。依賴載入不動 Build 1e slice：測試檔開頭以自帶的 minimal DDL 在 ephemeral cluster 建立 `tw_bsr_sync_queue`（欄位形狀取自 pinned sha256 對應 schema）與 `claim_bsr_queue_jobs`、`is_tw_trading_hours` 定義，全部來自本計畫固定文本，不從 production 生成。

- **T1 分區（SQL 層 defense-in-depth）**：1 token（id 最大、priority 2）+ 5 normal → 第一列為 token，其餘順序等於舊排序。
- **T2 最多 1 token**：放 3 token → 回傳恰 1 token，總數 = `_batch`。
- **T3 邊界**：`_batch=1` 只回 token；`_batch=0` 回 0 列；無 token 時逐列等同舊版。
- **T4 併發**：harness 起第二個背景 psql session（沿用 Case C 既有 background-session 寫法），兩 session 取得的 id 集合互斥、同 token id 不重覆；兩 session 的 exit code 皆以 `wait $pid` 取回並併入 `TEST_EXIT`。
- **T5 兩個 trading-window 分支，皆必跑、不得 skip**：在 ephemeral（非 production）以同簽章 shadow 覆寫達成 deterministic——測試 schema `bsr_t5` 置於 `search_path` 前，於其中定義 `bsr_t5.is_tw_trading_hours() RETURNS boolean IMMUTABLE AS $$ SELECT true $$`，並以 `SET LOCAL search_path = bsr_t5, public` 執行一次；再以回傳 false 的版本執行一次。兩分支各自 assert `post_close_only=true` 列的可見性。測試結尾以計數器 assert「兩分支都已執行」，任一未跑則 `TEST_EXIT` 非 0。

**Deterministic negative controls（必然失敗，非機率性）**：
- N1：把 TS `partitionTokenFirst` 換成反轉版（`[...rest, ...tokens]`）→ P1/P5 必然 FAIL。
- N2：SQL final `ORDER BY p.bucket DESC` → T1 必然 FAIL。
- N3：`normal` 改回不排除 token（移除 `IS DISTINCT FROM` 條件）→ T2 必然 FAIL（回傳 >1 token）。
以上三個變體由 harness 的 `--drift-control claim-order|claim-partition|claim-dedupe` 明確載入，fixture 皆為固定 id，無隨機成分。

## 6. Scope 與驗收（Edge 變更的額外門檻）

- 執行順序：local ephemeral SQL tests + `deno check` + focused Deno test（`deno test --allow-env --no-check supabase/functions/tw-bsr-finmind-sync/token_partition_test.ts` 與既有 `lib_test.ts` 回歸）→ 全綠 → production migration → **只部署 `tw-bsr-finmind-sync`**，不得順帶部署或修改其他 Edge Function。
- 部署後 read-back 證明：
  - `claim_bsr_queue_jobs` md5 = 第 4 節 pinned new canonical 值；
  - 其他 8 個 Build 1e closure 函式 md5 與 21 行 baseline 逐字相同；
  - `is_tw_trading_hours` md5 仍為 `9da38e98…`；
  - cron 清單（`admin_list_cron_jobs`）與 job 106/107 的 schedule/command 與變更前逐字相同；
  - Edge 端只有 `tw-bsr-finmind-sync` 有新版本。

## 7. Rollback

- SQL：以 md5 `bf25e3deaefe24ee761e95e2e6d75391` 對應的舊定義（`picked` 單一 CTE 版本，內容已於本輪 read-only 取得並存為回滾腳本文本）`CREATE OR REPLACE` 還原；不觸及 GRANT。
- Edge：pre-change 版本以部署前記錄的 `git` 工作樹內容與 `index.ts`/`lib.ts` 檔案 sha256 為準（部署前一併記錄於驗收紀錄），回退方式為還原這兩個檔案並重新只部署 `tw-bsr-finmind-sync`。

## 8. Gate（不放寬）

**A. Open-window liveness — 需連續 3 輪，每輪皆須：**
1. :02 recovery 發出 `tokened_job_id`（audit log 恰 1 筆）；
2. 其後的自然 :07 job107 回應中 `jobs[]`／`claimed_ids` 含該 id，且 `token_first = true`、該 id 為第一筆；
3. 該筆 per-job `rows_written > 0`；
4. 對應 `tw_chip_fact` 有相符的 delta（該 stock_id + trade_date 新增列）。
「有明確 outcome」不計入 liveness。

**B. Exhausted-window safety — 需至少 3 輪 future 自然輪次，每輪：** job107 HTTP 200、`jobs_quota_deferred > 0`、`rows_written = 0`、無非預期寫入。

A 或 B 任一不足 → PENDING，不得宣告完成。全程不手動觸發 worker、不改 cron、不 Publish。

**獨立 FAIL（不在本 gate）**：全市場 freshness（最新交易日覆蓋 3.1%）仍為 Build 2 範圍，Build 2 未授權。

**cron_edge_call caveat 保留**：不修改 `cron_edge_call`（61/72 cron 共用，全域故障點）；稽核關聯以分鐘 :07 唯一 dispatch（cardinality=1）時間對齊為 best-effort，證據等級 UNKNOWN，不作 gate 條件。

## 9. Material modified files（完整清單）

1. `supabase/migrations/20260812211500_bsr_claim_token_slot.sql`（新增）
2. `supabase/functions/tw-bsr-finmind-sync/lib.ts`（新增 2 個 export）
3. `supabase/functions/tw-bsr-finmind-sync/index.ts`（分區插入 + `orderedJobs` 取代 + 回應欄位）
4. `supabase/functions/tw-bsr-finmind-sync/token_partition_test.ts`（新增）
5. `supabase/tests/bsr_claim_token_slot_test.sql`（新增）
6. `supabase/tests/fixtures/bsr_claim_expected.tsv`（新增，pinned，執行階段唯讀）
7. `scripts/ephemeral-pg.sh`（新增 test 檔載入 + 3 個 `--drift-control` 變體 + T4 背景 session）
8. 回滾腳本文本（保存於驗收紀錄，不進 repo）

**不改**：`supabase/tests/fixtures/bsr_slice_expected.tsv`、`scripts/bsr-slice-verify.sh`、`scripts/gen-bsr-slice-fixture.sh`、其他任何 Edge Function、cron、queue 資料、ACL。
