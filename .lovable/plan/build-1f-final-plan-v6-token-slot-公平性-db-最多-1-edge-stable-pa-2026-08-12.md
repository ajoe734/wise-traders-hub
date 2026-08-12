# Build 1f Final Plan v6 — token slot 公平性（DB 最多 1 + Edge stable partition）

狀態：**可批准**（hash 阻塞點已由一次性隔離量測解除，零 TBD）。Build 2 仍未授權。

## 1. Hash representation 與 planned 定義 hash（已量測，無 TBD）

同一函式兩種 hash 為不同演算法，並存不互斥：

| 函式 | phase | md5(prosrc) | md5(pg_get_functiondef) |
|---|---|---|---|
| `claim_bsr_queue_jobs(integer,integer)` | pre（production actual） | `9b12fcc4eb311794423ddab603dbff8c` | `bf25e3deaefe24ee761e95e2e6d75391` |
| `claim_bsr_queue_jobs(integer,integer)` | post（planned，scratch 實測） | `77cd1b08f224ee2151ba9a4c5757e474` | `0d853b41bbc64b7bed35291969e58e41` |
| `is_tw_trading_hours()` | invariant | `77dc74079c13940c23c46a494bfc0b7a` | `9da38e982089a7da7364219dc5816d2f` |

post 兩值來自本輪一次性、隔離、unix-socket-only ephemeral cluster 的兩次獨立 run（結果一致），全程未碰 repo、未連 production。

**Gate 分級**：
- 主 gate = `md5(prosrc)` post `77cd1b08f224ee2151ba9a4c5757e474`。必須逐字相符。
- 次 gate = `md5(pg_get_functiondef)` post `0d853b41bbc64b7bed35291969e58e41`。scratch 為 PG 17.9、production 為 PG 17.6；若 prosrc 主 gate 通過、且 identity（`pronargs`/`proargtypes`/`prorettype`）、owner、`prosecdef`、`proconfig`、`proacl` 逐項相符，但 functiondef 不符（僅 minor formatting 差異），**不得自行修改 expected**：標記 caveat、停下回報，等使用者裁決。

## 2. 為什麼 DB ORDER BY 不能當唯一保證（v4 結論保留）

`claim_bsr_queue_jobs` 回傳 `SETOF tw_bsr_sync_queue`，PostgREST 以外層 `SELECT * FROM rpc(...)` 呼叫，函式內 final ORDER BY 不是外層契約；而處理順序決定 liveness：

- `index.ts` L523-525 `supa.rpc('claim_bsr_queue_jobs', …)` → `jobs`
- L550-556 `let idx = 0; while (idx < jobs.length) { if (Date.now()-started > budgetMs) return; if (rateLimitedStop) return; const job = jobs[idx++]; … }`
- L648 `Promise.all(Array.from({ length: Math.min(cappedConcurrency, jobs.length) }, worker))`（最多 3 worker 共用 idx）

超時／rateLimitedStop 時尾端 job 被丟下。分工：**DB 保證 eligible token 最多 1**；**Edge stable partition 保證 token 由 shared idx 第一個被指派**；SQL final ORDER BY 僅 defense-in-depth。

**Assignment vs completion（v6 明確化）**：回應中的 `jobs[]` / `job_ids[]` 由 `jobOutcomes.push()` 在 `await processStock` **之後**填入，因此是最多 3 個 worker 的 **concurrent completion 順序**，不是 assignment 順序。故任何 gate 都不得要求 `jobs[0]`。

## 3. Migration（唯一 SQL 變更）

`supabase/migrations/20260812211500_bsr_claim_token_slot.sql`（> repo actual max `20260812114447`，14 位 UTC timestamp + snake_case，無碰撞）。SQL 逐字同 v4/v5 §3：

- `token_slot` CTE：`LIMIT LEAST(1, GREATEST(_batch,0))`，`FOR UPDATE SKIP LOCKED` → 每次 invocation 最多 1 個 token。
- `normal` CTE：`last_error IS DISTINCT FROM 'quota_recovery_token'` 排除**全部** token，`LIMIT GREATEST(_batch - count(token_slot), 0)`，`FOR UPDATE SKIP LOCKED`。
- `picked` 帶 `bucket`（token=0、normal=1）；data-modifying CTE `updated`；final `ORDER BY p.bucket, u.priority, u.next_run_at, u.id`。

屬性逐項保留 production actual：`SECURITY INVOKER`、`SET search_path TO 'public'`、owner `postgres`、`proacl`／GRANT **完全不動**（Build 1c ACL 收斂原樣）。不動 `cron_edge_call`、cron job 106/107、queue 資料、degrade/budget/metrics 函式。

## 4. Build 1f pinned fixture（Build 1e 9+12 逐字不動）

`supabase/tests/fixtures/bsr_slice_expected.tsv`（9 functions + 12 relations）完全不改。新增 `supabase/tests/fixtures/bsr_claim_expected.tsv`，**完整內容如下，零 TBD**（generator 永遠不得寫入本檔）：

