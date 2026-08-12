# Build 1b — Recovery Liveness / Backlog Metric / Degrade 自癒（Final Plan v3）

範圍嚴格限定 **recovery liveness、backlog 指標誠實化、degrade 自癒**。
不做 Lane A/B、cursor、job70、UI、coverage、其他 pipeline。**Build 2 需第二次批准。**

---

## 0. v3 新增查證（本回合實讀）

### 0.1 現行 signature 與 enqueue 呼叫（回應 #1、#2）

```sql
public.bsr_recovery_budget(p_full_budget integer)          -> jsonb   -- 已是 jsonb
public.recover_quota_failed_bsr_jobs(p_max integer)        -> jsonb
public.bsr_backlog_metrics                                  -- 不存在
```

`enqueue_chips_prefetch_gaps(p_lookback_days int DEFAULT 10, p_max_stocks int DEFAULT 300)` 實際片段：

```sql
  v_recover := public.recover_stale_bsr_queue_jobs();
  v_bp := public.bsr_recovery_budget(12);
  v_quota_recover := public.recover_quota_failed_bsr_jobs((v_bp->>'budget')::int);
  RETURN jsonb_build_object(..., 'backpressure', v_bp, 'quota_recovery', v_quota_recover);
```

**兩個結論**：
1. budget 已回 jsonb、enqueue 已用 `(v_bp->>'budget')::int` 取值 → **型別相容，enqueue 不需改**（v2 的隱憂解除，且已由 read-back 證明而非假設）。
2. `recover_quota_failed_bsr_jobs` 是 **無條件呼叫**（budget=0 時傳 0，仍然執行）→
   **零 budget 的 audit 由 recover 自己寫，責任單一，不需擴充 enqueue，也不會重複寫兩筆。**
   `bsr_recovery_budget` 與新的 `bsr_backlog_metrics` **維持純唯讀，絕不寫 log**。

### 0.2 claim 對 NULL 的真語意（回應 #4，現在就決定）

`claim_bsr_queue_jobs`：

```sql
WHERE status='pending' AND priority<=_max_priority
  AND next_run_at <= now()
  AND (NOT in_hours OR post_close_only = false)
ORDER BY priority ASC, next_run_at ASC, id ASC
```

`next_run_at <= now()` → **NULL 永遠不會被 claim**。
**決定：不使用 COALESCE。** metrics 與 degrade signal 一律採 `next_run_at IS NOT NULL AND next_run_at <= now()`，
與 claim 位元對齊；NULL pending 另立 `unclaimable_null_count`（**目前實測 0 筆**）當成孤兒告警指標，不當 ready。
`due_since = next_run_at`（明確 timestamp），`original age = enqueued_at`，兩者分開，不混用。

### 0.3 backfill_worker 既有 metadata 實際樣本（回應 #3）

```json
{"run_id":"b99620f1-...","run_status":"done","trigger_source":"cron-hourly",
 "results":[{"job_id":1005,"status":"done","code":null,"failed_date":null,"checkpoint_reason":null}, ...],
 "code_tally":{},"call_budget":8,"calls_spent":3,"logical_calls":3,
 "attempt_budget":30,"actual_http_attempts":3,"max_calls_per_run":10,"max_http_attempts_per_run":30}
```

**results[] 沒有 `rows_written`**。
→ **本 Build 不改 worker log metadata**（避免擴張範圍）。
→ 驗收採三段 join：`recovery audit 的 job_ids` → `worker HTTP response 的 jobs[].rows_written` → `tw_chip_fact` 前後 delta。
**明文禁止**宣稱「DB log 單獨可證明 rows_written」。

### 0.4 `data_source_refresh_logs` 寫入合法性（回應 #2、#9）

- 欄位：`id / source_key / triggered_by / status / started_at / finished_at / duration_ms / row_count / error_message / metadata / created_at`
- CHECK：`status IN ('running','success','error','partial','skipped','done','failed')`
- FK：`triggered_by -> auth.users(id)` → **一律留 NULL（系統來源，無 user 資料）**
- ACL：`service_role` / `postgres` 皆 `arwdDxtm`；RLS 讀取限 company_admin 或本人（`triggered_by` NULL 時等於只有 admin 可讀）
- 現有 source_key：`backfill_worker`(207)、`tw_keep_warm`(32)、`backfill_gap_orchestrator`(8)、`tw_trading_calendar_catchup`(13)

