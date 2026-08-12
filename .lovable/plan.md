# Build 1f Final Plan v2 — recovery token 公平名額（+ 關聯性 caveat）

範圍：(1) 讓 recovery token job 真的有機會被自然 worker 領走；(2) 關聯性只在能安全證明時才做，否則降為 caveat。不碰 Build 2、不建新表/新 queue/新 cron。

## 1. 根因（read-only 證據，已查證）

Claim RPC：`public.claim_bsr_queue_jobs(_batch integer, _max_priority integer)`，production md5 `9b12fcc4eb311794423ddab603dbff8c`。實際 body：

- filters：`status='pending'`、`priority <= _max_priority`、`next_run_at <= now()`、`(NOT public.is_tw_trading_hours() OR post_close_only = false)`
- 排序：`ORDER BY priority ASC, next_run_at ASC, id ASC`
- 併發：`FOR UPDATE SKIP LOCKED LIMIT _batch`，之後 `UPDATE ... status='running', started_at=now(), attempts=attempts+1 RETURNING q.*`

呼叫端：`supabase/functions/tw-bsr-finmind-sync/index.ts` → `runWorker()`（L443-535），job107 傳 `batch=30, max_priority=3, ignore_window=true`。

根因是**純排序飢餓**，不是任何閘門：

- 5 個 token job（27146/27147/27152/27194/27197）皆 `priority=2`、`post_close_only=true`、`attempts=5`、`max_attempts=6`、`last_error='quota_recovery_token'`、trade_date 2026-08-07。
- `recover_quota_failed_bsr_jobs` 把 `next_run_at = now()`（16:02…20:02），在 `next_run_at ASC` 下排到 due 佇列最尾。
- 目前 84 筆 due 全為 `priority=2 / post_close_only=true`，最舊 `next_run_at` 13:21；每輪只領 30，且 job106 每小時再灌新 gap job → 佇列頭永不空。
- 排除：max_priority（3 ≥ 2）、post_close_only（job107 在非交易時段）、attempts 上限、quota（open window 5 輪 `jobs_quota_deferred=0`）皆非原因。

與新 job 差異：token job `attempts=5/max_attempts=6`、trade_date 較舊、`last_error='quota_recovery_token'`；42xxx/45xxx 為 `attempts=1/max_attempts=5`、`last_error='quota_deferred'` 或 NULL。唯一可靠識別鍵是 `last_error='quota_recovery_token'`。

## 2. Migration A（唯一必做）— `CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(integer, integer)`

簽章、回傳型別、呼叫端皆不變。

### 完整 CTE pseudocode（可執行形狀）

```sql
DECLARE in_hours boolean := public.is_tw_trading_hours();
DECLARE v_batch int := GREATEST(COALESCE(_batch, 0), 0);   -- _batch<=0 -> 0，永不出現負 LIMIT
BEGIN
IF v_batch = 0 THEN RETURN; END IF;

RETURN QUERY
WITH base AS (                                  -- 與舊版逐字相同的可領集合
  SELECT id, priority, next_run_at, last_error
    FROM public.tw_bsr_sync_queue
   WHERE status = 'pending'
     AND priority <= _max_priority
     AND next_run_at <= now()
     AND (NOT in_hours OR post_close_only = false)
),
token_slot AS (                                 -- 最多 1 筆，最老的 recovery token
  SELECT q.id FROM public.tw_bsr_sync_queue q
   WHERE q.id IN (SELECT b.id FROM base b WHERE b.last_error = 'quota_recovery_token')
   ORDER BY q.next_run_at ASC, q.id ASC
   FOR UPDATE SKIP LOCKED
   LIMIT LEAST(1, v_batch)
),
normal AS (                                     -- 明確排除「全部」eligible token rows
  SELECT q.id FROM public.tw_bsr_sync_queue q
   WHERE q.id IN (SELECT b.id FROM base b
                   WHERE b.last_error IS DISTINCT FROM 'quota_recovery_token')
   ORDER BY q.priority ASC, q.next_run_at ASC, q.id ASC
   FOR UPDATE SKIP LOCKED
   LIMIT GREATEST(v_batch - (SELECT count(*) FROM token_slot), 0)
),
picked AS (SELECT id FROM token_slot UNION ALL SELECT id FROM normal)
UPDATE public.tw_bsr_sync_queue q
   SET status='running', started_at=now(), attempts=q.attempts+1
  FROM picked WHERE q.id = picked.id
RETURNING q.*;
END;
```

規格保證：

