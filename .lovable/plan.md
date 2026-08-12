# Build 1f Final Plan v3 — token slot 公平性（含回傳順序保證）

Build 2 仍未授權。本計畫只涵蓋 claim 層公平性與其測試。

## 1. Source 證據：回傳順序確實影響 liveness（v2 的缺口成立）

read-only 引用 `supabase/functions/tw-bsr-finmind-sync/index.ts`：

- L523-525：`const { data: jobs } = await supa.rpc('claim_bsr_queue_jobs', { _batch, _max_priority })`。
- L550-556：
  ```text
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      if (Date.now() - started > budgetMs) return;   // L553 超時 → 直接 return
      if (rateLimitedStop) return;                    // L554 rate limit → 直接 return
      const my = idx++;                               // 依 jobs 陣列索引順序取件
      const job = jobs[my];
  ```
- L648：`await Promise.all(Array.from({ length: Math.min(cappedConcurrency, jobs.length) }, worker))` — N 條 worker 共享同一個 `idx` 游標，仍是**依 jobs 陣列順序**發配。
- L964：`budgetMs = clamp(body.budget_ms ?? 45_000, 5_000, 120_000)`。

結論：超時或 rateLimitedStop 時，**尚未被取走的尾端 job 直接被丟下**（它們已在 DB 標成 `running`，只能等 stuck reclaim）。因此若 token job 因 `UPDATE ... RETURNING` 的偶然順序落在陣列尾端，本輪可能完全不被 process。所以「只保留 claim slot」確實可能假綠 → 採用第 2 點的 data-modifying CTE，不走第 3 點例外。

## 2. Final SQL（唯一 migration）

檔案路徑固定為（現有最大 timestamp 為 `20260812114447_…`，無碰撞）：

`supabase/migrations/20260812211500_bsr_claim_token_slot.sql`

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
    SELECT id, 0 AS bucket, 0::bigint AS ord FROM token_slot
    UNION ALL
    SELECT id, 1 AS bucket, row_number() OVER (ORDER BY id) FROM normal
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

要點：
- `normal` 明確排除**所有** recovery-token 列（`IS DISTINCT FROM`，NULL-safe），不只排除已選中的那筆 → 一次最多 1 個 token。
- `_batch <= 0` 時 token 與 normal 皆 LIMIT 0，回傳空集合。
- 最終 `ORDER BY p.bucket` 保證 token 是 jobs[0]；normal 段維持原本 `priority, next_run_at, id` 排序（`ord` 僅為 picked 完整性，排序以欄位值為準，行為與現況一致）。
- 併發：兩個 worker 因 `FOR UPDATE SKIP LOCKED` 可各拿到**不同** token，但絕不會拿到同一 id。
- ACL / 屬性逐字保留 production actual：`SECURITY INVOKER`、`search_path=public`、owner `postgres`、不新增也不撤銷任何 GRANT（Build 1c ACL 收斂完全不動）。
- 不動 Edge Function、cron、queue 資料、degrade/budget/metrics 函式 body。

## 3. `cron_edge_call` 關聯性（維持 v2 caveat）

不修改 `cron_edge_call`（61/72 cron job 共用，屬全域故障點）。稽核關聯改以「分鐘 :07 唯一 dispatch，cardinality=1」時間對齊為 best-effort，證據等級標記 UNKNOWN，不列為 gate 條件。

## 4. 本機測試如何真的跑得起來

依賴載入（實測既有 harness，不新增框架）：

1. `claim_bsr_queue_jobs` 與 `is_tw_trading_hours` **目前不在** Build 1e 的 21 行 baseline（9 fn + 12 rel）內。本計畫將 baseline 擴為 **11 functions + 12 relations**：原 21 行逐字不變，只追加
   - `fn claim_bsr_queue_jobs`（新版本 md5，migration 套用後由 generator 產生後人工核可）
   - `fn is_tw_trading_hours`
   `tw_bsr_sync_queue`（含 `trg_tw_bsr_sync_queue_updated`）已在 relation 清單中，不需追加。