### 0.5 degrade reason 的真實來源（回應 #8）

`bsr_get_degrade_state()` 實回：

```json
{"mode":"tier3_paused","reason":"p1_stalled","trigger_metric":"p1_oldest_sec",
 "trigger_value":4811,"since":"...","cooldown_until":"...","last_transition_at":"..."}
```

`tw_bsr_degrade_events` 欄位含 `from_mode,to_mode,reason,trigger_metric,trigger_value,threshold,detail`。
→ **reason 是一級欄位，不是猜的**，gate 可依 reason 分流，不需新增任何 schema。

### 0.6 quota pools 實況（回應 #7）

| pool | tokens | capacity | used_today | daily_budget | last_reject_reason |
|---|---|---|---|---|---|
| interactive (p1) | 197.07 | 240 | **240** | 240 | daily_exhausted |
| keepwarm (p2) | 68.06 | 240 | **702** | 384 | daily_exhausted |
| backfill (p3) | 237.01 | 240 | 85 | 600 | null |

pool routing 為 priority 純函式：`p<=1→interactive, p=2→keepwarm, else→backfill`；
唯一跨池是 interactive 可向 keepwarm 借（且需 keepwarm tokens ≥30% capacity）。
**recovery 不改 priority、不改 routing、不繞配額。**

### 0.7 歷史 failed cohort 分類（回應 #5，決定性資料）

`status='failed' AND last_error LIKE 'finmind_admission_%'` 共 **1,728**：

| 分類 | 判定 | 筆數 |
|---|---|---|
| **A. already_has_fact** | 同 stock/date 已存在 `tw_chip_fact` | **85** |
| **B. no fact** | 無 fact（`tw_bsr_daily` 亦無，has_daily_no_fact = 0） | **1,643** |

B 依 trade_date（`expected_latest_bsr_date() = 2026-08-12`）：

```text
08-11: 3    08-10: 1    08-07: 572  08-06: 124  08-05: 315
08-04: 267  08-03: 139  07-31: 37   07-28: 59   07-10: 31
06-29..06-23: 5   06-19: 31   05-01: 30   04-06: 29
```

彙總：**expected_latest(08-12) = 0 筆**；近 5 個交易日 = 1,015；近 10 個交易日 = 1,458；更舊 = 185。
priority 分布（B）：p1 = 52、p2 = 1,591、p3 = 0。

**關鍵結論：整個 1,728 沒有任何一筆落在 `expected_latest_bsr_date()`。**
最新一批 08-07（572 筆）也已距今 3 個交易日。

> 註：本回合一個「cohort 是否落在 `chips_prefetch_targets`」的查詢因欄位名為 `code`（非 `stock_id`）
> 造成相關子查詢退化，結果 1,643 **無效、不採用**；Build 1b 的分類不依賴該表（僅 20 列 demo 名單）。

---

## 1. still_required 的定義（回應 #5，取代 v2 的 `ORDER BY enqueued_at ASC`）

v2 的「最舊優先」會拿配額去補 4 月的死債，**偏離產品目標，撤回。**

| 分類 | 定義（全用既有函式/表，不新增概念） | 處置 |
|---|---|---|
| **satisfied** | 同 stock/date 已有 `tw_chip_fact`（現 85 筆） | **terminal reconcile**：受 cap 每輪最多 1 筆，`status='failed' → 'done'`，`last_error='reconciled_fact_exists'`。**不呼叫 API、不發 token、不算 liveness** |
| **still_required** | 無 fact **且** `trade_date = expected_latest_bsr_date()`（**現 0 筆**）<br>**或** 無 fact 且 `trade_date` ∈ 近 5 個交易日 **且** 該 stock `compute_bsr_series_readiness(stock_id)->>'ready5' = false`（真實短缺口，非歷史補完） | **唯一**可發 recovery token 的來源 |
| **obsolete** | 無 fact 且不屬上列（>5 交易日之外，或 ready5 已 true） | **不重試、不 mass 改狀態**。維持 `status='failed'`（UI/readiness 都不讀 queue status，只讀 `tw_bsr_daily`/`tw_chip_fact`，改動無收益且有風險）。僅在 metrics 中歸類為 `obsolete_count` |

排序（類內）：**`trade_date DESC`（最新完整日優先），同日再 `enqueued_at ASC`。**

