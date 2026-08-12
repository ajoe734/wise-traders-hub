# Build 1f Final Plan v6.1-final2 — Local Freeze Stage

狀態：**可批准 Stage A only（local freeze）**。Stage B（production migration / Edge deploy / 自然 gate）不在本次批准範圍，必須在 v6.2 以 Stage A 實測且可讀回的 exact 值另行批准。Build 2 仍 blocked。

本版相對 v6.1-final 不改功能，只封三個可執行性缺口：canonical 檔的 statement terminator、negative control 的必然失敗性、T5 branch counter 不被 rollback 吃掉；另加 expected 檔 before-state 的 read-only 查證。

## Stage A 範圍（本次可批准）

### 1. Canonical source（唯一 source-of-truth）

新增 `supabase/tests/fixtures/bsr_claim_planned.sql`，內容**逐字**如下，檔案結尾為 `$function$;` 後單一 LF（無 BOM、LF 換行）：

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
    WHERE status = 'pending'
      AND priority <= _max_priority
      AND next_run_at <= now()
      AND (NOT in_hours OR post_close_only = false)
      AND last_error = 'quota_recovery_token'
    ORDER BY next_run_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(1, GREATEST(_batch, 0))
  ),
  normal AS (
    SELECT id FROM public.tw_bsr_sync_queue
    WHERE status = 'pending'
      AND priority <= _max_priority
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
    FROM picked
    WHERE q.id = picked.id
    RETURNING q.*
  )
  SELECT u.* FROM updated u
  JOIN picked p ON p.id = u.id
  ORDER BY p.bucket ASC, u.priority ASC, u.next_run_at ASC, u.id ASC;
