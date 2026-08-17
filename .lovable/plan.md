# Stage B Plan v2 — 停止對 terminal provider rejection 的無效重試（唯讀稽核完成，尚未 Apply）

數字皆為本輪唯讀查詢，時間戳 **2026-08-17 13:08–13:13 UTC（21:08–21:13 台北）**。Production 0 touch。

## 0. 真實基線（附查詢）

`select status, count(*) from tw_bsr_sync_queue group by 1`（13:08:32 UTC）

| 指標 | 值 |
|---|---|
| pending / running / failed / done | 77 / 0 / 1572 / 9956 |
| pending 中 `last_error='quota_deferred'` | **77（100%）** |
| 近 24h 新建 job | 66（`chips_prefetch_hourly:r1` 30、`:r3` 30、`tier1_first_fetch` 3、`tier1_holdings` 3） |
| 近 24h failed 簽章 | 24 筆 `finmind_http_400:{"msg":"Your level is register. Please upda…` |
| 現在可 claim | 14；最早 next_run_at 2026-08-17 12:58 UTC |
| tw_bsr_daily max(trade_date) | **2026-08-14** |
| tw_institutional_daily / daily_price_snapshots max(trade_date) | **2026-08-17**（正常） |

`tw_bsr_fetch_failures`（未 resolved）：`finmind_admission_daily_exhausted` 4447、`finmind_admission_rate_limited` 502、`register level` 400 共 47（最新 2026-08-17 11:07）、`finmind_admission_circuit_open:*` 77、其餘歷史。**`error_class` 全表 NULL**。

`tw_bsr_sync_config` key=`market_batch`（version 6, updated 2026-08-14 13:49 UTC）：
`supported=false`、`last_probe_outcome='unsupported'`、`last_probe_error='unsupported_plan:sponsor_level'`、`last_probe_at=2026-08-14T13:30Z`。

`system_kill_switches`：只有 `chips_all / chips_backfill / chips_interactive / chips_keepwarm`，語意皆為「停抓取／停 worker」→ **Stage B 不使用**（會讓 77 筆永不收斂）。

## 1. Exact call graph（cron jobid / schedule；24h runs 全 succeeded）

```text
[新 job admission — 全部 writer]
 45 tw-bsr-enqueue-post-close      30 7 * * 1-5     → cron_edge_call(tw-bsr-finmind-sync,{mode:enqueue,tier1})
 53 tw-bsr-enqueue-holdings-delta  0,30 7-12 * * 1-5→ 同上
      ↓ Edge enqueueTier1Holdings / Tier2Gaps / Tier3Backfill → enqueueBatch() index.ts L354-393（純 JS INSERT）
106 chips-prefetch-enqueue-hourly  2 * * * *        → SQL enqueue_chips_prefetch_gaps(10,300)  ← 24h 內 60/66 筆
  SQL writer（prosrc 含 INSERT INTO tw_bsr_sync_queue，全部 SECURITY DEFINER / owner=postgres / search_path=public）：
    converge_bsr_windows(p_max_stocks,p_chunk_dates,p_horizon_days)   ← cron 70 */30
    enqueue_all_active_tw_holdings_bsr(p_lookback_days)
    enqueue_bsr_backfill(p_stock_id,p_days)
    enqueue_bsr_first_fetch_on_trade()   ← TRIGGER（trade_records 寫入時）
    enqueue_chips_prefetch_gaps(p_lookback_days,p_max_stocks)
    ensure_bsr_queued(p_stock_id)
    ensure_bsr_window(p_stock_id,p_window_days,p_horizon_days)
    recover_quota_failed_bsr_jobs(p_max)
  ACL 現況：除 enqueue_chips_prefetch_gaps（僅 postgres/service_role）外，其餘皆對 anon/authenticated 開 EXECUTE。

[既有 job processing — 不得停]
 46 */10 6-12 * * 1-5 (batch30,p<=3)  51 */15 6-12 * * 1-5 (p<=1)
107 7 * * * * (ignore_window)          98 */10 * * * 6,0
 96 */10 reap_stale_bsr_queue_jobs(60) 67 30 13 * * 1 mode=probe（下次 2026-08-24 13:30 UTC）
      ↓ claim_bsr_queue_jobs（VOLATILE, attempts+1, SKIP LOCKED）
      ↓ processStock → FinMind
        ├ isQuotaRejection(err) = err.startsWith('finmind_admission_')  (lib.ts L50)
        │   → defer_bsr_job_quota(job,15~60m)：status=pending、**attempts-1**、last_error='quota_deferred'
        │     ← 無限循環根因：attempts 永不累積，77 筆永遠不會 failed
        └ 其他 → attempts>=max ? failed : pending+backoff
      ↓ recordFailure() upsert tw_bsr_fetch_failures(reason='finmind_error', last_error=**raw body**)，未寫 error_class
```

