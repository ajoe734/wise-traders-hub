# Build 1f Final Plan — recovery token 公平名額 + dispatch 關聯

範圍只有兩件事：(1) 讓 recovery token job 真的有機會被自然 worker 領走；(2) 讓自然 job107 run 能可靠 join 到 HTTP request/response。不碰 Build 2、不建新表/新 queue/新 cron。

## 1. 為什麼 27146/27147/27152/27194/27197 五輪都沒被領（已查證）

證據來源與現況：

- Claim RPC：`public.claim_bsr_queue_jobs(_batch integer, _max_priority integer)`（production md5 `9b12fcc4eb311794423ddab603dbff8c`）。實際 body：
  - filters：`status='pending'`、`priority <= _max_priority`、`next_run_at <= now()`、`(NOT is_tw_trading_hours() OR post_close_only = false)`
  - 排序：`ORDER BY priority ASC, next_run_at ASC, id ASC`
  - 併發：`FOR UPDATE SKIP LOCKED LIMIT _batch`，接著 `UPDATE ... status='running', started_at=now(), attempts=attempts+1`
- 呼叫端：`supabase/functions/tw-bsr-finmind-sync/index.ts` → `runWorker()`（L443-535）。順序為 purge lease → degrade policy（`effectiveMaxPriority` / `allowClaim`）→ rate limit（`effectiveBatch = min(batch, remaining)`）→ market-batch snapshot → `claim_bsr_queue_jobs`。job107 傳 `batch=30, max_priority=3, ignore_window=true`。
- 根因（純排序飢餓，非閘門擋住）：
  - 5 個 token job 全是 `priority=2`、`post_close_only=true`、`attempts=5`、`max_attempts=6`、`enqueued_by='tier2_gaps:c07446b0'`（2026-08-07 enqueue）。
  - recovery 把 `next_run_at = now()`（16:02/17:02/18:02/19:02/20:02），因此在 `next_run_at ASC` 下排在**整個 due 佇列最尾端**。
  - 目前 84 筆 due 全部是 `priority=2 / post_close_only=true`，最舊 `next_run_at` 為 13:21；每輪只領 30 筆，且每小時 job106 會再灌入新 gap job，佇列頭永遠不空 → token job 永遠排不到。
  - 不是 max_priority（3 ≥ 2）、不是 post_close_only（job107 在非交易時段跑）、不是 attempts 上限、不是 quota（open window 5 輪 `quota_deferred=0`）。
- 與 42xxx/45xxx 新 job 的欄位差異：token job 的 `attempts=5/max_attempts=6`、trade_date 為 2026-08-07（較舊）、`last_error='quota_recovery_token'`；新 job `attempts=1/max_attempts=5`、`last_error='quota_deferred'` 或 NULL、trade_date 2026-08-11/12。唯一可靠識別鍵是 `last_error='quota_recovery_token'`（由 `recover_quota_failed_bsr_jobs` 設定）。

Request 關聯現況：

- `public.cron_edge_call(fn_name, body, timeout_ms)` 只 `SELECT net.http_post(...) INTO v_req_id; RETURN v_req_id;`，**沒有寫入** `cron_dispatch_log` → 該表 0 筆（已查證），runbook `docs/runbooks/chips-lanes.md:39` 卻假設有資料。
- `public.cron_dispatch_log(id, jobname, request_id, dispatched_at)` 早已存在（migration `20260725083012_...`），且舊 lane wrapper（`20260725083405`、`20260726110032`）已有 `INSERT INTO public.cron_dispatch_log(jobname, request_id)` 的既有寫法可直接沿用 → **可重用，不需新表**。
- `net._http_response.id = net.http_post` 回傳的 request_id，因此補上 dispatch insert 後即可 `cron_dispatch_log.request_id = net._http_response.id` 精確 join。保留期仍受 pg_net 約束（實測約 6 小時）→ 列為 caveat。
- BSR worker 回應目前沒有 `run_id` 欄位（`rg run_id` 於 index.ts 無命中）→ 不在本 Plan 擴張範圍，UNKNOWN/caveat。

## 2. 變更內容（最小集合）

### 2.1 Migration A — `CREATE OR REPLACE FUNCTION public.claim_bsr_queue_jobs(integer, integer)`

簽章不變、回傳型別不變、呼叫端不需改。

Before（邏輯）：

