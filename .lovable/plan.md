# Build 1f Final Plan v5 — token slot 公平性（DB 最多 1 + Edge stable partition）

Build 2 仍未授權。狀態：**尚不可批准**（見 §1 的 hash 阻塞點）。

## 1. Hash representation 與新定義 hash（目前阻塞）

同一函式的兩種 hash 是不同演算法，**不存在互相作廢**的問題：

| 函式 | md5(prosrc) | md5(pg_get_functiondef(oid)) |
|---|---|---|
| `claim_bsr_queue_jobs(integer,integer)` | `9b12fcc4eb311794423ddab603dbff8c` | `bf25e3deaefe24ee761e95e2e6d75391` |
| `is_tw_trading_hours()` | `77dc74079c13940c23c46a494bfc0b7a` | `9da38e982089a7da7364219dc5816d2f` |

以上四值皆為本輪 read-only 於 production 取得。先前文件中的 `9b12fcc4…` 即 prosrc 值、`bf25e3de…` 即 functiondef 值，兩者並存；`938a714b…` 為更早版本、與現行 production 不符，僅作歷史註記，不進 fixture。Build 1e baseline 的 `fn_hash` 語意為 `md5(pg_get_functiondef)`（見該檔 header `fn_hash=md5(pg_get_functiondef)`），Build 1f fixture 兩種都寫，欄位自帶 algorithm。

production server = **PostgreSQL 17.6**；本機 scratch 二進位 = 17.9。`pg_get_functiondef` 輸出在 17.x minor 間穩定，仍以「同一 planned 文本在兩處產生相同 functiondef md5」為 gate（不符即 FAIL 並改以 prosrc 為主 gate）。

**阻塞點**：新定義的 `new md5(prosrc)` / `new md5(pg_get_functiondef)` 必須在隔離 scratch cluster 上實測產生。Plan 模式禁止建立 scratch 目錄（`mkdir /tmp/bsr-v5-scratch` 已被攔），因此本 Plan **不填 TBD、也不能被批准**。解除方式：允許先單獨執行下列一次性、隔離、不碰 repo 也不碰 production 的量測步驟，取得兩個值填入 §4 fixture 後，再看 v5-final 批准：

```text
# 一次性 scratch（listen_addresses=''、unix socket only、用完即刪）
initdb -D /tmp/bsr-v5-scratch/data -U p
pg_ctl -D /tmp/bsr-v5-scratch/data -o "-k /tmp/bsr-v5-scratch -h ''" start
psql -h /tmp/bsr-v5-scratch -U p -d postgres   # 建 stub tw_bsr_sync_queue + is_tw_trading_hours
                                               # 套 §3 planned SQL 逐字，取兩個 md5
pg_ctl -D /tmp/bsr-v5-scratch/data stop && rm -rf /tmp/bsr-v5-scratch
```
（`pg_get_functiondef` 只依簽章與 body，stub 欄位不影響結果；全程不寫 repo、不連 production。）

## 2. 為什麼 DB ORDER BY 不能當唯一保證（v4 結論保留）

`claim_bsr_queue_jobs` 回傳 `SETOF tw_bsr_sync_queue`，PostgREST 以外層 `SELECT * FROM rpc(...)` 呼叫，函式內 final ORDER BY 不是外層契約。而處理順序決定 liveness：

- `index.ts` L523-525 `supa.rpc('claim_bsr_queue_jobs', …)` → `jobs`
- L550-556 `let idx = 0; while (idx < jobs.length) { if (Date.now()-started > budgetMs) return; if (rateLimitedStop) return; const job = jobs[idx++]; … }`
- L648 `Promise.all(Array.from({ length: Math.min(cappedConcurrency, jobs.length) }, worker))`（N worker 共用 idx）

超時／rateLimitedStop 時尾端 job 被丟下。分工：**DB 保證 eligible token 最多 1**；**Edge stable partition 保證 processing-first**；SQL final ORDER BY 僅 defense-in-depth。

## 3. Migration（唯一 SQL 變更）