**根因鏈**：FinMind 一律 400 `register level` → admission circuit open → worker 全走 quota 分支 → attempts 抵銷 → 每小時無效重試，永久循環。

---

## 2. classifier：明確 predicate 與 precedence（`_shared/bsrProviderState.ts`）

`normalize(raw)` = lower + 去引號 + 非 `[a-z0-9_ ]` 轉空白 + 收斂空白。
`httpStatus(norm)` = `/http[_ ](\d{3})/`。

precedence（由上到下，第一個命中即回傳）：

| # | predicate | verdict |
|---|---|---|
| P0 | `persistedErrorClass = 'provider_plan_rejected'` | terminal / `provider_plan_rejected` |
| P1 | `TERMINAL_SIGNATURES` 命中 **且** (`status is null` 或 `400<=status<500`) | terminal / `provider_plan_rejected` |
| P2 | `status=429` 或 `/rate.?limit/` | retryable / `upstream_rate_limited` |
| P3 | `status>=500` | retryable / `upstream_5xx` |
| P4 | timeout/aborterror/deadline | retryable / `upstream_timeout` |
| P5 | network/econnreset/socket/dns/fetch failed | retryable / `upstream_network` |
| P6 | `^finmind_admission_` 前綴（新增） | `admission_deferred` / `quota_deferred`（**非** terminal、**非** provider-retryable） |
| P7 | 其他（含非簽章 400、bad json、未知） | unknown_degraded / `unclassified`，attempts<max 才可再試 |

`TERMINAL_SIGNATURES`（新增第 5 條以覆蓋 config 證據）：
`your level is register` / `please update your user level` / `sponsor level required` / `upgrade your (account|plan|level)` / **`^unsupported_plan[_ ]`**。

**`last_probe_error='unsupported_plan:sponsor_level'` 走 P1**：normalize 後為 `unsupported_plan sponsor_level`，命中新簽章，`status=null` → terminal `provider_plan_rejected`。這是唯一讓 config 能 terminalize 的路徑；不是靠字串比對 config 欄位。

**必測 negative（不得 terminal）**：
- `finmind_http_400:{"msg":"data not exists"}` → P7 unknown
- `finmind_http_400:{"msg":"params error"}` → P7 unknown
- `finmind_admission_circuit_open:pool=interactive` → **P6，單獨絕不 terminal**
- `market_batch.supported=false` 但 `last_probe_error` 為 null / `unknown` / 非字串 → classifier 回 unknown → **不 terminalize 任何 job**（gate 仍 fail-closed 關閉，見 §4）
- `http_500 ... your level is register`（5xx 內文含簽章）→ P3 retryable

worker 與 `tw-chips-detail-v2` 共用這一支；worker 不得自寫 regex（CI grep 守門）。

---

## 3. 持久化只寫 sanitized 值（回應第 5 點）

新增 `sanitizeUpstreamSignature(raw): string`（同檔，pure）：
1. 取 normalize 前的原字串，套 redaction：`/(token|api[_-]?key|authorization|password|secret)=[^&\s]+/gi → $1=[redacted]`；URL query 全刪 `/\?[^\s]*/g → ?[redacted]`；JWT-like `/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g → [redacted]`。
2. 只保留 allowlist 形狀：`finmind_http_<3digits>` / `finmind_admission_<word>` / `unsupported_plan:<word>` / 已知 msg 片語；不符者一律降級為 `unclassified`。
3. 長度上限 **200 字元**。

