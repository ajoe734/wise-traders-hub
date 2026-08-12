# Build 1b — Recovery Liveness / Backlog Metric / Degrade 自癒（Final Plan v4）

範圍嚴格限定 **recovery liveness、backlog 指標誠實化、degrade 自癒**。
不做 Lane A/B、cursor、job70、UI、coverage、其他 pipeline。**Build 2 需第二次批准。**

---

## 0. Production 查證（全部 read-only 實讀）

### 0.1 現行 signature 與 enqueue 呼叫

```sql
public.bsr_recovery_budget(p_full_budget integer)   -> jsonb   -- 已是 jsonb
public.recover_quota_failed_bsr_jobs(p_max integer) -> jsonb
public.bsr_backlog_metrics                           -- 不存在
```

`enqueue_chips_prefetch_gaps(int DEFAULT 10, int DEFAULT 300)` 實際片段：

```sql
  v_recover := public.recover_stale_bsr_queue_jobs();
  v_bp := public.bsr_recovery_budget(12);
  v_quota_recover := public.recover_quota_failed_bsr_jobs((v_bp->>'budget')::int);
```

→ ① **型別已相容，enqueue 不需改**。② recover **無條件被呼叫**（budget=0 也執行）→
零 budget 的 audit 由 recover 自己寫，**責任單一、不重複、不需擴充 enqueue**。
`bsr_recovery_budget` 與新的 `bsr_backlog_metrics` **維持純唯讀，絕不寫 log**。

### 0.2 claim 的 NULL 真語意（決定：不使用 COALESCE）

`claim_bsr_queue_jobs`：`WHERE status='pending' AND priority<=_max_priority AND next_run_at <= now() AND (NOT in_hours OR post_close_only=false) ORDER BY priority, next_run_at, id`
→ **NULL 永不被 claim**。metrics 與 degrade signal 一律用 `next_run_at IS NOT NULL AND next_run_at <= now()`，
`due_since = next_run_at`，`original age = enqueued_at`；NULL pending 另立 `unclaimable_null_count`（**實測 0**）。

### 0.3 `tw_bsr_sync_queue` 真欄位與 status 合約

```text
id, stock_id, trade_date, priority(smallint CHECK IN 1,2,3), status(text),
attempts int d0, max_attempts int d5, next_run_at, last_success_at, last_error,
enqueued_by, enqueued_at, started_at, finished_at, created_at, updated_at,
correlation_id uuid, post_close_only bool d false
CHECK status IN ('pending','running','done','failed','skipped')
```
現況：done 9,422 / failed 1,728 / pending 226。**無 completed_at、無 locked 欄位、無 rows_written 欄位。**

成功 done 樣本（id 45323）：`status=done, last_error=NULL, started_at, finished_at, last_success_at=finished_at, attempts=4`。
failed 樣本（id 42452）：`started_at=NULL, finished_at=<失敗時刻>, last_error='finmind_admission_daily_exhausted:pool=interactive', attempts=5`。

### 0.4 backfill_worker 既有 metadata（無 rows_written）

```json
{"run_id":"...","run_status":"done","trigger_source":"cron-hourly",
 "results":[{"job_id":1005,"status":"done","code":null,"failed_date":null,"checkpoint_reason":null}],
 "call_budget":8,"calls_spent":3,"attempt_budget":30,"actual_http_attempts":3, ...}
```
→ **本 Build 不改 worker log metadata**。驗收採三段 join：
`recovery audit job_ids` → `worker HTTP response jobs[].rows_written` → `tw_chip_fact` 前後 delta。
明文禁止宣稱「DB log 單獨可證明 rows_written」。

### 0.5 `data_source_refresh_logs` 寫入合法性

欄位 `id/source_key/triggered_by/status/started_at/finished_at/duration_ms/row_count/error_message/metadata/created_at`；
CHECK `status IN ('running','success','error','partial','skipped','done','failed')`；
FK `triggered_by -> auth.users(id)`（**一律 NULL**）；ACL：`service_role`/`postgres` = `arwdDxtm`；
RLS 讀取限 company_admin / 本人。既有 source_key：`backfill_worker`(207)、`tw_keep_warm`(32)、`backfill_gap_orchestrator`(8)、`tw_trading_calendar_catchup`(13)。