```text
# bsr_claim_expected.tsv  format_version=1  approved_in=Build1f Final Plan v6
# columns: kind<TAB>name<TAB>algo<TAB>phase<TAB>hash
# phase: pre = migration 前 production 必須相符；post = migration 後 production 必須相符；
#        invariant = 全程不得變動
fn	claim_bsr_queue_jobs	md5(prosrc)	pre	9b12fcc4eb311794423ddab603dbff8c
fn	claim_bsr_queue_jobs	md5(pg_get_functiondef)	pre	bf25e3deaefe24ee761e95e2e6d75391
fn	claim_bsr_queue_jobs	md5(prosrc)	post	77cd1b08f224ee2151ba9a4c5757e474
fn	claim_bsr_queue_jobs	md5(pg_get_functiondef)	post	0d853b41bbc64b7bed35291969e58e41
fn	is_tw_trading_hours	md5(prosrc)	invariant	77dc74079c13940c23c46a494bfc0b7a
fn	is_tw_trading_hours	md5(pg_get_functiondef)	invariant	9da38e982089a7da7364219dc5816d2f
rel	tw_bsr_sync_queue	sha256(Build1e)	invariant	f7358406623859b24d3ce6895f965d140cc5f88f92a787676e1dedf556a2d0dd
```

**執行順序（強制）**：
1. production read-only：比對兩個 `pre` 行 + 兩個 `is_tw_trading_hours` invariant 行 + queue relation invariant → 不符即 abort。
2. local tests（SQL + Deno）全綠，含 negative controls。
3. production migration。
4. production read-back：主 gate prosrc post 相符；次 gate functiondef post 相符（不符則依 §1 caveat 停下）；所有 invariant 行不變；ACL/owner/prosecdef/proconfig/proacl 逐項相符。

## 5. Ephemeral SQL 測試與 DDL 來源

新檔 `supabase/tests/bsr_claim_token_slot_test.sql`，由既有 `scripts/ephemeral-pg.sh test` 的 `psql_run -f` 清單載入。

- **DDL 重用**：不手抄 queue schema，loader 讀取既有 pinned `supabase/tests/fixtures/bsr_slice_schema.sql` 中 `tw_bsr_sync_queue` 相關段落（含 sequence、table、PK、CHECK、`tw_bsr_sync_queue_active_uniq`），另外只載入兩個 function：`is_tw_trading_hours`（production actual 文本）與 `claim_bsr_queue_jobs`（§3 planned 文本）。不新增任何其他 relation。
- **T1 分區（defense-in-depth）**：1 token（id 最大、priority 2）+ 5 normal → 第一列為 token，其餘順序等於舊排序。
- **T2 最多 1 token**：3 token → 恰回 1，總數 = `_batch`。
- **T3 邊界**：`_batch=1` 只回 token；`_batch=0` 回 0 列；無 token 時逐列等同舊版。
- **T4 併發**：harness 起第二個背景 psql session（沿用既有 Case C 寫法），兩 session id 集合互斥、同 token id 不重覆；兩 session exit code 皆 `wait $pid` 併入 `TEST_EXIT`。
- **T5 盤中／盤外兩分支皆必跑**：planned 函式呼叫 schema-qualified `public.is_tw_trading_hours()`，shadow schema 無效。改為在 ephemeral cluster 上：分支 A `BEGIN` → `CREATE OR REPLACE FUNCTION public.is_tw_trading_hours() … SELECT true` → 盤中 assertions（`post_close_only = true` 不可被 claim）→ `ROLLBACK`；分支 B 同法回 `false` → 盤外 assertions（可被 claim）→ `ROLLBACK`；結束後重新驗證 `is_tw_trading_hours` 兩個 hash 回到 invariant 值。每分支起訖 assert `current_database() = 'bsr_ephemeral'`、`inet_server_addr() IS NULL`、port 為 ephemeral port，並以 branch counter assert A=1、B=1，任一為 0 → `TEST_EXIT` 非 0。production 零寫入（腳本已 `unset PG*`）。

## 6. Deterministic negative controls

- **SQL（`scripts/ephemeral-pg.sh`）**
  - `--drift-control claim-order`：final `ORDER BY p.bucket DESC` 變體 → T1 必然 FAIL（exit != 0）。
  - `--drift-control claim-dedupe`：`normal` 移除 `IS DISTINCT FROM` → T2 必然回 >1 token，必然 FAIL。
- **TS focused test**：`token_partition_test.ts` 只測 pure function `partitionTokenFirst`：
  - token-first：含 token 的陣列，輸出第 0 個為 token。
  - rest stable：非 token 相對順序不變、無重覆／遺漏。
  - 低 budget assignment-first：以 fake clock 模擬 `budgetMs` 早退的 shared-idx 迴圈，assert token 一定被指派（assignment），**不宣稱**可由 completion-order response 證明 assignment 順序。
  - 正向：`deno test --allow-env --no-check supabase/functions/tw-bsr-finmind-sync/token_partition_test.ts` → exit 0。
  - 負向：`BSR_PARTITION_IMPL=reversed …` 改用只存在於 test 檔內的反轉實作 → 必然 exit != 0（不進 `lib.ts`、不留檔案漂移）。

實際完成證據仍只由 §10 自然 evidence 提供。

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