- **最多 1 token**：normal 用 `last_error IS DISTINCT FROM 'quota_recovery_token'` 排除**所有** eligible token（不是只排除被選中的那一筆），所以 token 只能從 `token_slot` 進來，上限 1。
- **無 eligible token 時等價舊版**：`token_slot` 為空 → normal 的過濾條件對 base 全集合成立（base 中沒有 token row），LIMIT 回到 `v_batch`，ORDER BY 與舊版逐字相同 → **選取集合與舊 query 相同**。
- `_batch <= 0` → 直接 return，`LEAST/GREATEST` 保證 LIMIT 永不為負。
- token 走同一組 base 條件，不繞過 status/due/max_priority/trading-window；quota / kill-switch / degrade / eligibility 全在 claim 之前（`runWorker`）與 `processStock` 的 admission gate，位置不變。

## 3. 併發語意（精確版）

承諾是：**每個 worker invocation 最多 1 個 token**，而不是全系統同時只有 1 個 token 在跑。

- 兩個併發 worker：各自的 `token_slot` 都 `FOR UPDATE SKIP LOCKED LIMIT 1`。A 鎖住最老 token，B 跳過它拿到第二老的 → **可以各領不同 token，但同一 id 絕不會被領兩次**（UPDATE 只作用在已鎖定的 id）。
- `_batch=1`：`LEAST(1,1)=1`，有 token 則該輪只跑 token；normal 名額 0。
- `_batch=30`：1 token + 29 normal；無 token 則 30 normal。
- token `priority > _max_priority` / `next_run_at > now()` / trading-window 被 `post_close_only` 擋 → 不在 base，沒有 slot，不繞門。
- quota exhausted：claim 照常，`processStock` admission gate 回 `finmind_admission_*`，token job 回到 failed/deferred，下輪 recovery 可再處理（既有語意）。
- degrade `claim_halt`：claim 之前就 return，token 不受影響。

## 4. ACL：逐函式重播 production actual，不套 Build 1c 規則

Build 1c 收斂的是 `recover_quota_failed_bsr_jobs` / `bsr_recovery_budget` / metrics 三支（catalog actual：`{postgres=X, service_role=X, sandbox_exec_*=X}`，無 anon/authenticated/PUBLIC）。本 Plan 的兩支**不適用**該規則。

Production actual（已讀 `pg_proc`）：

| function | owner | prosecdef | proconfig | proacl |
|---|---|---|---|---|
| `claim_bsr_queue_jobs(integer,integer)` | postgres | false | `search_path=public` | `{=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X, sandbox_exec_*=X}` |
| `cron_edge_call(text,jsonb,integer)` | postgres | true | `search_path=public` | `{=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X, sandbox_exec_*=X}` |

實際 caller：`claim_bsr_queue_jobs` 由 Edge worker 以 service_role `supa.rpc()` 呼叫；`cron_edge_call` 由 61 個 cron job（共 72 個 job）以 postgres 執行。

PostgreSQL 語意：`CREATE OR REPLACE FUNCTION` **保留現有 grants**（不會重置 proacl），也保留 owner；但 `SECURITY DEFINER`、`SET search_path`、volatility 若未在新定義中重寫就會**遺失**。因此：

- migration 內**不做任何 REVOKE/GRANT**（避免順手收斂或擴張 privilege surface）。
- 新定義必須逐字保留 `SECURITY INVOKER`（claim，即不寫 DEFINER）、`SET search_path = public`、`LANGUAGE plpgsql`、`VOLATILE`。
- acceptance 以 `pg_proc.proacl / prosecdef / proconfig / proowner` before-after diff 證明**完全相同**。

## 5. `cron_edge_call` 關聯性修改：降為 **caveat，本 Build 不做**

盤點（read-only）：

- 61/72 個 cron job 走 `cron_edge_call`，是全域共用點。
- `public.cron_dispatch_log(id bigint identity, jobname text NOT NULL, request_id bigint NULL, dispatched_at timestamptz NOT NULL default now())`；**RLS enabled**，唯一 policy 是 `authenticated + has_role(company_admin)` 的 SELECT；無 INSERT policy。grants：anon/authenticated/service_role 皆 `arwdDxtm`。owner postgres。
- 既有寫入者：三個 lane wrapper 函式（migrations `20260725083405`、`20260726110032`）有 `INSERT INTO public.cron_dispatch_log(jobname, request_id)` 的既有寫法；但表目前 **0 筆**（那些 wrapper 未在現行 cron 使用）。
- 風險判定：`cron_edge_call` 是 `SECURITY DEFINER` owned by postgres（table owner 亦為 postgres），理論上不受 RLS 阻擋；但沒有 INSERT policy、且此函式在 **每個 cron job 的同一 transaction** 內執行——任何 insert 失敗（未來 RLS FORCE、grant 變更、表被鎖、磁碟/序列問題）會讓 `net.http_post` 所在 transaction 一併 rollback，等於為了觀測性給 61 個 cron job 增加故障點。
- 依指令第 5 點：**無法在不擴張範圍的前提下安全證明** → 不改 `cron_edge_call`，Build 1f 只做公平性。關聯性列為非阻塞 caveat，未來若要做，必須以 `BEGIN ... EXCEPTION WHEN OTHERS THEN NULL` 包住 insert 並附帶 logging-failure 決策與 focused test（logging success / `request_id = net._http_response.id` / 回傳 bigint 不變 / permission failure 不影響 http_post）。