END;
$function$;
```

- 最後兩行為 `END;` 與 `$function$;`，確保 `psql -f` 會實際執行該 statement。
- `bsr_claim_planned.sha256` 對**含結尾 `;` 與單一 LF 的完整 bytes**計算（`sha256sum` 直接吃檔案，不做任何 trim）。

語意鎖定（與 v2–v6 已批准政策一致，未漂移）：

- token_slot 選「**最老的 recovery token**」— `ORDER BY next_run_at ASC, id ASC`，**不含** `priority`。
- normal 維持既有排序 `priority ASC, next_run_at ASC, id ASC`。
- 每次 invocation DB 端最多 1 個 token（`LIMIT LEAST(1, …)`）。
- normal CTE 以 `last_error IS DISTINCT FROM 'quota_recovery_token'` 排除所有 token。
- 兩個 CTE 皆 `FOR UPDATE SKIP LOCKED`。
- 最終 `ORDER BY p.bucket ASC` 讓 token 排在 `jobs[0]`；回傳型別 `SETOF tw_bsr_sync_queue` 不變。

### 2. Migration 與 canonical 同源

`supabase/migrations/20260812211500_bsr_claim_token_slot.sql` 內的 `CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs` 區塊必須與 canonical file 逐字同源。migration 不能 include fixture，故以**強制檢查**取代兩份無檢查拷貝：

`scripts/bsr-claim-equivalence.sh`：
1. ephemeral PG 套 canonical file → 取簽名資訊；
2. 乾淨 session 套 migration 檔 → 取同樣資訊；
3. assert 全等，任何不等 exit 1 並印 `diff <(canonical) <(migration extract)`。

比對欄位（全部必須相同）：`md5(prosrc)`、`md5(pg_get_functiondef(oid))`、`pg_get_function_identity_arguments(oid)`、`pg_get_function_result(oid)`、`prosecdef`、`proconfig`、`provolatile`、`prolang`。

`proowner` / `proacl` 屬 **production read-back** 項目；local migration 不得自行 `GRANT` / `ALTER OWNER`，verifier 另 assert migration 檔內不含授權語句。並 assert canonical 的 sha256 與 `bsr_claim_planned.sha256` 一致。

### 3. Expected 檔不得自我批准

`supabase/tests/fixtures/bsr_claim_expected.tsv`：已 read-only 查證，該檔**目前不存在**（fixtures 目錄現有 `bsr_slice_expected.tsv`、`bsr_slice_functions.sql`、`bsr_slice_schema.sql`），因此 Stage A 為**新增**。內容：

- pre 行填入 v6 已由 production read-only 確認的 `claim_bsr_queue_jobs` pre hash；
- post 行一律字面值：

```
post	prosrc	UNAPPROVED_LOCAL_MEASUREMENT
post	functiondef	UNAPPROVED_LOCAL_MEASUREMENT
```

實測值只寫進隨機暫存目錄（§6）的 `measurement.json`（run1 / run2 各一組，附 canonical sha256、PG 版本、時間戳），並在報告原文列出。任何 runtime 自動把量測值寫回 expected 皆屬違規；比對腳本遇 `UNAPPROVED_LOCAL_MEASUREMENT` 一律 skip post 比對並輸出 `POST GATE: NOT APPROVED YET`。

### 4. SQL 測試

**正向**（ephemeral PG 重建兩次，各自逐字套 canonical file 並量 `prosrc` / `functiondef` hash，兩次必須一致，否則 FAIL）：

- T1 只有 token → 回 1 筆且為 token。
- T2 固定 fixture：1 個舊 token + 多個 normal，`_batch=20` → 恰 1 token、19 normal，且第一列為 token。
- T3 無 token → 行為與 pre 版一致（regression）。
- T4 雙 session 併發 → 同一 token 不會被 claim 兩次（SKIP LOCKED）。
- T5 交易時段兩支 branch（見 §5）。
- T6 token 政策：兩個 recovery token（不同 `priority`、不同 `next_run_at`）→ 選中者必為 `next_run_at` 較早者，即使其 `priority` 較大。

**Deterministic negative controls**（每個變體只在 ephemeral 內套用，不進 repo production 路徑；三者都必須讓對應 assert **必然** FAIL）：

1. **bucket DESC**：final `ORDER BY p.bucket DESC`。沿用 T2 固定 fixture → 第一列必為 normal，`assert first_is_token` 必然 FAIL。
2. **dedupe 失效**：獨立固定 fixture `NC2`，含 **2 個 distinct eligible token**（`id=9001, priority=0, next_run_at=now()-'10 min'`；`id=9002, priority=0, next_run_at=now()-'9 min'`）與若干 normal（`priority>=1`、`next_run_at` 較晚），確保兩個 token 也排在 normal query 結果最前面；`_batch=5`。移除 normal CTE 的 `IS DISTINCT FROM` 後，`updated` 必回傳 **兩個不同 token id**（9001、9002），`assert token_count = 1` 必然 FAIL。判定以 `count(DISTINCT id) WHERE last_error='quota_recovery_token'` 為準，不依賴同一 id 在 picked 重複。
3. **LIMIT 2**：token_slot 改 `LIMIT 2`，同樣使用 `NC2` fixture（2 個 distinct token）、`_batch>=2` → 回傳 2 個 distinct token id，`assert token_count = 1` 必然 FAIL。

**Build 1e regression**：9 functions + 12 relations closure baseline 全數通過（`bsr_slice_*.sql` / `bsr_slice_expected.tsv` 內容不動）。

### 5. T5 branch counter 不可被 rollback

做法明列：**counter 放在 psql 之外的 shell 層**。

- 每個 branch 各自一次獨立 `psql` 呼叫，該 session 內 `BEGIN; CREATE OR REPLACE public.is_tw_trading_hours() RETURNS boolean AS $$ SELECT true $$ …; <queue fixture>; <assertions>; ROLLBACK;`，因此函式覆寫與 queue 變動全數回滾，ephemeral 也不留痕。
- assertion 失敗時 psql 以 `ON_ERROR_STOP=1` 非零退出；**shell 依 exit code 累加 counter**（`BRANCH_A=1` / `BRANCH_B=1`），counter 存在 shell 變數與隨機暫存目錄的 `t5_counters.txt`，**不在任何 transaction 範圍內**。
- 最後 `assert BRANCH_A = 1 && BRANCH_B = 1`，兩支都必須實際跑過且通過，否則整體 exit 1。

### 6. 暫存與隔離

- 所有 measurement / fixture 暫存一律 `mktemp -d`（隨機路徑），**禁止**固定 `/tmp/...` 路徑。
- ephemeral cluster 啟動後、任何 DDL 前先驗 `select current_database()` 與 socket 路徑落在該隨機目錄內，確認非 production 連線。
- `trap` 註冊 cleanup；正常 `stop` 關閉 cluster，異常結束亦強制清理。
- 報告列殘留檢查：`dir=0 / process=0 / socket=0`。

### 7. Edge / Deno

- `deno check supabase/functions/tw-bsr-finmind-sync/index.ts`（含 `lib.ts`）。
- 正向 focused tests（寫在既有 `lib_test.ts`）：`partitionTokenFirst` 為 **stable partition** — 所有 token 保持彼此原相對順序並整體置於所有 non-token 之前；non-token 之間相對順序不變；無 token 時順序完全不變；空陣列安全。（production 每 invocation 最多 1 token 由 DB 保證；TS 只是防禦性 stable partition。）
- deterministic TS negative control：`BSR_PARTITION_IMPL=reversed` 執行同一組 focused tests，預期 **exit code != 0**。開關只存在測試 harness 讀取的注入點，不改 production source；報告附測試前後 `lib.ts` / `index.ts` sha256 相同的證據（無 drift）。
- 既有 Deno 回歸測試（`degrade_signal_test.ts`、`enqueue_filter_test.ts`、`manual_and_source_test.ts`、`queue_simulator_test.ts`）全跑並列 exit code。

### 8. Stage A 硬邊界

- 嚴禁：production migration、production Edge deploy、任何 production DML、手動 invoke cron / worker / Edge / RPC / `net.http_post`、Publish。
- 只允許 production **read-only SELECT** pre/invariant recheck（`claim_bsr_queue_jobs` 與 `is_tw_trading_hours` 的 pre hash、`proowner` / `proacl`、cron 定義），確認自 v6 量測後未漂移。
- Stage A 結束只交付 local files + measurement artifact，然後停下等 v6.2 批准。

### 9. Stage A 報告必含

canonical file sha256（含結尾 `;`+LF）、run1/run2 post `prosrc` / `functiondef` hash、equivalence 全欄位值、所有 created/modified 檔案的 **before/after 狀態與 diff**（含 `bsr_claim_expected.tsv` 的 before = 不存在）、Edge 變更前後 source hash、T5 counters、每項指令真實 exit code、cleanup 零殘留證據。

### 10. Stage B（本次不批准，v6.2 再議）

順序固定：把 v6.2 批准的 post hash 逐字寫入 `bsr_claim_expected.tsv` → 重跑 compare-only + local tests（全綠）→ production migration → **只** deploy `tw-bsr-finmind-sync` → read-back 驗 hash / owner / ACL → 三輪自然 open / exhausted window gate。

## 功能規格與邊界（延續 v6，未變更）

- DB 每 invocation 最多 1 token；normal 批次排除所有 token job。
- 兩個候選 CTE 都 `FOR UPDATE SKIP LOCKED`。
- Edge `partitionTokenFirst` 保證 worker 依序處理時 token 先被指派；`jobOutcomes` 為完成順序，liveness 看 token id **是否存在**於 `jobs[]`，不看 index。
- Edge response schema 不變；ACL、cron、其他 Edge Functions 一律不動。
- Build 1e 9 functions + 12 relations baseline 不動。
- cron correlation 維持 UNKNOWN；freshness 為獨立 FAIL 項，不併入本 gate。
- Build 2 blocked。

## Material files（Stage A，全部僅 local，不執行、不部署）

| 檔案 | before state（已 read-only 確認） | 動作 |
| --- | --- | --- |
| `supabase/tests/fixtures/bsr_claim_planned.sql` | 不存在 | 新增（canonical source） |
| `supabase/tests/fixtures/bsr_claim_planned.sha256` | 不存在 | 新增 |
| `supabase/tests/fixtures/bsr_claim_expected.tsv` | **不存在** | 新增（post = `UNAPPROVED_LOCAL_MEASUREMENT`） |
| `supabase/migrations/20260812211500_bsr_claim_token_slot.sql` | 不存在 | 新增（**不執行**） |
| `scripts/bsr-claim-equivalence.sh` | 不存在 | 新增（含 §2 全欄位 assert、§5 counter 邏輯） |
| `supabase/tests/bsr_claim_token_slot_test.sql` | 不存在 | 新增（T1–T6 + 三個 negative controls） |
| `supabase/functions/tw-bsr-finmind-sync/lib.ts` | 已存在 | 修改（新增 `partitionTokenFirst`，**不 deploy**） |
| `supabase/functions/tw-bsr-finmind-sync/index.ts` | 已存在 | 修改（套用 partition，**不 deploy**） |
| `supabase/functions/tw-bsr-finmind-sync/lib_test.ts` | 已存在 | **修改既有檔**（stable-partition focused tests + `BSR_PARTITION_IMPL=reversed` negative control）；不新增 `token_partition_test.ts` |

## Rollback

Stage A 全部是 local 檔案且不執行 migration、不 deploy，production 完全未變。回退依 **actual before state**：上表標「不存在」者直接刪除；標「已存在」者還原至變更前內容（報告附變更前 sha256 供驗證）。ephemeral cluster 為隨機路徑一次性環境，銷毀即無殘留。