### 0.6 degrade reason 是一級欄位

`bsr_get_degrade_state()` → `{mode:'tier3_paused', reason:'p1_stalled', trigger_metric:'p1_oldest_sec', trigger_value:4811, since, cooldown_until, last_transition_at}`；
`tw_bsr_degrade_events` 含 `from_mode,to_mode,reason,trigger_metric,trigger_value,threshold,detail`。**gate 可依 reason 分流，無需新 schema。**

### 0.7 quota pools 實況

| pool | tokens | capacity | used_today | daily_budget | last_reject_reason |
|---|---|---|---|---|---|
| interactive (p1) | 197.07 | 240 | **240** | 240 | daily_exhausted |
| keepwarm (p2) | 68.06 | 240 | **702** | 384 | daily_exhausted |
| backfill (p3) | 237.01 | 240 | 85 | 600 | null |

pool routing 為 priority 純函式（`p<=1→interactive, 2→keepwarm, else→backfill`），
唯一跨池是 interactive 借 keepwarm（需 keepwarm tokens ≥30% capacity）。**不改 routing、不改 priority、不繞配額。**

### 0.8 cohort 分類（set-based 實測，非取樣）

`status='failed' AND last_error LIKE 'finmind_admission_%'` = **1,728**

| 類別 | 筆數 |
|---|---|
| satisfied（同 stock/date 已有 `tw_chip_fact`） | **85** |
| no fact | **1,643**（`tw_bsr_daily` 亦無：has_daily_no_fact = 0） |
| 其中 `trade_date = expected_latest_bsr_date()`（=2026-08-12） | **0** |
| 其中近 10 日曆天且 fact 端 have5 < 5 | **1,052** |
| priority 分布（no fact） | p1 = 52、p2 = 1,591、p3 = 0 |

日期分布（no fact）：`08-11:3, 08-10:1, 08-07:572, 08-06:124, 08-05:315, 08-04:267, 08-03:139, 07-31:37, 07-28:59, 07-10:31, 06-29..23:5, 06-19:31, 05-01:30, 04-06:29`。

**關鍵：整個 cohort 沒有任何一筆落在 `expected_latest_bsr_date()`。**

> 前一版一個「cohort 是否在 `chips_prefetch_targets`」的查詢，因欄位名為 `code`（非 `stock_id`）
> 導致相關子查詢退化，結果無效、已作廢；本 Build 不依賴該表（僅 20 列 demo 名單）。

### 0.9 分類效能實測（回應 #1）

| 寫法 | 實測 |
|---|---|
| 以 `tw_bsr_daily` 110 日視窗（等同 `compute_bsr_series_readiness` 全量展開） | **13,244 ms**（external merge 58 MB） |
| 以 `tw_bsr_daily` 10 日視窗 | **1,484 ms**（external merge 21 MB） |
| 以 `tw_chip_fact` 10 日視窗（每 stock/date 一組，10 日內 5,221 組） | 秒級以下，且 fact-exists 子查詢為 `idx_tw_chip_fact_lookup` Index Only Scan（1,728 loops、shared hit 5,210） |

job106 近四次 duration：**20.58 / 12.46 / 7.54 / 15.28 s**；`statement_timeout = 120000 ms`；
job107 的 `cron_edge_call(..., 120000)`。

**設計決定（避免 N+1，且不假冒全量）**：
- **禁止**在 recovery 內對 1,643 筆逐 row 呼叫 `compute_bsr_series_readiness`（plpgsql、110 日視窗、STABLE，1,000+ 次必然逼近 timeout）。
- **exact 全量**只算 index-friendly 的三個數：`legacy_quota_failed_total`、`satisfied_reconcilable`（fact EXISTS）、`by trade_date bucket`。
- **readiness 型的 `actionable_still_required`**：以 **set-based CTE over `tw_chip_fact`（10 日視窗、單次 GROUP BY）** 計算，
  語意等價於 `ready5`（門檻 `have5 >= 5`），**不呼叫該 plpgsql 函式**。