## 6. job107 runid → HTTP 的可靠 join 定義（現況：UNKNOWN）

正確 join 條件應為：

```text
cron.job_run_details(jobid=107) 的 [start_time, end_time]
  ⟶ cron_dispatch_log 中 jobname=<fn_name> 且 dispatched_at 落於該 window
  ⟶ 該 (jobname, window) cardinality 必須 exactly 1
  ⟶ request_id = net._http_response.id （exact join）
```

限制（已查證）：`cron_edge_call` 只收 **fn_name**，不知道 cron jobname。`tw-bsr-finmind-sync` 由 7 個 cron job 共用（45/46/51/53/67/98/107），因此 `cron_dispatch_log.jobname` 無法區分是哪個 cron job。分鐘位在實務上不重疊（:07 只有 107；46 是 */10、51 是 */15），但**不是 schema 保證**。

結論：在 `cron_dispatch_log` 未被寫入、且 jobname 僅為 fn_name 的情況下，runid→request_id 的關聯**標 UNKNOWN**，不宣稱 exact。acceptance 改用 timestamp 對齊（job107 start_time ↔ `net._http_response.created`，且該分鐘內 BSR worker 回應 cardinality=1 時才採信），並在報告中明示這是**近似對齊**。

## 7. Migration / 檔案 / 執行順序

- Migration（僅 1 個，由 migration 工具產生時間戳檔名，內容為單一 `CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(integer, integer)`）。單一 DDL statement，PostgreSQL DDL 為 transactional → **原子**，沒有中間狀態，因此不需拆 migration。
- 測試檔（新增，僅本機）：`supabase/tests/bsr_claim_token_slot_test.sql`。
- Edge Function：**不改、不 deploy**（`index.ts` 現有 `job_ids[]` / `jobs[]` / `rows_written` 已足夠）。
- 執行順序：讀出 pre-change prosrc/ACL 全文存檔 → 本機 ephemeral 測試（含 negative control）→ migration → read-back diff → 等自然排程。
- Rollback：`claim_bsr_queue_jobs` = 用 pre-change prosrc（md5 `9b12fcc4eb311794423ddab603dbff8c`）再 `CREATE OR REPLACE` 一次，簽章不變、不需 deploy。`cron_edge_call` 本輪**不動**，無需 rollback。

## 8. 回歸邊界

- 吞吐：每輪 `processed` 從 30 → 「1 token + 29 normal」；無 token 時仍 30。
- quota safe no-op：`jobs_quota_deferred` 路徑不變，HTTP 仍 200。
- 每輪 recovery 仍最多 1 reconcile + 1 token（`recover_quota_failed_bsr_jobs` body 不動，md5 須不變）。
- Build 1c ACL：三支函式 md5 與 proacl 皆不得變動（本 migration 不觸及）。
- Build 1e 9+12 pinned closure：`claim_bsr_queue_jobs` 與 `cron_edge_call` **都不在** closure 內，baseline 不需變更；仍要跑一次 `verify` 證明 9 functions md5 + 12 relations fingerprint 全部未變。

## 9. Focused tests 與 negative controls（本機 ephemeral，全程 ROLLBACK）