```text
picked = SELECT id FROM queue
         WHERE status='pending' AND priority<=_max_priority
           AND next_run_at<=now() AND (NOT in_hours OR post_close_only=false)
         ORDER BY priority, next_run_at, id
         FOR UPDATE SKIP LOCKED LIMIT _batch
UPDATE picked -> running
```

After（邏輯）：

```text
base = 同一組 WHERE（完全不動：status/due/max_priority/trading-window）

token_slot = SELECT id FROM base
             WHERE last_error='quota_recovery_token'
             ORDER BY next_run_at ASC, id ASC          -- 最老的 token
             FOR UPDATE SKIP LOCKED LIMIT LEAST(1, _batch)

normal = SELECT id FROM base
         WHERE id NOT IN (token_slot)
         ORDER BY priority ASC, next_run_at ASC, id ASC   -- 既有 ordering 原封不動
         FOR UPDATE SKIP LOCKED LIMIT (_batch - count(token_slot))

picked = token_slot UNION ALL normal
UPDATE picked -> running, started_at=now(), attempts=attempts+1
```

要點：

- token 名額**永遠最多 1**，其餘名額完全沿用既有排序 → 沒有 fresh job starvation（30 筆變 1+29）。
- token job 走**同一個 base CTE**，因此 status/due/max_priority/post_close_only 全部照舊；quota / kill-switch / degrade / eligibility 都在 `runWorker` 的 claim 之前與 `processStock` 的 admission gate 中，位置不變。
- 沒有新增欄位、沒有新表、沒有新 cron。

### 2.2 Migration B — `CREATE OR REPLACE FUNCTION public.cron_edge_call(text, jsonb, integer)`

只在 `RETURN v_req_id` 前加一行既有樣式的 insert：

```sql
INSERT INTO public.cron_dispatch_log(jobname, request_id) VALUES (fn_name, v_req_id);
```

不改 URL、header、timeout、回傳值、SECURITY 屬性、search_path。影響面是所有用 `cron_edge_call` 的 cron job，但只多一筆 log row。

### 2.3 Edge Function

**不需要改動** `supabase/functions/tw-bsr-finmind-sync/index.ts`。回應 body 既有的 `job_ids[]` / `jobs[]` / `rows_written` 已足以證明 token job 被領。→ 不 deploy。

## 3. Race / atomicity / 邊界行為

- 兩個 worker 併發：token slot 與 normal 都在**同一個 statement 的 CTE** 內 `FOR UPDATE SKIP LOCKED`，A 鎖到的 token 對 B 直接跳過，B 會拿到第二老的 token（或沒有）。UPDATE 只作用在已鎖定的 id → 不可能重複 claim。
- `_batch = 1`：`LEAST(1,_batch)=1`，若有 token 則該輪只跑 token；normal 名額 0。可接受（job107 是 30）。
- `_batch = 30`：1 token + 29 normal；沒有 token 時 30 normal，結果與現況逐筆相同。
- 無 token：token CTE 空集合，normal LIMIT 回到 `_batch` → **行為與現在完全一致**。
- token priority > `_max_priority`、`next_run_at > now()`、trading-window 被 `post_close_only` 擋：token 不在 base 中，直接沒有 slot，不繞門。
- quota exhausted：claim 照樣發生，但 `processStock` 的 admission gate 會回 `finmind_admission_*` → 該 token job 回到 failed/deferred，下一輪 recovery 可再處理。這是既有語意，不變。
- degrade `claim_halt`：在 claim 之前就 return，token 完全不受影響。

## 4. 回歸邊界（不得破壞）

- 正常吞吐：每輪 `processed` 由 30 變成「1 token + 29 normal」；無 token 時仍為 30。
- quota safe no-op：`jobs_quota_deferred` 路徑不變，HTTP 仍 200。
- 每輪 recovery 仍最多 1 reconcile + 1 token（`recover_quota_failed_bsr_jobs` body **不動**）。
- Build 1c ACL：兩個 `CREATE OR REPLACE` 會重設 grants → migration 尾端必須重申既有 ACL（`REVOKE ALL ... FROM PUBLIC, anon, authenticated`，僅保留現行 grantee），並在驗收時 read-back 比對。
- Build 1e 本地 harness：`claim_bsr_queue_jobs` **不在** 9+12 pinned closure 內（closure 為 recovery/budget/metrics 相關），故 baseline 不需變更；驗收時仍要跑一次 `verify` 證明 9 functions md5 與 12 relations fingerprint 全部未變。`cron_edge_call` 同樣不在 closure 內。