- **Performance contract（測試強制）**：`bsr_backlog_metrics()` 與 recover 的分類段合計
  **p95 ≤ 2,000 ms**、單次 ≤ 5,000 ms；測試以 `EXPLAIN (ANALYZE)` 斷言不得出現
  `tw_bsr_daily` 的 110 日掃描。若實測超過 5,000 ms，**自動降級**為：
  exact totals（上述三數）+ **inspected classification 僅限 200 筆候選**，
  且 audit 明確以兩組欄位分開（`totals_exact` vs `inspected_classification`），
  **絕不把 sample 當全量**。Build 1b 自然 run 的 job106 duration 必須維持在既有區間（≤ 30 s，遠低於 120 s timeout）。

---

## 1. 分類與選取（產品目標優先，不燒配額補死債）

| 分類 | 定義 | 處置 |
|---|---|---|
| **satisfied_reconcilable** | 同 stock/date 已有 `tw_chip_fact`（85） | **terminal reconcile**（§2），每輪 cap 1，**不呼叫 API、不算 liveness** |
| **actionable_still_required** | 無 fact **且**（`trade_date = expected_latest_bsr_date()` **或** 近 10 日內且該 stock 的 fact 端 `have5 < 5`） | **唯一**可發 recovery token 的來源 |
| **obsolete_retained** | 無 fact 且不屬上列 | **不重試、不 mass 改狀態**，維持 `status='failed'`（UI/readiness 只讀 `tw_bsr_daily`/`tw_chip_fact`，改動無收益有風險），僅在指標中計數 |

類內排序：**`trade_date DESC`（最新完整日優先），同日 `enqueued_at ASC`**。

---

## 2. Terminal reconcile 的精確語意（回應 #2）

只在 **同 stock/date 已存在 `tw_chip_fact`** 時執行，單筆 cap，與 audit **同一 transaction**：

```sql
WITH pick AS (
  SELECT q.id FROM public.tw_bsr_sync_queue q
   WHERE q.status='failed' AND q.last_error LIKE 'finmind_admission_%'
     AND EXISTS (SELECT 1 FROM public.tw_chip_fact f
                  WHERE f.stock_id=q.stock_id AND f.trade_date=q.trade_date)
   ORDER BY q.trade_date DESC, q.enqueued_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1
)
UPDATE public.tw_bsr_sync_queue q
   SET status = 'done',
       last_error = 'reconciled_fact_exists',
       finished_at = now(),
       last_success_at = COALESCE(q.last_success_at, now()),
       updated_at = now()
  FROM pick WHERE q.id = pick.id
RETURNING q.id;
```

- **`done` 是合法且正確的 terminal status**（CHECK 允許；語意＝該 stock/date 的資料已具備）。
  `skipped` 保留給 `recover_stale_bsr_queue_jobs` 既有語意，不挪用。
- **`started_at` 不回填**（該 job 從未真的執行；failed 樣本本來就 `started_at=NULL`），
  `attempts` 不動，`next_run_at` 不動。`last_error` 借用為 terminal 標記（既有慣例：失敗字串放此欄），
  以 `reconciled_fact_exists` 明確可辨識，**不冒充抓取成功**。
- schema 無 rows/fetched 欄位 → **不捏造**；回補量一律看 `tw_chip_fact`。
- `FOR UPDATE SKIP LOCKED` + 單筆 cap；rollback 時整筆撤回，**不留半套 row**。

---

## 3. Gate 分層（依真 reason）

| 條件 | 分類 | budget |
|---|---|---|
| `check_kill_switch('chips_all')` = false | 絕對停 | 0，`kill_switch` |
| mode `claim_halt` / `p1_only` | 絕對停 | 0 |
| mode `tier2_paused`（usage≥90 / 429_streak） | 絕對停（真 upstream 保護） | 0 |
| `tier3_paused` + reason `usage_ge_80` | 降 cap | min(cap,1) |
| `tier3_paused` + reason **`p1_stalled`** | **不歸零** | 允許 liveness floor（§4 修根因） |
| `tier3_paused` + reason `reservation_stuck` | 絕對停 | 0 |
| pool reserve 未過（§5） | 禁發 token | 0，回 `next_admission_at` |
| `ready_pending_count > 600` | 降 cap | min(cap,1) |