新寫入欄位（exact）：
- `tw_bsr_sync_queue.last_error` ← 只寫 normalized code（`provider_plan_rejected` / `quota_deferred` / `unclassified` / `upstream_5xx`…），不再寫 raw。
- `tw_bsr_fetch_failures.error_class` ← classifier code；`last_error` ← `sanitizeUpstreamSignature(raw)`（≤200）。
- `tw_bsr_attempt_logs.error_class` ← code；`error` ← sanitized signature。
- `tw_bsr_sync_config.market_batch.last_probe_error` ← sanitized signature；新增 `last_probe_error_class`。
- `audit_logs.detail` ← 只放 code / version / counts，不放 raw。
- client payload（v2）維持只回 enum + allowlist code（Stage A 已如此）。

歷史 raw row 不 bulk 改（依你的指示）。

---

## 4. 原子 gate：狀態、CAS、fail-closed（回應第 2、3 點）

### 4.1 gate 狀態存放
沿用 `tw_bsr_sync_config` row **key='market_batch'**（已有 `version` 欄位可做 CAS），新增三個 jsonb 欄位：
`admission_blocked (bool)`、`admission_blocked_reason ('provider_plan_rejected')`、`admission_blocked_at`、`admission_unblocked_by (uuid)`。

### 4.2 worker 遇 exact terminal → 原子關 gate（**這是 production DML，明列**）
新增 `private_bsr.block_admission(p_evidence_code text, p_expected_version int)`：
```sql
UPDATE public.tw_bsr_sync_config
   SET config = config || jsonb_build_object(
         'admission_blocked', true,
         'admission_blocked_reason', p_evidence_code,   -- 只接受 'provider_plan_rejected'
         'admission_blocked_at', now()),
       version = version + 1,
       updated_at = now()
 WHERE key = 'market_batch'
   AND version = p_expected_version            -- CAS，敗者不重試、不覆寫
   AND coalesce((config->>'admission_blocked')::bool,false) = false
RETURNING version;
```
- caller：worker，且**僅在 classifier 回 P0/P1 terminal 時**。P6/P7 一律不呼叫。
- 同一 transaction 內 `INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, detail)`：
  `actor_id=null`（system）、`action='bsr_admission_blocked'`、`target_type='tw_bsr_sync_config'`、`detail={evidence_code, from_version, to_version, stock_id, trade_date, correlation_id}`。
- rollback：`UPDATE ... SET config = config - 'admission_blocked' - 'admission_blocked_reason' - 'admission_blocked_at', version=version+1 WHERE key='market_batch'`。

### 4.3 fail-closed 讀取
`private_bsr.admission_open()`（STABLE）：row 缺失 / config 非 jsonb / `admission_blocked` 非 boolean → **回 false（擋新 job）**。
但 worker 端讀 config 失敗時，**只能把該 job 當 unknown_degraded 走有限重試**，不得 terminalize（明確 negative test）。

### 4.4 TOCTOU：gate 檢查與 INSERT 同一 transaction
新增單一入列 RPC `private_bsr.enqueue_jobs(p_jobs jsonb)`：
```
BEGIN (function body = single statement transaction)
  IF NOT admission_open() THEN RETURN 0;
  INSERT INTO tw_bsr_sync_queue (...) SELECT ... FROM jsonb_to_recordset(p_jobs)
    WHERE NOT EXISTS (pending/running dup) AND NOT EXISTS (tw_bsr_daily done)
  RETURNING count
```
gate 判斷與 INSERT 在同一 statement/transaction，無 TOCTOU 窗口。

**所有 writer 一律改走它**（不靠 JS check 當防線）：
| writer | 改法 |
|---|---|
| Edge `enqueueBatch()`（jobid 45/53、tier1_first_fetch、tier1_holdings、tier2_gaps、tier3_backfill、manual） | 移除 JS INSERT，改 `rpc('enqueue_jobs')` |
| `enqueue_chips_prefetch_gaps`（jobid 106） | CREATE OR REPLACE，INSERT 改呼叫 `private_bsr.enqueue_jobs` |
| `converge_bsr_windows`（jobid 70） | 同上 |
| `ensure_bsr_queued` / `ensure_bsr_window` | 同上 |
| `enqueue_bsr_backfill` / `enqueue_all_active_tw_holdings_bsr` | 同上 |
| `enqueue_bsr_first_fetch_on_trade`（trade_records TRIGGER） | 同上（trigger 不得因 gate 而 raise，只回 0） |
| `recover_quota_failed_bsr_jobs` | 同上（terminal 期間不得再造 recovery token） |