2. 流程沿用既有指令，逐步：
   ```text
   bash scripts/gen-bsr-slice-fixture.sh        # read-only 產生 slice（drift gate）
   bash scripts/ephemeral-pg.sh up-slice
   bash scripts/ephemeral-pg.sh load-slice
   bash scripts/ephemeral-pg.sh verify          # 含 compile gate
   bash scripts/ephemeral-pg.sh test
   bash scripts/ephemeral-pg.sh test --negative-control
   bash scripts/ephemeral-pg.sh down
   ```
3. `is_tw_trading_hours` 為 STABLE SQL 且相依 `now()`；測試以固定 `SET LOCAL TIME ZONE` 無法改變 now()，因此 T1–T3 一律在 `post_close_only = false` 的 fixture 列上執行，使 in_hours 分支不影響結果；另設 T5 專測 `post_close_only = true` 且模擬盤中（以測試內直接呼叫 `is_tw_trading_hours()` 取現值後 skip-or-assert，避免時間相依假綠）。
4. 新測試檔 `supabase/tests/bsr_claim_token_slot_test.sql`，由 `scripts/ephemeral-pg.sh test` 的既有 `psql_run -f` 清單載入（與 `bsr_recovery_write_test.sql` 相同方式）。

測試案例：
- **T1 順序**：queue 內含 1 個 token（id 較大、priority 2）+ 5 個 normal（priority 1/2、id 較小）。assert 回傳的**第一列**是 token id，其餘 5 列順序等於舊排序。
- **T2 最多 1 token**：放 3 個 token，assert 回傳恰 1 個 token、其餘皆 normal，總數 = `_batch`。
- **T3 邊界**：`_batch = 1` 只回 token；`_batch = 0` 回 0 列；無 token 時行為與舊版逐列相同。
- **T4 併發**：由 harness 起第二個背景 psql session（沿用 Case C 既有的 background-session 寫法：背景 session 以 `psql -f` 開 transaction 並 `pg_sleep` 持鎖，前景 session 呼叫 claim），assert 兩 session 取得的 id 集合互斥、同一 token id 不會出現兩次；兩個 session 的 exit code 都以 `wait $pid` 取回並納入 `TEST_EXIT`。
- **T5 in_hours 分支**：如上第 3 點。
- **Negative control（必須偵測得到）**：drift-control 追加 `--drift-control claim-order`，把載入的函式改成刪除最後 `ORDER BY p.bucket ASC` 的版本並把 token 的 id 設為最大值 + priority 最低，使去除排序後 token 幾乎必然落在尾端 → T1 必須 FAIL。fixture 不使用可能偶然通過的隨機 id。
- **Worker 早停等價測試**：以低 budget 的 source-level 等價測試取代跑真實 Edge Function —— 於 T1 之後，用 SQL 模擬 `budgetMs` 只夠處理 1 筆的情境（只取回傳第 1 列視為「本輪唯一被 process 的 job」），assert 該列即 token。此對應 index.ts L550-556 的取件語意，並在測試註解中逐字引用該段程式碼行號。

## 5. Gate 判定（沿用 v2）

- **PASS 條件**：Build 1e drift gate 全綠（含新 baseline）+ 上述 T1–T5 與 negative control 全綠 + **自然 open-window 連續 3 輪**（:02 recovery 發 token → :07 worker 回應中 `jobs[]` 第一筆為 tokened_job_id 且該 job `rows_written > 0` 或有明確 outcome）。
- 少於 3 輪、或任一輪 token 未出現在 `jobs[]` → PENDING/FAIL，不得宣告完成。
- 覆蓋率新鮮度（最新交易日 3.1%）**不在**本 gate，屬 Build 2。
- 全程不手動觸發 worker、不 Publish、不改 cron。

## 技術限制摘要

只新增 1 個 migration、1 個測試檔，並修改 `scripts/ephemeral-pg.sh`、`scripts/bsr-slice-verify.sh`、`scripts/gen-bsr-slice-fixture.sh` 的清單常數與 baseline TSV（追加 2 行）。回滾＝以舊 md5 `938a714b…` 版本 `CREATE OR REPLACE` 還原並移除追加的 baseline 行。