**canary：token cap = 1 / invocation（跨 pool 合計，非每 pool 各 1）**。
terminal reconcile 另有 cap = 1/invocation，**不佔 token、不呼叫 API**。

---

## 4. p1_stalled 死鎖修法

`supabase/functions/tw-bsr-finmind-sync/index.ts` 的 `collectSignals` p1 查詢（現只過濾 `priority=1 AND status='pending'`）改為與 claim 對齊：

```text
priority=1 AND status='pending' AND next_run_at <= <now ISO>   -- NULL 不計入
ORDER BY enqueued_at ASC LIMIT 1
```

根因實證：id 45208/6515，`enqueued_at 07:00:03`、`next_run_at 10:38:04`、`last_error=quota_deferred`
→ 一筆被正確 defer 的 p1 讓訊號無限成長 → `tier3_paused(p1_stalled)` 永真 → budget 永 0。
`stepDownTarget('tier3_paused')` 的 `< 600` 閾值、`usage_ge_80/90`、`429_streak` **一律不動**。

Deno 測試：future defer 不計入 / due 計入 / NULL 不計入 / 全 defer → 訊號 0 且不得回 `p1_stalled` / `usagePct=92` 仍回 `tier2_paused`。

---

## 5. Pool reserve 與跨 pool 選取

```text
issue_ok(pool) := used_today + 1 <= daily_budget - DAILY_RESERVE
              AND floor(tokens)  >= BURST_RESERVE + 1
DAILY_RESERVE = 30, BURST_RESERVE = 30   （= worker batch 30，保住整整一輪既有 pending/持股）
```

- **interactive（p1）canary 期間一律不碰**（`pool_excluded_canary`）：它是使用者開抽屜的即時路徑，
  且 `finmind_quota_ledger` 無 job_id、7 天清理，無法可靠歸因 recovery 用量。canary 只驗 **keepwarm**。
- **bounded candidates inspected = 200**；依 §1 排序取出後 **按 pool 分組**；
  某 pool 不過 reserve **不阻塞整輪**，繼續評估其他可用 pool 的候選；
  被跳過者 **不改狀態、不標記**，下輪重新評估 → **不會永久遺忘**。
- 總 token cap 仍 **1/invocation**。
- reset 後自然順序：`finmind_admit_v2` 於 `reset_at < today_tw` 歸零 `used_today`（台北日界），
  worker 先消化既有 pending（優先權不變），recovery 需 daily 與 burst 皆有 30 餘量，
  結構上排在持股與既有 pending 之後。

---

## 6. `bsr_backlog_metrics()`（回應 #3、#5、#9）

```sql
CREATE OR REPLACE FUNCTION public.bsr_backlog_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ ... $$;
REVOKE ALL ON FUNCTION public.bsr_backlog_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bsr_backlog_metrics() TO service_role;
```

回傳：

```text
A ready       ready_pending_count / oldest_due_since_ts / oldest_due_since_h
              oldest_ready_enqueued_h / unclaimable_null_count
B deferred    deferred_count / next_ready_at / oldest_enqueued_age_h   (不受 defer 影響)
C cohort（四個獨立指標，不得互相冒充）
              legacy_quota_failed_total        -- 1,728，歷史帳，非「可回補債」
              satisfied_reconcilable           -- 85
              actionable_still_required        -- 唯一可發 token 的分母
              obsolete_retained                -- 保留為 failed，不要求降到 0
              counting_mode: 'exact' | 'exact_totals_plus_inspected'
D audit       tokens_issued_24h / reconciled_24h / last_budget_reason / last_next_admission_at
```

`bsr_recovery_budget` 改為呼叫本函式（單一定義來源）。**不新增表、不新增欄位。**
最小權限：兩個寫函式與本唯讀函式皆 `SET search_path = public`、`REVOKE ALL FROM PUBLIC`、
只 `GRANT EXECUTE TO service_role`（`bsr_recovery_budget` / `recover_quota_failed_bsr_jobs` 由
`enqueue_chips_prefetch_gaps`（SECURITY DEFINER）內部呼叫，不需對 anon/authenticated 開放）。
測試斷言：回傳 JSON 不含任何 user 欄位；`anon`/`authenticated` 無 EXECUTE。