切點之後新 enqueue = 0；競態中已插入的舊 job 由 worker 逐筆 terminalize。

### 4.5 worker 對既有 pending 的處理（不停機）
quota 分支改為：`admission_blocked=true 且 reason='provider_plan_rejected'` → 不 defer，直接
`UPDATE tw_bsr_sync_queue SET status='failed', last_error='provider_plan_rejected', next_run_at=null, finished_at=now(), started_at=null WHERE id=$1`（schema 無 `blocked`，依指示用 `failed`）。
其餘情形維持現行 defer。unknown_degraded 有上限（attempts>=max_attempts → failed + `error_class='unclassified'`，可供 manual review 查詢）。
**無 bulk UPDATE/DELETE**；77 筆由自然 cron 逐輪單調下降至 0。

---

## 5. 恢復（B-4 重寫：不接受 caller-supplied success）

**取消** `bsr_admission_reopen(p_probe_result jsonb)`。改為：

1. 唯一入口 Edge `tw-bsr-finmind-sync?mode=admin_probe`（既有 function，新增 mode）。
2. **身分驗證在 Edge 內完成**：
   - 讀 `Authorization: Bearer <jwt>` → 以 **anon key client** 呼叫 `auth.getUser(jwt)` 取得已驗證 `user.id`（actor 不得由 body 提供）。
   - 以同一 user JWT client 呼叫 `has_role(user.id,'company_admin')`；false/未登入 → 401/403 直接結束，不做任何 DML。
3. probe **在 server 端實際執行**：對 FinMind 打單檔／單日請求，驗證 `HTTP 200` + `data` 為非空陣列 + schema validation（必要欄位 `date/stock_id/securities_trader/buy/sell` 型別檢查）+ 該回應時間戳為本次呼叫（無 replay 可能，因為 caller 不能提供 response）。
4. 通過才由 **service-role client** 呼叫 `private_bsr.unblock_admission(p_actor uuid, p_expected_version int, p_probe_fingerprint text)`：CAS `version = p_expected_version`，清 `admission_blocked`、寫 `last_probe_*`（sanitized）、同 transaction 寫 `audit_logs(actor_id=<verified uuid>, action='bsr_admission_unblocked', detail={probe_rows, probe_http, from_version, to_version, probe_fingerprint})`。
5. service-role 邊界：service-role client **只在通過 role 檢查之後**才建立／使用；`unblock_admission` 只 GRANT service_role。
6. 模糊 400 一律不解除；gate 解除後由既有 enqueue cron 自然重新入隊（不 bulk re-queue）。

**Negative tests（clone）**：無 Authorization → 401；一般 authenticated → 403 且 config version 不變；偽造 body 帶 `{"http":200,"rows":[...]}` → 被忽略（無此參數）；replay 舊 probe fingerprint → CAS/version 不符而拒絕；stale probe（`last_probe_at` 超過 10 分鐘）→ 拒絕。

---

## 6. 新增物件的 owner / search_path / ACL（回應第 4 點）

放在 **private schema `private_bsr`**（不對 PostgREST 暴露，Data API 不可見）：

| object | 類型 | owner | 設定 | ACL |
|---|---|---|---|---|
| `private_bsr.admission_open()` | STABLE, SECURITY DEFINER | postgres | `search_path=public, private_bsr` | REVOKE ALL FROM PUBLIC/anon/authenticated；GRANT EXECUTE TO service_role |
| `private_bsr.enqueue_jobs(jsonb)` | VOLATILE, SECURITY DEFINER | postgres | 同上 | 同上（另 GRANT 給需要它的既有 DEFINER function owner = postgres，本身即可呼叫） |
| `private_bsr.block_admission(text,int)` | VOLATILE, SECURITY DEFINER | postgres | 同上 | 同上 |
| `private_bsr.unblock_admission(uuid,int,text)` | VOLATILE, SECURITY DEFINER | postgres | 同上 | 同上 |