`supabase/migrations/20260812211500_bsr_claim_token_slot.sql`（> repo actual max `20260812114447`，14 位 UTC timestamp + snake_case，無碰撞）。SQL 逐字同 v4 §3（`token_slot` LIMIT `LEAST(1, GREATEST(_batch,0))`；`normal` 以 `last_error IS DISTINCT FROM 'quota_recovery_token'` 排除所有 token 並 `LIMIT GREATEST(_batch - count(token_slot), 0)`；`picked` 帶 bucket；data-modifying CTE `updated`；final `ORDER BY p.bucket, u.priority, u.next_run_at, u.id`）。屬性逐字保留 production actual：`SECURITY INVOKER`、`SET search_path TO 'public'`、owner `postgres`、**GRANT 完全不動**（Build 1c ACL 收斂原樣）。不動 `cron_edge_call`、cron、queue 資料、degrade/budget/metrics 函式。

## 4. Build 1f pinned fixture（Build 1e 9+12 逐字不動）

`supabase/tests/fixtures/bsr_slice_expected.tsv` 完全不改。新增 `supabase/tests/fixtures/bsr_claim_expected.tsv`，**完整內容如下**（`<NEW_PROSRC_MD5>` / `<NEW_DEF_MD5>` 由 §1 量測後在批准前填入定值；generator 永遠不得寫入本檔）：

```text
# bsr_claim_expected.tsv  format_version=1  approved_in=Build1f Final Plan v5
# columns: kind<TAB>name<TAB>algo<TAB>phase<TAB>hash
# phase: pre = migration 前 production 必須相符；post = migration 後 production 必須相符；
#        invariant = 全程不得變動
fn	claim_bsr_queue_jobs	md5(prosrc)	pre	9b12fcc4eb311794423ddab603dbff8c
fn	claim_bsr_queue_jobs	md5(pg_get_functiondef)	pre	bf25e3deaefe24ee761e95e2e6d75391
fn	claim_bsr_queue_jobs	md5(prosrc)	post	<NEW_PROSRC_MD5>
fn	claim_bsr_queue_jobs	md5(pg_get_functiondef)	post	<NEW_DEF_MD5>
fn	is_tw_trading_hours	md5(prosrc)	invariant	77dc74079c13940c23c46a494bfc0b7a
fn	is_tw_trading_hours	md5(pg_get_functiondef)	invariant	9da38e982089a7da7364219dc5816d2f
rel	tw_bsr_sync_queue	sha256(Build1e)	invariant	f7358406623859b24d3ce6895f965d140cc5f88f92a787676e1dedf556a2d0dd
```

**執行順序（強制）**：
1. production read-only：比對兩個 `pre` 行 + 兩個 `invariant` fn 行 + queue relation invariant → 不符即 abort。
2. 以「已批准的 planned definition」在 ephemeral 建 local fixture，比對兩個 `post` 行（compare-only）。
3. local tests（SQL + Deno）全綠。
4. production migration。
5. production read-back：兩個 `post` 行 + 所有 invariant 行相符。

## 5. Ephemeral SQL 測試與 DDL 來源

新檔 `supabase/tests/bsr_claim_token_slot_test.sql`，由既有 `scripts/ephemeral-pg.sh test` 的 `psql_run -f` 清單載入。