**誠實聲明**：以現況（08-12 為 0、近 5 日 1,015 筆但多數屬歷史補完）
**Build 1b 極可能在 open window 也選不出 still_required**。這不是失敗，處置見 §8。

---

## 2. Gate 分層（回應 #8）

| 條件（reason 取自 `bsr_get_degrade_state()`） | 分類 | 行為 |
|---|---|---|
| `check_kill_switch('chips_all')` = false | 絕對停 | budget = 0，`budget_reason='kill_switch'` |
| mode `claim_halt` / `p1_only` | 絕對停 | budget = 0 |
| mode `tier2_paused`（usage≥90 / 429_streak） | 絕對停（真 upstream 保護） | budget = 0 |
| `tier3_paused` + reason **`usage_ge_80`** | 降 cap | budget = min(cap, 1) |
| `tier3_paused` + reason **`p1_stalled`** | **不歸零** | 允許 liveness floor（§3 修根因） |
| `tier3_paused` + reason `reservation_stuck` | 絕對停 | budget = 0 |
| pool reserve 未過（§4） | 禁發 token | budget = 0，回 `next_admission_at` |
| `ready_pending_count > 600` | 降 cap | budget = min(cap, 1) |

**canary：`cap = 1 token / invocation`（非每 pool 各 1）**，job106 每小時一次 → 上限 24/day。
`terminal reconcile` 另有獨立 cap = 1/invocation，**不佔 token**（不呼叫 API）。

---

## 3. p1_stalled 死鎖修法

`supabase/functions/tw-bsr-finmind-sync/index.ts` 的 `collectSignals` p1 查詢（現查 `enqueued_at`，
只過濾 `priority=1 AND status='pending'`，**不看 next_run_at**）改為與 claim 對齊：

```text
priority = 1 AND status = 'pending'
AND next_run_at <= <now ISO>        -- NULL 不計入（與 claim_bsr_queue_jobs 同語意）
ORDER BY enqueued_at ASC LIMIT 1
```

語意 = 「已到期可被 claim、卻仍未被處理」的最舊 p1 年齡。
實證根因：id 45208/6515，`enqueued_at 07:00:03`、`next_run_at 10:38:04`、`last_error=quota_deferred`
→ 一筆被正確 defer 的 p1 讓訊號無限成長。
`stepDownTarget('tier3_paused')` 的 `< 600` 閾值、`usage_ge_80/90`、`429_streak` **一律不動**。

Deno 測試：future defer 不計入 / due 計入 / NULL 不計入 / 全 defer → 訊號 0 且不得回 `p1_stalled` / `usagePct=92` 仍回 `tier2_paused`。

---

## 4. Pool reserve 與跨 pool 選取（回應 #6、#7）

**reserve 定義**（`used_today < daily_budget` 不足以保護，撤回 v2 寫法）：

```text
issue_ok(pool) :=
     used_today + RECOVERY_COST <= daily_budget - DAILY_RESERVE
 AND floor(tokens)              >= BURST_RESERVE + RECOVERY_COST
```

- `RECOVERY_COST = 1`
- `DAILY_RESERVE = 30`（= worker batch 30，保證整整一輪 worker 的持股/既有 pending 不被吃掉）
- `BURST_RESERVE = 30`（同上，桶內即時餘量）
- **interactive（p1，103 筆 failed 中 52 筆無 fact）：canary 期間一律不碰。**
  理由：`interactive` 是使用者開抽屜的即時路徑，`finmind_quota_ledger` 無 job_id 且 7 天清理，
  無法可靠歸因 recovery 用量，故 canary 只驗 **keepwarm（p2）**，且 interactive 明確列為 `pool_excluded_canary`。
- **bounded candidates inspected**：每次 invocation 最多檢視 **200** 筆候選（`LIMIT 200`），
  依 §1 排序取出後 **按 pool 分組**；某 pool（如 keepwarm）不過 reserve **不阻塞整輪**，
  繼續評估下一個可用 pool 的候選（canary 期間唯一可用 pool 就是 keepwarm，故實務上等於 0 或 1 筆）。
  被跳過者 **不改狀態、不做標記**，下輪重新評估 → 不會永久遺忘。