**Backlog safety 判定只看 `actionable_still_required` 與 audit 漏斗**，
不要求 `obsolete_retained` 或 `legacy_quota_failed_total` 下降。

---

## 7. Audit 規格與原子性（回應 #4、#5、#6）

單一責任：**只有 `recover_quota_failed_bsr_jobs` 寫**。

- 開頭 `pg_try_advisory_xact_lock(<固定 key>)`：
  - 取得 → 同一 transaction 內完成「分類 → reconcile → token → audit insert」；
  - **取不到** → **不做任何 row 變更**，仍寫一筆 `status='skipped'`、`budget_reason='lock_contended'` 的 audit（零 row churn）。
  - 兩者都在同一 transaction，`audit insert` 失敗 → 整體 rollback（queue 不可能改了卻沒 trace）。
  - 技術限制說明：advisory **xact** lock 隨 transaction 自動釋放，因此「同一 transaction 完成」與
    「lock 失敗仍留 audit」可同時成立，不需替代方案。
- **exactly-once**：同一 invocation 只跑一次選取與一次 audit insert；
  `metadata.invocation_id` 為該 transaction 產生的 uuid，供對回 cron runid。

`source_key = 'bsr_quota_recovery'`；`status ∈ {success, skipped, error}`（皆為 CHECK 合法值）；
`triggered_by = NULL`；`row_count = tokens_issued`；`duration_ms` 記錄本函式耗時。

```json
{
  "invocation_id": "uuid",
  "budget_reason": "kill_switch|degrade_tier2_paused|degrade_reservation_stuck|pool_reserve_blocked|pool_daily_exhausted|lock_contended|cap_1|ok",
  "degrade": {"mode":"tier3_paused","reason":"p1_stalled","trigger_metric":"p1_oldest_sec","trigger_value":4811},
  "pools": [{"pool":"keepwarm","tokens":68,"used_today":702,"daily_budget":384,"issue_ok":false}],
  "pool_excluded": ["interactive"],
  "counting_mode": "exact",
  "totals_exact": {"legacy_quota_failed_total":1728,"satisfied_reconcilable":85,"obsolete_retained":591},
  "actionable_still_required": 1052,
  "candidates_inspected": 200,
  "selected": [], "tokened_job_ids": [], "reconciled_job_ids": [],
  "metrics_before": {...A/B/C...}, "metrics_after": {...A/B/C...},
  "next_admission_at": "2026-08-13T00:00:00+08:00",
  "classify_ms": 0, "total_ms": 0
}
```

**不得含任何 user 識別欄位。**

---

## 8. 精確變更清單與 SQL contract

| 物件 / 檔案 | 變更 | Rollback |
|---|---|---|
| `public.bsr_backlog_metrics()` → jsonb | **新增**（STABLE / SECURITY DEFINER / `SET search_path=public` / REVOKE PUBLIC / GRANT service_role） | `DROP FUNCTION` |
| `public.bsr_recovery_budget(integer)` → **jsonb（簽名回型不變）** | 改寫 body：§3 gate（讀 reason）、§5 reserve、改用 §6 指標；**必須續存 `budget` 鍵**（enqueue 用 `(v_bp->>'budget')::int`） | 反向 migration 還原舊 body |
| `public.recover_quota_failed_bsr_jobs(integer)` → **jsonb（不變）** | 改寫 body：advisory xact lock、§0.9 set-based 分類、§1 排序、§2 reconcile、token cap 1、§7 audit，全在同一 transaction | 反向 migration 還原舊 body |
| `public.enqueue_chips_prefetch_gaps` | **不改** | — |
| `_shared/bsrDegrade.ts` | **不改** | — |
| `tw-bsr-finmind-sync/index.ts` | `collectSignals` p1 加 `next_run_at <= now`（§4） | 還原並重新部署 |
| `supabase/tests/bsr_quota_recovery_test.sql` | 擴充：gate 矩陣、reserve 阻擋、cap=1、pool 不阻塞、reconcile 欄位正確且僅在 fact 存在時、lock 競爭仍寫 skipped audit 且零 churn、audit rollback 一致性、metadata 無 user 欄位 | 檔案還原 |
| `supabase/tests/bsr_backlog_metrics_test.sql` | **新增**：NULL/due/future 混合、defer 不假性歸零、C 四指標分開、grants（anon/authenticated 無 EXECUTE）、performance contract（EXPLAIN 不得出現 110 日 `tw_bsr_daily` 掃描、耗時上限） | 刪檔 |
| `tw-bsr-finmind-sync/degrade_signal_test.ts` | **新增**：§4 五案例 | 刪檔 |