- 同一 transaction 內 `CREATE` + `REVOKE ALL ON FUNCTION ... FROM PUBLIC` + `GRANT ... TO service_role`，避免預設 PUBLIC EXECUTE 窗口。
- `REVOKE USAGE ON SCHEMA private_bsr FROM PUBLIC, anon, authenticated`。
- 不新增任何 public RPC；admin recovery 走 Edge，不暴露可被 authenticated 直接呼叫的 mutator。
- read-back：`select p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, p.provolatile, pg_get_userbyid(p.proowner), p.proconfig, p.proacl from pg_proc p join pg_namespace n ... where n.nspname='private_bsr'` + `has_function_privilege('anon',oid,'EXECUTE')` 對每支必為 false。
- clone rehearsal 必須以 anon / authenticated / 非 admin 身分實際 invoke 全部 4 支 → 全部拒絕。

---

## 7. A1 clone rehearsal（兩次全新 disposable clone，全項）

不只 classifier，兩次都要跑完：

1. classifier 全案例（terminal / 同 400 不同 body / 429 / 500 / timeout / network / unknown / admission_circuit_open / config unknown-malformed / 週末休市 / ineligible）。
2. **所有 enqueue caller**（上表 8 個 SQL writer + Edge 6 個 tag + trigger）在 gate 關閉時新增列 = 0；gate 開啟時正常入列。
3. **原子性**：併發 `enqueue_jobs` 與 `block_admission`，任一交錯順序皆不得產生「gate 已關但仍插入」的列。
4. **77 筆等價 pending**：載入等量 fixture，只跑自然 worker 迴圈 → 全部 pending→failed(`provider_plan_rejected`)，過程中 `quota_deferred` 新增 = 0，無 bulk DML。
5. unknown 有上限：attempts 到 max 後 failed，不無限 defer。
6. reopen：偽造/replay/stale/非 admin 全拒；真實 probe 成功才解除。
7. 再次 terminal：解除後 worker 再遇 exact 簽章 → 自動 CAS 關 gate（且 worker 未停）。
8. ACL / audit：§6 read-back 全綠；每次 block/unblock 都有一筆 audit row。
9. **rollback fingerprint（列查詢）**：
```sql
-- function body + owner + ACL + comment
select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' sig,
       md5(pg_get_functiondef(p.oid)) body_md5, pg_get_userbyid(p.proowner) owner,
       coalesce(p.proacl::text,'(default)') acl, coalesce(obj_description(p.oid,'pg_proc'),'') cmt,
       p.proconfig::text cfg
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private_bsr') order by 1;
-- config / data fingerprint
select key, version, md5(config::text) cfg_md5, updated_at from tw_bsr_sync_config order by key;
select status, count(*), md5(string_agg(id::text,',' order by id)) from tw_bsr_sync_queue group by 1 order by 1;
```
rollback 後上述三組輸出必須與 mutation 前 **byte-identical**。

---

## 8. Rollback（回應第 8 點）

Mutation **之前**先取得並保存：
- 每支要改的 Edge：現行 deployed function read-back（`supabase functions list` 版本 id + `Deno-Execution-Id` 探測）+ 可重部署的 source commit SHA + bundle artifact 存 `db/r1/c/SB/artifact/`。
- 每支要 CREATE OR REPLACE 的 SQL function：`pg_get_functiondef` **加** `pg_get_userbyid(proowner)`、`proacl`、`obj_description`、`proconfig`，全部寫入 `db/r1/c/SB/rollback/` 的 replay 腳本（含 `ALTER FUNCTION ... OWNER TO`、`REVOKE/GRANT`、`COMMENT ON`）。
- `tw_bsr_sync_config` 的 before row（key/version/config）。
- 新增物件：`DROP SCHEMA private_bsr CASCADE`。
- **實際做一次 side-by-side rollback rehearsal**（clone 上 apply → rollback → §7.9 fingerprint 比對一致），不只寫指令。