- **DDL 重用**：不手抄 queue schema。loader 讀取既有 pinned fixture `supabase/tests/fixtures/bsr_slice_schema.sql` 中 `tw_bsr_sync_queue` 相關段落（該檔已含 `CREATE SEQUENCE tw_bsr_sync_queue_id_seq`、`CREATE TABLE public.tw_bsr_sync_queue`、PK / priority / status CHECK、`tw_bsr_sync_queue_active_uniq`），並只額外載入兩個 function definition：`is_tw_trading_hours`（production actual 文本，hash 對應 §4 invariant 行）與 `claim_bsr_queue_jobs`（§3 planned 文本）。不新增任何其他 relation。
- **T1 分區（SQL defense-in-depth）**：1 token（id 最大、priority 2）+ 5 normal → 第一列為 token，其餘順序等於舊排序。
- **T2 最多 1 token**：3 token → 回傳恰 1，總數 = `_batch`。
- **T3 邊界**：`_batch=1` 只回 token；`_batch=0` 回 0 列；無 token 時逐列等同舊版。
- **T4 併發**：harness 起第二個背景 psql session（沿用既有 Case C 寫法），兩 session id 集合互斥、同 token id 不重覆；兩 session exit code 皆 `wait $pid` 併入 `TEST_EXIT`。
- **T5 兩個 trading-window 分支，皆必跑**：planned 函式呼叫 schema-qualified `public.is_tw_trading_hours()`，故 shadow schema 無效。改為：在 ephemeral cluster 上，分支 A 開 transaction → `CREATE OR REPLACE FUNCTION public.is_tw_trading_hours() RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$` → 跑盤中 assertions（`post_close_only = true` 列不可被 claim）→ `ROLLBACK`；分支 B 同法回 `false` → 跑盤外 assertions（`post_close_only = true` 列可被 claim）→ `ROLLBACK`；最後重新驗證 `is_tw_trading_hours` 定義回到 pristine（md5 = invariant 值）。每個分支開始與結束都 assert `current_database() = 'bsr_ephemeral'`、`inet_server_addr() IS NULL`（unix socket only）、`current_setting('port')` 為 ephemeral port，並以 branch counter assert A=1、B=1，任一為 0 → `TEST_EXIT` 非 0。production 零寫入（ephemeral 腳本已 `unset PG*`，物理上無法連 production）。

## 6. Deterministic negative controls

- **SQL（由 `scripts/ephemeral-pg.sh` 處理）**
  - `--drift-control claim-order`：載入 final `ORDER BY p.bucket DESC` 的變體 → T1 必然 FAIL。
  - `--drift-control claim-dedupe`：`normal` 移除 `IS DISTINCT FROM` 條件 → T2 必然回傳 >1 token，必然 FAIL。
- **TS（不經 ephemeral-pg.sh，依既有 Deno 慣例）**：`token_partition_test.ts` 內部由 `partitionImpl()` 取得實作，`BSR_PARTITION_IMPL=reversed` 時改用 `(jobs) => [...nonTokens, ...tokens]` 的反轉實作（該反轉函式只存在於 test 檔內，不進 `lib.ts`、不改 production source、不留檔案漂移）。
  - 正向：`deno test --allow-env --no-check supabase/functions/tw-bsr-finmind-sync/token_partition_test.ts` → exit 0。
  - 負向：`BSR_PARTITION_IMPL=reversed deno test --allow-env --no-check supabase/functions/tw-bsr-finmind-sync/token_partition_test.ts` → 必然 exit != 0。

## 7. Edge 修改（最小化，只改 tw-bsr-finmind-sync）

`lib.ts` 新增：

```ts
export const QUOTA_RECOVERY_TOKEN = 'quota_recovery_token';
export function partitionTokenFirst<T extends { last_error?: string | null }>(jobs: T[]): T[] {
  const tokens: T[] = []; const rest: T[] = [];
  for (const j of jobs) (j.last_error === QUOTA_RECOVERY_TOKEN ? tokens : rest).push(j);
  return [...tokens, ...rest];
}
```

`index.ts`：在 L526 `claim_failed` 檢查與 L527 空集合早退之後、L537 `jobOutcomes` 宣告之前插入
`const orderedJobs = partitionTokenFirst(jobs as Array<Record<string, any>>);`，並把 L552-556 迴圈與 L648 併發度計算中的 `jobs` 換成 `orderedJobs`。

**Response schema（read-only 已確認既有欄位）**：現有回應已含 `claimed`、`job_ids`、`jobs`（每筆 `{id, stock_id, trade_date, priority, outcome, rows_written, last_error}`）、`rows_written`、`jobs_quota_deferred` 等。

- `claimed_ids` **不新增**（與既有 `job_ids` 重複）。
- `token_first` **不新增**：可由 `jobs[0].last_error === 'quota_recovery_token'` 推得；但 `jobOutcomes` 是「已處理」順序，正是 liveness 要證的東西，故足夠。
- 唯一變更：`jobOutcomes` 的填入順序改為依 `orderedJobs`（副作用，無 schema 變更）。