- **總 token cap 仍為 1/invocation**，跨 pool 合計。
- reset 後自然順序：`finmind_admit_v2` 於 `reset_at < today_tw` 時歸零 `used_today`；
  台北日界 00:00 後 interactive/keepwarm 恢復；worker 先消化既有 pending（優先權不變），
  recovery 因 reserve 需 daily 與 burst 皆有 30 餘量，結構上排在持股與既有 pending 之後。

---

## 5. `bsr_backlog_metrics()`（回應 #4、#9）

```sql
CREATE OR REPLACE FUNCTION public.bsr_backlog_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ ... $$;
REVOKE ALL ON FUNCTION public.bsr_backlog_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bsr_backlog_metrics() TO service_role;
```

（least privilege：**不 GRANT anon / authenticated**；函式只讀 queue/fact/pool，**不觸碰任何 user 表**，
不繞過任何 user-scoped RLS；測試斷言回傳 JSON 不含 user_id/email 等欄位。）

回傳四區：

```text
A ready      ready_pending_count      pending AND next_run_at <= now()
             oldest_due_since_ts      min(next_run_at)                → oldest_due_since_h
             oldest_ready_enqueued_h  now()-min(enqueued_at) 同一集合
             unclaimable_null_count   pending AND next_run_at IS NULL   (現 0)
B deferred   deferred_count / next_ready_at / oldest_enqueued_age_h    (不受 defer 影響)
C cohort     satisfied_count / still_required_count / obsolete_count
             still_required_by_date / cohort_by_pool
D audit      tokens_issued_24h / reconciled_24h / last_budget_reason / last_next_admission_at
             （來源：data_source_refresh_logs, source_key='bsr_quota_recovery'）
```

`bsr_recovery_budget` 改為呼叫本函式，單一定義來源。**不新增表、不新增欄位。**
測試含 mixed NULL / due / future 集合，確認 A 不被 defer 假性歸零、B 的 original age 不被 defer 改變。

---

## 6. Audit 記錄規格（單一責任：只有 `recover_quota_failed_bsr_jobs` 寫）

- `source_key = 'bsr_quota_recovery'`（新值，不與既有 4 個衝突）
- `status`（限 CHECK 合法值）：`success`（有 token 或有 reconcile）／`skipped`（budget=0 或 reserve 未過）／`error`
- `triggered_by = NULL`、`error_message` 僅存 gate 原因字串、`row_count = tokens_issued`
- `metadata` schema（**不得含任何 user 識別**）：

```json
{
  "invocation_id": "uuid",
  "budget_reason": "kill_switch|degrade_tier2_paused|degrade_reservation_stuck|pool_reserve_blocked|pool_daily_exhausted|cap_1|ok",
  "degrade": {"mode":"tier3_paused","reason":"p1_stalled","trigger_metric":"p1_oldest_sec","trigger_value":4811},
  "pools": [{"pool":"keepwarm","tokens":68,"used_today":702,"daily_budget":384,"issue_ok":false}],
  "pool_excluded": ["interactive"],
  "candidates_inspected": 200,
  "classification": {"satisfied":85,"still_required":0,"obsolete":1643},
  "selected": [], "tokened_job_ids": [], "reconciled_job_ids": [],
  "metrics_before": {...A/B/C...}, "metrics_after": {...A/B/C...},
  "next_admission_at": "2026-08-13T00:00:00+08:00"
}
```

每次 job106 **恰寫一筆**（recover 無條件被呼叫，已由 §0.1 read-back 證明）。

---

## 7. 精確變更清單（exact diff 形式）