**Response schema：完全不改**。既有欄位 `claimed`、`job_ids`、`jobs`（`{id, stock_id, trade_date, priority, outcome, rows_written, last_error}`）、`rows_written`、`jobs_quota_deferred` 全部保持原樣；不新增 `claimed_ids`、不新增 `token_first`。唯一副作用是 `jobOutcomes` 的填入時序，且該陣列本質為 completion order（最多 3 worker 併發），不可被解讀為 assignment 順序。

## 8. Scope、部署與 read-back

順序：local ephemeral SQL tests → `deno check supabase/functions/tw-bsr-finmind-sync/index.ts` → focused Deno test（正向 exit 0、負向 exit != 0）+ 既有 `lib_test.ts` 回歸 → **全綠才** production migration → **只部署 `tw-bsr-finmind-sync`**，不順帶改／部署其他 Edge。

Read-back 證明：`claim_bsr_queue_jobs` post 主／次 gate；其餘 8 個 Build 1e closure 函式的 md5(pg_get_functiondef) 與 baseline 逐字相同；12 個 relation sha256 不變；`is_tw_trading_hours` 兩個 invariant hash 不變；`admin_list_cron_jobs` 中 job 106/107 的 schedule/command 與變更前逐字相同；Edge 僅 `tw-bsr-finmind-sync` 有新版本。

## 9. Rollback（兩端）

- SQL：以 `CREATE OR REPLACE` 還原至 `md5(prosrc)=9b12fcc4eb311794423ddab603dbff8c` / `md5(pg_get_functiondef)=bf25e3deaefe24ee761e95e2e6d75391` 的舊定義（文本已於 read-only 取得並存於驗收紀錄），不觸及 GRANT/owner/proconfig。
- Edge：部署前記錄 `index.ts`、`lib.ts` 的 sha256 與當時部署版本號；回退＝還原這兩檔並只重新部署 `tw-bsr-finmind-sync`。

## 10. Gate（不放寬）

**A. Open-window liveness — 連續 3 輪自然輪次，每輪皆須**：
1. :02 recovery 恰 1 筆 audit 並發出 `tokened_job_id`；
2. 其後自然 :07 job107 回應的 `jobs[]` **包含**該 id（不要求位置、不得要求 `jobs[0]`）；
3. 該筆 per-job `rows_written > 0`；
4. `tw_chip_fact` 有相符 delta（該 stock_id + trade_date 新增列）。

「有明確 outcome」不計入 liveness。

**B. Exhausted-window safety — 至少 3 輪 future 自然輪次**：每輪 job107 HTTP 200、`jobs_quota_deferred > 0`、`rows_written = 0`、無非預期寫入。

A 或 B 任一不足 → **PENDING**。全程不手動觸發 worker/Edge/RPC、不改 cron、不 Publish。

**獨立 FAIL（不在本 gate）**：全市場 freshness（最新交易日 3.1%）屬 Build 2；Build 2 僅在 Build 1 自然 gate 通過後才討論。

**cron_edge_call caveat**：不修改（61/72 cron 共用，全域故障點）；關聯以 :07 分鐘唯一 dispatch（cardinality=1）時間對齊為 best-effort，證據等級 **UNKNOWN**，不作 gate 條件。

## 11. Material modified files（完整清單）

1. `supabase/migrations/20260812211500_bsr_claim_token_slot.sql`（新增）
2. `supabase/functions/tw-bsr-finmind-sync/lib.ts`（新增 2 export）
3. `supabase/functions/tw-bsr-finmind-sync/index.ts`（插入 `orderedJobs` + 3 處替換）
4. `supabase/functions/tw-bsr-finmind-sync/token_partition_test.ts`（新增，含 env 切換的反轉負向控制）
5. `supabase/tests/bsr_claim_token_slot_test.sql`（新增）
6. `supabase/tests/fixtures/bsr_claim_expected.tsv`（新增，pinned，執行階段唯讀）
7. `scripts/ephemeral-pg.sh`（載入新 test、queue DDL 子集 loader、`--drift-control claim-order|claim-dedupe`、T4 背景 session）
8. 回滾腳本文本（驗收紀錄，不進 repo）

**不改**：`bsr_slice_expected.tsv`、`bsr_slice_schema.sql`、`bsr_slice_functions.sql`、`scripts/bsr-slice-verify.sh`、`scripts/gen-bsr-slice-fixture.sh`、其他任何 Edge Function、cron、queue 資料、ACL。

## 12. 執行報告必列項目

1. production `claim_bsr_queue_jobs` pre/post 兩種 source hash 實測值（含主／次 gate 判定）。
2. Edge `tw-bsr-finmind-sync` 部署前後版本號與 `index.ts`/`lib.ts` sha256。
3. 所有 modified files 的實際 diff。
4. 每條 test command 與**真實 exit code**（不得以摘要代替）；negative controls 必須為 nonzero。
5. production 人為 DML = 0 的佐證。
6. 無 cron 變更、無 ACL 變更、無其他 Edge Function 變更的佐證。

任何一項失敗即停止並回報，**不得以 deployment 成功或 "Working" 冒充完成**。