before/after JSON shape：**完全相同**（欄位集合不變），僅 `jobs[]` / `job_ids[]` 的排列改為 token-first。

## 8. Scope、部署與 read-back

執行順序：local ephemeral SQL tests → `deno check supabase/functions/tw-bsr-finmind-sync/index.ts` → focused Deno test（正向 exit 0、負向 exit != 0）+ 既有 `lib_test.ts` 回歸 → 全綠才 production migration → **只部署 `tw-bsr-finmind-sync`**，不得順帶改／部署其他 Edge。

部署後 read-back 證明：`claim_bsr_queue_jobs` 兩個 post hash 相符；其餘 8 個 Build 1e closure 函式 md5(pg_get_functiondef) 與 21 行 baseline 逐字相同；`is_tw_trading_hours` 兩個 invariant hash 不變；`admin_list_cron_jobs` 中 job 106/107 的 schedule/command 與變更前逐字相同；Edge 端只有 `tw-bsr-finmind-sync` 有新版本。

## 9. Rollback

- SQL：還原至 `md5(prosrc)=9b12fcc4eb311794423ddab603dbff8c` / `md5(pg_get_functiondef)=bf25e3deaefe24ee761e95e2e6d75391` 的舊定義（單一 `picked` CTE 版本，文本已於 read-only 取得並存於驗收紀錄），以 `CREATE OR REPLACE` 還原，不觸及 GRANT。
- Edge：部署前記錄 `index.ts`、`lib.ts` 的 sha256 與當時部署版本號；回退＝還原這兩檔並只重新部署 `tw-bsr-finmind-sync`。

## 10. Gate（不放寬）

**A. Open-window liveness — 連續 3 輪，每輪皆須**：(1) :02 recovery 恰 1 筆 audit 並發出 `tokened_job_id`；(2) 其後自然 :07 job107 的 `jobs[]` 第一筆即該 id；(3) 該筆 `rows_written > 0`；(4) `tw_chip_fact` 有相符 delta（該 stock_id + trade_date 新增列）。「有明確 outcome」不計入 liveness。

**B. Exhausted-window safety — 至少 3 輪 future 自然輪次，每輪**：job107 HTTP 200、`jobs_quota_deferred > 0`、`rows_written = 0`、無非預期寫入。

A 或 B 任一不足 → PENDING。全程不手動觸發 worker、不改 cron、不 Publish。

**獨立 FAIL（不在本 gate）**：全市場 freshness（最新交易日 3.1%）屬 Build 2，未授權。

**cron_edge_call caveat**：不修改（61/72 cron 共用，全域故障點）；關聯以分鐘 :07 唯一 dispatch（cardinality=1）時間對齊為 best-effort，證據等級 UNKNOWN，不作 gate 條件。

## 11. Material modified files（完整清單）

1. `supabase/migrations/20260812211500_bsr_claim_token_slot.sql`（新增）
2. `supabase/functions/tw-bsr-finmind-sync/lib.ts`（新增 2 export）
3. `supabase/functions/tw-bsr-finmind-sync/index.ts`（插入 `orderedJobs` + 3 處替換）
4. `supabase/functions/tw-bsr-finmind-sync/token_partition_test.ts`（新增，含 env 切換的反轉負向控制）
5. `supabase/tests/bsr_claim_token_slot_test.sql`（新增）
6. `supabase/tests/fixtures/bsr_claim_expected.tsv`（新增，pinned，執行階段唯讀）
7. `scripts/ephemeral-pg.sh`（載入新 test、queue DDL 子集 loader、`--drift-control claim-order|claim-dedupe`、T4 背景 session）
8. 回滾腳本文本（驗收紀錄，不進 repo）

**不改**：`supabase/tests/fixtures/bsr_slice_expected.tsv`、`bsr_slice_schema.sql`、`bsr_slice_functions.sql`、`scripts/bsr-slice-verify.sh`、`scripts/gen-bsr-slice-fixture.sh`、其他任何 Edge Function、cron、queue 資料、ACL。
