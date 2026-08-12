# Build 1f Final Plan v6.1-final — Local Freeze Stage

狀態：**可批准 Stage A only（local freeze）**。Stage B（production migration / Edge deploy / 自然 gate）不在本次批准範圍，必須在 v6.2 以 Stage A 實測且可讀回的 exact 值另行批准。Build 2 仍 blocked。

## 為什麼要拆兩階段

v6 在第一道 hash gate 正確停下：pin 在計畫裡的 post hash 來自一次性 scratch 量測，但當時的 SQL 逐字文本沒有進 repo，重建後產生 whitespace 差異，hash 不符。修法不是放寬 gate，而是把「定義文本」變成 repo 內唯一 canonical source，並且**禁止 runtime 自己把量到的值標成 approved**。Stage A 只產生 measurement artifact，人工在 v6.2 批准後才寫入 expected。

## Stage A 範圍（本次可批准）

### 1. Canonical source（唯一 source-of-truth）

新增 `supabase/tests/fixtures/bsr_claim_planned.sql`，內容**逐字**如下（檔尾單一換行、無 BOM、LF）：

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
END; $function$
```

語意鎖定（與 v2–v6 已批准政策一致，未漂移）：

- token_slot 選「**最老的 recovery token**」— `ORDER BY next_run_at ASC, id ASC`，**不含** `priority`，避免 policy 漂移。
- normal 維持既有排序 `priority ASC, next_run_at ASC, id ASC`。
- 每次 invocation DB 端最多 1 個 token（`LIMIT LEAST(1, …)`）。
- normal CTE 以 `last_error IS DISTINCT FROM 'quota_recovery_token'` 排除所有 token。
- 兩個 CTE 皆 `FOR UPDATE SKIP LOCKED`。
- 最終 `ORDER BY p.bucket ASC` 讓 token 排在 `jobs[0]`；回傳型別 `SETOF tw_bsr_sync_queue` 不變。

### 2. Migration 與 canonical 同源

`supabase/migrations/20260812211500_bsr_claim_token_slot.sql` 內的 `CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs` 區塊必須與 canonical file 逐字同源。因為 migration 執行環境不能 include fixture，改用**強制檢查**取代兩份無檢查拷貝：

- local verifier `scripts/bsr-claim-equivalence.sh`：
  1. 在 ephemeral PG 套 canonical file → 取簽名資訊；
  2. 於乾淨 session 套 migration 檔 → 取同樣資訊；
  3. `assert` 兩邊完全相等，任何不等以 exit 1 中止並印出 `diff <(canonical) <(migration extract)`。
- 比對欄位（全部必須相同）：
  - `md5(prosrc)`
  - `md5(pg_get_functiondef(oid))`
  - `pg_get_function_identity_arguments(oid)`（identity args）
  - `pg_get_function_result(oid)`（return type）
  - `prosecdef`、`proconfig`、`provolatile`、`prolang`
- `proowner` / `proacl` 屬 **production read-back** 項目，local migration 不得自行 `GRANT`/`ALTER OWNER`；verifier 只 assert migration 檔內不含授權語句。
- 另 assert canonical file 的 sha256 與 `supabase/tests/fixtures/bsr_claim_planned.sha256` 一致，防止事後被無聲修改。

### 3. Expected 檔不得自我批准

`supabase/tests/fixtures/bsr_claim_expected.tsv` 的 pre 行維持 v6 已由 production read-only 確認的值；post 行本階段一律寫成字面值：

```
post	prosrc	UNAPPROVED_LOCAL_MEASUREMENT
post	functiondef	UNAPPROVED_LOCAL_MEASUREMENT
```

實測值只寫到 measurement artifact（見 §5 的隨機暫存目錄）`measurement.json`（run1 / run2 各一組，附 canonical sha256、PG 版本、時間戳），並在 Stage A 報告中原文列出。任何 runtime 自動把量到的值寫回 expected 的行為視為違規；比對腳本遇到 `UNAPPROVED_LOCAL_MEASUREMENT` 一律 skip post 比對並輸出明確 `POST GATE: NOT APPROVED YET`。

### 4. Stage A 必跑項目（全部要列真實 exit code）

**SQL 正向**（ephemeral PG 重建兩次，各自逐字套 canonical file 並量 `prosrc` / `functiondef` hash，兩次必須一致，否則 FAIL）：

- T1 只有 token → 回 1 筆且為 token。
- T2 固定 fixture：1 個舊 token + 多個 normal，`_batch=20` → 恰 1 token、19 normal，且第一列為 token。
- T3 無 token → 行為與 pre 版一致（regression）。
- T4 雙 session 併發 → 同一 token 不會被 claim 兩次（SKIP LOCKED）。
- T5 `is_tw_trading_hours()` 於 transaction 內 `CREATE OR REPLACE` 覆寫成常數 true / false 兩支，兩支 branch counter 都必須 > 0，測畢 `ROLLBACK`。
- T6 token 政策：兩個 recovery token（不同 `priority`、不同 `next_run_at`）→ 被選中的必為 `next_run_at` 較早者，即使其 `priority` 較大（鎖住「最老 token」政策）。

**SQL deterministic negative controls**（三個變體都必須讓對應測試 FAIL，證明測試有鑑別力；每個變體只在 ephemeral 內套用，不進 repo production 路徑）：

1. final `ORDER BY p.bucket DESC` → 固定 fixture 下 T2 第一列必為 normal，必然 FAIL。
2. normal CTE 移除 token 排除條件 → token 重複出現，必然 FAIL。
3. token_slot `LIMIT 2` → 回傳 2 個 token，必然 FAIL。

**Build 1e regression**：9 functions + 12 relations closure baseline 全數通過（baseline 內容不動）。

**Edge / Deno**：

- `deno check supabase/functions/tw-bsr-finmind-sync/index.ts`（含 lib.ts）。
- 正向 focused tests（見 §5 的測試檔）：`partitionTokenFirst` 為 **stable partition** — 所有 token 保持彼此原相對順序並整體置於所有 non-token 之前；non-token 之間相對順序亦不變；無 token 時陣列順序完全不變；空陣列安全。（production 每 invocation 最多 1 token 由 DB 層保證；TS 只是防禦性 stable partition。）
- deterministic TS negative control：以 `BSR_PARTITION_IMPL=reversed` 執行同一組 focused tests，預期 **exit code != 0**。此開關只存在於測試 harness 讀取的注入點，不改 production source、測試結束不留 drift（報告附測試前後 `lib.ts` / `index.ts` sha256 相同的證據）。
- 既有 Deno 回歸測試全跑。

### 5. 暫存與隔離（Stage A）

- 所有 measurement / fixture 暫存一律 `mktemp -d`（隨機路徑），**禁止**固定 `/tmp/bsr-v6.1` 之類路徑。
- ephemeral cluster 啟動後、任何 DDL 前先驗 `select current_database()` 與 socket 路徑落在該隨機目錄內，確認不是 production 連線。
- 以 `trap` 註冊 cleanup；正常 `stop` 關閉 cluster，非正常結束亦強制清理。
- 報告列出殘留檢查：`dir=0 / process=0 / socket=0`。

### 6. Stage A 硬邊界

- 嚴禁：production migration、production Edge deploy、任何 production DML、手動 invoke cron / worker / Edge / RPC / `net.http_post`、Publish。
- 只允許：production **read-only SELECT** pre/invariant recheck（`claim_bsr_queue_jobs` 與 `is_tw_trading_hours` 的 pre hash、`proowner`/`proacl`、cron 定義），確認自 v6 量測後 production 未漂移。
- Stage A 結束只交付 local files + measurement artifact，然後停下等 v6.2 批准。

### 7. Stage A 報告必含

canonical file sha256、run1/run2 的 post `prosrc` / `functiondef` hash、migration equivalence 的全部比對欄位值、所有 modified/created files 的 diff、Edge 變更前的 source hash（`lib.ts` / `index.ts`）、每一項指令的實際 exit code、cleanup 零殘留證據。

### 8. Stage B（本次不批准，v6.2 再議）

順序固定：把 v6.2 批准的 post hash 逐字寫入 `bsr_claim_expected.tsv` → 先重跑 compare-only + local tests（必須全綠）→ production migration → **只** deploy `tw-bsr-finmind-sync` → read-back 驗 hash / owner / ACL → 進入三輪自然 open / exhausted window gate。

## 功能規格與邊界（延續 v6，未變更）

- DB 每 invocation 最多 1 token；normal 批次排除所有 token job。
- 兩個候選 CTE 都 `FOR UPDATE SKIP LOCKED`。
- Edge `partitionTokenFirst` 保證 worker 依序處理時 token 先被指派；`jobOutcomes` 仍是完成順序，liveness 判定看 token id **是否存在**於 `jobs[]`，不看 index。
- Edge response schema 不變；ACL、cron、其他 Edge Functions 一律不動。
- Build 1e 9 functions + 12 relations baseline 不動。
- cron correlation 維持 UNKNOWN；freshness 為獨立 FAIL 項，不併入本 gate。
- Build 2 blocked。

## Material files（Stage A，全部僅 local，不執行、不部署）

| 檔案 | 動作 |
| --- | --- |
| `supabase/tests/fixtures/bsr_claim_planned.sql` | 新增（canonical source） |
| `supabase/tests/fixtures/bsr_claim_planned.sha256` | 新增 |
| `supabase/tests/fixtures/bsr_claim_expected.tsv` | 修改（post = `UNAPPROVED_LOCAL_MEASUREMENT`） |
| `supabase/migrations/20260812211500_bsr_claim_token_slot.sql` | 新增（**不執行**） |
| `scripts/bsr-claim-equivalence.sh` | 新增（含 §2 全欄位 assert） |
| `supabase/tests/bsr_claim_token_slot_test.sql` | 新增（T1–T6 + 三個 negative controls） |
| `supabase/functions/tw-bsr-finmind-sync/lib.ts` | 修改（新增 `partitionTokenFirst`，**不 deploy**） |
| `supabase/functions/tw-bsr-finmind-sync/index.ts` | 修改（套用 partition，**不 deploy**） |
| `supabase/functions/tw-bsr-finmind-sync/lib_test.ts` | **修改既有檔**（加入 stable-partition focused tests 與 `BSR_PARTITION_IMPL=reversed` negative control）；不新增 `token_partition_test.ts` |

## Rollback

Stage A 全部是 local 檔案且不執行 migration、不 deploy，production 完全未變。回退方式：刪除上表新增檔案、還原 `lib.ts` / `index.ts` / `bsr_claim_expected.tsv` 至變更前內容（報告會附變更前 source hash 供驗證）。ephemeral cluster 為隨機路徑一次性環境，銷毀即無殘留。