## 5. Focused tests 與 negative controls（本機，不碰 production）

在既有 ephemeral slice harness 之外，新增一支只針對 claim 的本機測試（`supabase/tests/bsr_claim_token_slot_test.sql`，全程 ROLLBACK）：

1. T1 token 真的被領：due token + 40 筆較老 normal，`_batch=30` → 回傳集合含該 token，且共 30 筆。
2. T2 無 token 等價：同資料但無 token → 回傳 id 序列與舊版函式逐筆相同。
3. T3 不繞門：token `next_run_at` 未到 / `priority > _max_priority` / trading-window 被擋 → 三個 subcase 都不得出現 token。
4. T4 併發不重複：兩個 session 各 claim 一次（第一個 session 未 commit），第二個不得拿到同一 token id。
5. T5 `_batch=1`：只回 token；再跑一次（token 已 running）→ 回 normal。
6. Negative control：把 token slot CTE 拿掉的變體函式載入後，T1/T5 必須 **exit != 0**（測試本身有效）。
7. `bunx tsgo --noEmit`（前端型別）與 `deno check` edge function（本輪未改 TS，僅作回歸）。

## 6. 實作後 acceptance（全部自然，不手動觸發）

不得手動 invoke job106/job107/worker/Edge/RPC/net.http_post。

- Read-back：`pg_proc` 取 `claim_bsr_queue_jobs(integer,integer)` 與 `cron_edge_call(text,jsonb,integer)` 的 prosrc/md5 與 ACL，證明只有這兩個函式改變；`recover_quota_failed_bsr_jobs` / `bsr_recovery_budget` / metrics 函式 md5 不變。
- Production write delta：明列本輪只有兩個 `CREATE OR REPLACE`（DDL）與 cron 自然產生的 row，人為 DML = 0。
- Open-window liveness（至少 3 輪自然 :02/:07）：某輪 audit 的 `tokened_job_id` → 其後自然 job107 的 `jobs[]` 含該 id → 該 job `rows_written > 0` → `tw_chip_fact` 在該 window 有對應 `stock_id/trade_date` 新列。列 runid / `cron_dispatch_log.request_id` / `net._http_response.id` / HTTP status / rows_written / fact delta。
- Exhausted window（至少 3 輪自然）：完整保留 HTTP 200 safe no-op body（`jobs_quota_deferred > 0, rows_written = 0`）。因 pg_net 保留期約 6 小時，證據需在 6 小時內回讀，否則標 UNKNOWN。
- 三輪任一缺口 → 標 **PENDING**，不得補手動觸發。

## 7. 仍然獨立 FAIL 的項目

全市場 freshness coverage 維持 **FAIL**：最新交易日 63/2022 = 3.1%、前一日 721/2022 = 35.7%、failed backlog 1,713、oldest ready 132.5h。修好 1 個 token slot **不等於** 所有使用者資料最新鮮，也不構成進入 Build 2 的理由。

## 8. 風險與 rollback point

| 風險 | 影響 | 緩解 / rollback |
|---|---|---|
| claim 改寫造成語意漂移 | 吞吐或排序異常 | 保留舊 prosrc 全文；rollback = 用原 md5 `9b12fcc4...` 的 body 再 `CREATE OR REPLACE` 一次，簽章不變、不需 deploy |
| `CREATE OR REPLACE` 重設 ACL | Build 1c 收斂被回吐 | 同 migration 內重申 REVOKE/GRANT，並在 acceptance read-back 驗證 |
| `cron_edge_call` 加 insert 拖慢或失敗 | 所有 cron 受影響 | insert 為單列、無外鍵；rollback = 還原不含 insert 的 body |
| token job 反覆失敗吃掉名額 | 每輪浪費 1 個名額 | `max_attempts` 上限與 recovery 的 `max_attempts < 8` 條件仍在，會自然停止 |
| pg_net 保留期 | 舊 window 無 HTTP body | 6 小時內回讀，逾期標 UNKNOWN（非阻塞 caveat） |

Rollback point：兩個函式的 pre-change prosrc 全文（在執行 migration 前先讀出並記錄於 acceptance 報告）。除此之外沒有 schema/資料變更，回滾成本為單次 `CREATE OR REPLACE`。