**SQL contract（測試強制）**
- `bsr_recovery_budget(int)->jsonb` 必含 `budget`(int) 與 `budget_reason`。
- `recover_quota_failed_bsr_jobs(int)->jsonb` 必含 `tokens_issued`/`reconciled`/`budget_reason`/`invocation_id`/`counting_mode`。
- `enqueue_chips_prefetch_gaps(int,int)->jsonb` 的 `backpressure`/`quota_recovery` 鍵不得消失。
- `data_source_refresh_logs` 寫入 `source_key='bsr_quota_recovery'`、`status ∈ CHECK 集合`、`triggered_by IS NULL`。
- 三個函式 `proconfig` 必含 `search_path=public`；`proacl` 不得含 PUBLIC/anon/authenticated。

**不建立**：dashboard、endpoint、scheduler、control plane、新表、新欄位、新 config key、新 cron。

---

## 9. 自然驗收

### 9.1 Exhausted window（今日即可，3 輪 job106）
每輪 PASS 條件：
- `cron.job_run_details(jobid=106)` 的 **每個 runid 恰對應一筆** `source_key='bsr_quota_recovery'` audit
  （以 `started_at` 落在 run 區間 + `invocation_id` 唯一關聯）；**同一 run 不得出現重複 token 或重複 reconcile**；
- run duration **不超過既有區間（≤30 s）**，遠低於 `statement_timeout=120 s`；
- `tokens_issued = 0`、`budget_reason` 正確反映 pool/degrade；
- selected cohort 外 **零 row churn**（`updated_at` 差集為空）；
- kill switch 與 `tier2_paused` 保護未被繞過。

### 9.2 Open window（跨台北日界 reset，3 輪）
- 3 輪 **總 token ≤ 3**；
- **Liveness PASS** 需：至少 1 筆 **actionable_still_required 且原為 failed** 的 job，
  自然 token → claim → **worker HTTP response 該 job `rows_written > 0`** → **`tw_chip_fact` 前後 delta > 0**；
- fact EXISTS **只當 readiness 不當成功**（反例 job 45632：`done` 但 `rows_written=0`、fact 早存）。

### 9.3 沒有 actionable_still_required 時（明確定義）
> **判定 `PASS (no-op safe)`**，需全部滿足：
> ① 三輪 exhausted audit 全在且 `tokens_issued=0`；
> ② open window 三輪 audit 也在，`actionable_still_required=0` 有 set-based 據可查；
> ③ terminal reconcile 已自然處理 ≥1 筆 satisfied 且 **未呼叫任何 API**；
> ④ degrade 不再卡在 `p1_stalled`（§4 生效的自然證據）；
> ⑤ 零 row churn、零 mass update、audit exactly-once。
>
> 明確標示為「**未證明資料回補 liveness**」，不得宣稱回補成功。
> 歷史 failed 的逐步封存與「最新資料持續產生」由 **Build 2 的 lane** 負責。
> **絕不為了測試去抓 4 月資料。**

每輪列出：runid / duration / invocation_id / budget_reason / degrade reason / pools /
counting_mode / C 四指標 / selected / tokened / reconciled / worker jobs[] / rows_written / fact delta / A·B 指標。

---

## 10. Rollback

- 三個函式以反向 migration 還原舊 body；Edge Function 還原並重新部署 → 停止未來 audit。
- **已 terminalize 的 reconcile 與已寫入的 fact 不倒回**。
- **不刪除任何既有 `data_source_refresh_logs` 稽核紀錄。**

---

## 11. 批准範圍

Approve = **只執行 Build 1b**，完成 §9 跨 reset 自然驗收後**停下**。
**Build 2（Lane A/B、cursor、job70 等）仍未授權，需第二次明確批准。**