1. **T1 token 真的被領**：40 筆較老 normal + 1 筆 due token，`_batch=30` → 回傳含該 token，總數 30。
2. **T2 無 token 等價**（修正斷言）：同資料但無 token → 比對**選取集合**（`ORDER BY` 後應選的 id 集合）與 count，不比對 `RETURNING` 順序（UPDATE...RETURNING 無順序保證）；另加一條斷言驗證 Edge 的 `jobs[]` 建構不依賴 DB 回傳順序（`jobOutcomes` 由 `jobs` 陣列迭代產生，順序僅影響 body 排列，不影響任何判定）。
3. **T3 不繞門**：token `next_run_at` 未到 / `priority > _max_priority` / trading-window 被擋 → 三 subcase 皆不得出現 token。
4. **T4 併發（修正語意）**：session A claim（未 commit）持有最老 token → session B claim 必須（a）不含 A 的 token id，（b）可以拿到第二老的 token；斷言「單次 invocation 最多 1 token」，不是「全系統最多 1」。
5. **T5 `_batch=1`**：只回 token；再跑一次（token 已 running）→ 回 normal。
6. **T6 `_batch=0 / NULL / 負值`**：回空集合，無錯誤，無負 LIMIT。
7. **Negative control**：載入「移除 token_slot」與「normal 未排除全部 token」兩種變體 → T1/T5 與「最多 1 token」斷言必須 **exit != 0**。
8. `bunx tsgo --noEmit` 與 edge function `deno check`（本輪未改 TS，純回歸）。

## 10. Acceptance（全部自然，不手動觸發）

不得 invoke job106/job107/worker/Edge/RPC/net.http_post。

- **Read-back**：`claim_bsr_queue_jobs` 的 prosrc/md5 改變；`proowner / prosecdef / proconfig / proacl` before-after **完全相同**；`recover_quota_failed_bsr_jobs`、`bsr_recovery_budget`、metrics、`cron_edge_call` md5 與 ACL 全部不變。
- **Production write delta**：只有 1 個 `CREATE OR REPLACE`（DDL），人為 DML = 0。
- **Open-window liveness（至少 3 輪自然 :02/:07）**：
  - 某輪 audit `tokened_job_id` → 其後自然 job107 HTTP body 的 `jobs[]` 中該 id 存在，且**該筆 per-job `rows_written > 0`**（不是只看整批 total）。
  - fact attribution：`tw_chip_fact` **沒有 job_id 欄位**（欄位為 id/stock_id/trade_date/broker_id/broker_name/source/buy_shares/sell_shares/net_shares/avg_buy_price/avg_sell_price/raw/ingested_at）→ 只能以 `stock_id + trade_date`（取自該 job）且 `ingested_at` 落在該 job107 run window 來 join，並明示這是 **window 對齊而非 job_id 對齊（attribution UNKNOWN 的部分要標出）**。
  - 每輪列：cron runid、`net._http_response.id`、HTTP status、per-job rows_written、fact delta 列數與 stock_id/trade_date。
- **Exhausted window（至少 3 輪自然）**：保留完整 HTTP 200 safe no-op body（`jobs_quota_deferred > 0`、`rows_written = 0`）。pg_net 保留期約 6 小時，逾期標 UNKNOWN。
- 任一輪缺口 → **PENDING**，不得補手動觸發。

## 11. Gate 定義（修正）

- **Build 1 gate = scheduler configured + exhausted safety + recovery open-window liveness** 三項。三項全部通過（含三輪自然鏈）後，Build 1 natural gate 即可判 PASS，屆時才可以「討論」Build 2。
- **全市場 freshness coverage 是獨立指標，目前 FAIL**（最新交易日 63/2022 = 3.1%、前一日 721/2022 = 35.7%、failed backlog 1,713、oldest ready 132.5h）。它不計入 Build 1 gate，也不得因修好 1 個 token job 宣稱 freshness PASS；它是 Build 2 要解的目標。
- Build 2 目前仍未授權，且在三輪自然鏈通過前不進入。

## 12. 風險與 rollback point

| 風險 | 影響 | 緩解 / rollback |
|---|---|---|
| claim 改寫語意漂移 | 吞吐/排序異常 | T2/T6 等價測試；rollback = 還原 md5 `9b12fcc4...` 的 body |
| `CREATE OR REPLACE` 遺失 DEFINER/search_path | 權限或解析行為改變 | 新定義逐字保留 `SET search_path=public`、SECURITY INVOKER、VOLATILE；read-back diff |
| token job 反覆失敗吃掉 1 個名額 | 每輪浪費 1/30 吞吐 | `max_attempts` 與 recovery 的 `max_attempts < 8` 條件仍在，會自然停止 |
| 關聯性仍 UNKNOWN | 稽核只能 timestamp 近似 | 已降為 caveat，不為觀測性讓 61 個 cron 增加故障點 |
| pg_net 6 小時保留期 | 舊 window 無 body | 6 小時內回讀，逾期標 UNKNOWN |

Rollback point：執行 migration 前先讀出並記錄 `claim_bsr_queue_jobs` 的 pre-change prosrc 全文與 ACL 快照。除此之外無 schema/資料變更，回滾成本為單次 `CREATE OR REPLACE`。