| 物件 / 檔案 | 變更 | Rollback |
|---|---|---|
| `public.bsr_backlog_metrics()` → jsonb | **新增**（STABLE / SECURITY DEFINER / `SET search_path=public` / REVOKE PUBLIC / GRANT service_role） | `DROP FUNCTION public.bsr_backlog_metrics();` |
| `public.bsr_recovery_budget(p_full_budget integer)` → **jsonb（簽名與回型皆不變）** | 改寫 body：§2 gate 分層（讀 degrade `reason`）、§4 reserve、改用 §5 指標；回傳 **必須續存 `budget` 鍵**（enqueue 用 `(v_bp->>'budget')::int`），新增 `budget_reason`/`pools`/`next_admission_at` | 反向 migration 還原舊 body |
| `public.recover_quota_failed_bsr_jobs(p_max integer)` → **jsonb（不變）** | 改寫 body：`pg_advisory_xact_lock`、`LIMIT 200` 候選、§1 分類與排序、terminal reconcile（cap 1）、token（cap 1、只 still_required）、寫一筆 audit | 反向 migration 還原舊 body |
| `public.enqueue_chips_prefetch_gaps` | **不改**（型別已相容，read-back 證明） | — |
| `supabase/functions/_shared/bsrDegrade.ts` | **不改** | — |
| `supabase/functions/tw-bsr-finmind-sync/index.ts` | `collectSignals` p1 查詢加 `next_run_at <= now`（§3） | 還原並重新部署 |
| `supabase/tests/bsr_quota_recovery_test.sql` | 擴充：gate 矩陣（依 reason）、reserve 阻擋、cap=1、pool 不阻塞、分類正確、audit 恰一筆且 metadata 無 user 欄位、cohort 外零 row churn | 檔案還原 |
| `supabase/tests/bsr_backlog_metrics_test.sql` | **新增**：NULL/due/future 混合、defer 不假性歸零、權限（anon/authenticated 無 EXECUTE） | 刪檔 |
| `supabase/functions/tw-bsr-finmind-sync/degrade_signal_test.ts` | **新增**：§3 五案例 | 刪檔 |

**SQL contract（測試強制）**：`bsr_recovery_budget(int)->jsonb` 必含 `budget`(int)；
`recover_quota_failed_bsr_jobs(int)->jsonb` 必含 `tokens_issued`/`reconciled`/`budget_reason`；
`enqueue_chips_prefetch_gaps(int,int)->jsonb` 的 `backpressure`/`quota_recovery` 鍵不得消失。

**不建立**：dashboard、endpoint、scheduler、control plane、新表、新欄位、新 config key、新 cron。

---

## 8. 自然驗收（回應 #10）

### 8.1 Exhausted window（今日即可，3 輪 job106）
**PASS**：每輪 audit 存在一筆、`tokens_issued=0`、`budget_reason` 正確反映 pool/degrade、
selected cohort 外 **零 row churn**（`updated_at` 差集為空）、kill switch 與 tier2 保護未被繞過。

### 8.2 Open window（跨台北日界 reset，3 輪）
- 3 輪 **總 token ≤ 3**；
- **Liveness PASS** 需：至少 1 筆 **still_required 且原為 failed** 的 job，
  自然 token → claim → **worker HTTP response 該 job `rows_written > 0`** → **`tw_chip_fact` 前後 delta > 0**。
- fact EXISTS **只當 readiness，不當成功**（反例 job 45632：`done` 但 `rows_written=0`、fact 早存 799 列）。

### 8.3 沒有 still_required 時的判定（**現在明確定義**）
以 §0.7 實況，08-12 為 0 筆，open window 很可能仍選不出 still_required。此時：

> **Build 1b 判定為 `PASS (no-op safe)`** — 條件是全部滿足：
> ① 三輪 exhausted audit 全數存在且 `tokens_issued=0`；
> ② open window 三輪 audit 也存在，`classification.still_required=0` 有據可查；
> ③ terminal reconcile 已自然處理 ≥1 筆 satisfied（85 筆之一），且 **未呼叫任何 API**；
> ④ degrade 不再卡在 `p1_stalled`（§3 生效的自然證據）；
> ⑤ 零 row churn、零 mass update。
>
> 此結果 **明確標示為「未證明資料回補 liveness」**，不得宣稱回補成功；
> 歷史 failed 逐步封存與「最新資料的持續產生」由 **Build 2 的 lane** 負責。
> **絕不為了測試而去抓 4 月資料。**

每輪一律列：runid / budget_reason / degrade reason / pools / classification / selected / tokened / reconciled /
claim 與 worker jobs[] / rows_written / fact delta / A·B·C·D 指標。

---

## 9. Rollback（回應 #11）

- 三個函式以反向 migration 還原舊 body；Edge Function 還原並重新部署 → 未來不再產生 audit。
- **已 terminalize 的 reconcile 與已成功寫入的 fact 不倒回**（那是正確結果）。
- **不刪除任何既有 `data_source_refresh_logs` 稽核紀錄**。

---

## 10. 批准範圍

Approve = **只執行 Build 1b**，完成 §8 的自然跨 reset 驗收後**停下**。
**Build 2（Lane A/B、cursor、job70 等）仍需第二次明確批准。**