## 9. 自然 cron 證據鏈（回應第 9 點）

每一輪都要列齊，缺一不算：
```
cron.job_run_details.runid / start_time / status / return_message   (jobid 107)
  → net._http_response.id / status_code / left(content,200)         (pg_net，cron_edge_call 發出)
  → edge invocation: function_edge_logs m.execution_time_ms / m.deployment_id / timestamp / correlation_id
  → worker HTTP body: job_ids[] / jobs[].outcome
  → tw_bsr_sync_queue before/after: count by status + 該批 id 的 status/attempts/last_error
```
SQL dispatch succeeded ≠ worker delivered，必須有 pg_net status_code 與 edge invocation 才算。
至少 **3 次連續自然 :07 run**（jobid 107）；下次 **2026-08-17 14:07 UTC**，交易時段 jobid 46/51 下次 2026-08-18 06:00 UTC → 今晚未達 3 次者標 **PENDING**，不以人工 invoke 冒充（人工只作 smoke）。

## 10. A6 官方 pipeline 未受影響（回應第 10 點）

不看單一 max(trade_date)。以目前 Cloud holdings 的 normalized unique symbol universe 做分布：
```sql
with u as (  -- 台股持倉 normalized unique symbols
  select distinct regexp_replace(upper(symbol),'\.(TW|TWO)$','') sym
    from trade_records where status='open' and market in ('TW','TWSE','TPEX')
)
select
  count(*) universe,
  count(*) filter (where i.d = (select max(trade_date) from tw_institutional_daily)) inst_current,
  count(*) filter (where i.d is null) inst_missing,
  count(*) filter (where p.d = (select max(trade_date) from daily_price_snapshots)) px_current,
  count(*) filter (where p.d is null) px_missing
from u
left join lateral (select max(trade_date) d from tw_institutional_daily t where t.stock_id=u.sym) i on true
left join lateral (select max(trade_date) d from daily_price_snapshots s where s.stock_id=u.sym) p on true;
```
Apply 前後兩次執行，`inst_current` / `px_current` 不得下降、`*_missing` 不得上升；另列每檔 lag 天數分布（0/1/2/3+）。

## 11. 驗收矩陣

| # | 項目 | 通過條件 |
|---|---|---|
| A1 | clone rehearsal ×2 | §7 全 9 項 PASS；rollback fingerprint byte-identical |
| A2 | 新 enqueue | 切點後 24h `tw_bsr_sync_queue` 新增列 = 0（含全部 writer 與 trigger） |
| A3 | 既有 pending | 77 → 0 單調下降，全部經自然 cron；期間新增 `quota_deferred` = 0；無 bulk DML |
| A4 | 證據鏈 | §9 五段全對得上 |
| A5 | 連續 natural runs | ≥3 次 jobid 107；今晚不足即 PENDING |
| A6 | 官方 pipeline | §10 分布前後不退步 |
| A7 | fallback | 2308/2330 抽屜仍顯示 8/14 BSR 數值與圖表、8/17 法人、文案「上游來源中止」 |
| A8 | ACL | §6 read-back 全綠；anon/authenticated invoke 全拒 |
| A9 | 隔離 | 不碰舊 `tw-chips-detail`、frontend、無關 ACL/cron；不 Publish |

## 12. 誠實邊界

Stage B 的成功定義 = **停止無效重試 + 誠實顯示舊資料**。本輪 probe 已證實沒有合法免費的券商分點來源（FinMind plan 拒絕、TWSE/TPEx 無 BSR）。完成後 BSR 仍停在 **2026-08-14，不會恢復新鮮度**；真正新鮮 BSR 需合法／付費 provider。
未解 GAP：舊 `tw-chips-detail` 的 version/updated_at 無法由現有管理介面核實。

## 13. Stop points

1. 本 Plan 核准 → 只做 clone rehearsal ×2（production 0 touch），交 A1 全項證據後停。
2. A1 通過並取得核准 → staged deploy（private schema + writer 改造 + worker），交 A2/A3/A4 前兩輪證據後停。
3. A5 連續自然 runs 觀測完成 → 交最終 PASS/GAP。
