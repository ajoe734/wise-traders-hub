# Build 1b — Recovery Liveness / Backlog Metric / Degrade 自癒（Plan v2）

範圍嚴格限定：**recovery liveness**、**backlog 指標誠實化**、**degrade 自癒**。
不做 Lane A/B、cursor、job70、UI、coverage、其他 pipeline。Build 2 未授權。

---

## 0. v2 新增查證（本回合實讀，全部 read-only）

### 0.1 Pool routing 是 priority 的純函式（v1 的 backfill 額度論述作廢）

`supabase/functions/tw-bsr-finmind-sync/index.ts:53-57, 114-133`：

```text
tierFromPriority(p): p<=1 -> 1 ; p==2 -> 2 ; else 3
poolFromTier(t):     1 -> interactive ; 2 -> keepwarm ; 3 -> backfill
admitFinmind(pool) -> finmind_admit_v2(_pool,...)；拒絕時 throw `finmind_admission_<reason>:pool=<pool>`
```

`finmind_admit_v2` 內只認 `_pool` 參數，daily cap 為該 pool 的 `used_today + cost > daily_budget`；
唯一跨池行為是 **interactive 可向 keepwarm 借**（且 keepwarm tokens 需 ≥30% capacity），
**backfill 額度不可能被 p1/p2 使用**。

### 0.2 歷史 failed cohort 的真實分布（1,728 筆，全部 max_attempts=5）

| priority | pool（由 last_error 佐證） | 筆數 |
|---|---|---|
| 2 | keepwarm | **1,625**（daily_exhausted 1,390 + rate_limited 235） |
| 1 | interactive | **103**（daily_exhausted 103） |
| 3 | backfill | **0** |

依 trade_date：08-07 = 579、08-05 = 317、08-04 = 270、08-03 = 141、08-06 = 125、07-28 = 59、其餘散布至 2026-04-06。
enqueued_by 以 `tier2_gaps:*`（1,304）為主，其次 `converge_bsr_windows`（97）、`chips_prefetch_hourly`（53）、`backfill_seed_20260721`（42）。

**結論（回應你的第 1 點）**：recovery 若保持原 priority，**94% 走 keepwarm、6% 走 interactive，0% 走 backfill**。
今日 keepwarm `used_today 702 / daily_budget 384`、interactive `240/240`，兩者皆 `daily_exhausted`。
因此 **v1「backfill 尚餘 515 所以今日可發 token」的推論錯誤，本 v2 撤回**。
本 Build **不改 pool routing、不改 priority、不改任何 API 配額語意**——
逃避配額等同製造重試風暴。**今日不可能有 liveness 證據，只能等自然 reset。**

### 0.3 Daily reset 的 SoT

`finmind_admit_v2`：`IF p.reset_at < today_tw THEN used_today := 0`，`today_tw = (now() AT TIME ZONE 'Asia/Taipei')::date`；
`finmind_pool_reset()` 同語意。所有 pool 現值 `reset_at = 2026-08-12`。
`next_admission_at` 一律由此推導（`reset_at + 1 day` 的台北日界），**不寫死常數**。

### 0.4 p1_stalled 死鎖的精確位置

`collectSignals`（index.ts:399-404）查的欄位是 **`enqueued_at`**（不是 `created_at`），
且**只過濾 `priority=1 AND status='pending'`，完全不看 `next_run_at`**。
實證：最舊 p1 pending = id 45208 / 6515，`enqueued_at 07:00:03`、`next_run_at 10:38:04`、`last_error=quota_deferred`。
→ 一筆被正確 defer 的 p1 讓 `p1_oldest_sec` 無上限成長 → `tier3_paused(p1_stalled)` 永真 → budget 永 0。
另實讀：`status='pending' AND next_run_at IS NULL` 目前為 **0 筆**，但仍需 NULL-safe 處理。

### 0.5 可沿用的持久 audit（不建新 control plane）

| 表 | 適用性 |
|---|---|
| `public.data_source_refresh_logs` | **適合**。既有用途正是「資料源刷新一筆 JSON」：`source_key` 已有 `backfill_worker`(207)、`tw_keep_warm`(32)、`backfill_gap_orchestrator`(8)、`tw_trading_calendar_catchup`(13)，`metadata jsonb` 已裝 `run_id + results[]{job_id,status}`。NOT NULL 僅 `id/source_key/status/started_at/created_at`；`triggered_by` 可空。ACL：`service_role` 與 `postgres` 皆 `arwdDxtm`（RLS 讀取限 company_admin / 本人，**不影響 SECURITY DEFINER 寫入**） |
| `tw_bsr_attempt_logs` | 每次 fetch attempt 的 outcome/latency，**無 job_id**，不能對回 token |
| `tw_bsr_fetch_failures` | 只記失敗，無成功 rows_written |
| `function_run_logs` | 欄位為 `fn/run_id/level/stage/msg/payload`，偏 signal 領域（有 expert_id/signal_id），語意不合 |
| `finmind_quota_ledger` | 有 pool/granted/reason/stock_id，**無 job_id、7 天清理**，可佐證 admission 但不能當漏斗 SoT |
| queue 自身 | `last_error` 會被下一次狀態轉移覆寫 → **v1 的 `recovery_tokens_issued_1h` 不可靠，撤回** |

→ 採用 `data_source_refresh_logs`，`source_key='bsr_quota_recovery'`，**不新增表、不新增 endpoint**。

---

## 1. Gate 分層（依 0.1/0.2 修正）

| Gate | 分類 | 行為 |
|---|---|---|
| `check_kill_switch('chips_all')` = false | **絕對 safety stop** | 禁 API、禁 token |
| degrade `claim_halt` / `p1_only` | **絕對 stop** | 禁 API、禁 token |
| degrade `tier2_paused`（usage≥90 / 429 streak） | **禁 token issuance** | 真 upstream 保護，維持 |
| degrade `tier3_paused` reason `usage_ge_80` | **只降 cap** | 用量高 ≠ 故障 |
| degrade `tier3_paused` reason **`p1_stalled`** | **不得歸零** | 症狀不能禁止治療（§2） |
| **selected cohort 對應 pool 的 `used_today >= daily_budget`** | **禁 token issuance**，回 `next_admission_at` | 取代 v1 的 keepwarm ratio 粗判；按 cohort 實際 pool（keepwarm / interactive）逐一判定 |
| 該 pool `tokens < 1`（rate_limited） | **禁 token issuance**（該輪） | 桶空，下一輪自然重試 |
| `pending_ready > 600` | **只降 cap** | — |
| `oldest_due_since_h > 12` | **降至 floor**，不歸零 | 舊 = 更該修 |

**Liveness floor**：非絕對 stop、且該 cohort 的 pool 當日仍有實際額度時，floor = 1。

---

## 2. p1_stalled 修法（明確、可測，非「約 1 行」）

`collectSignals` 的 p1 查詢改為：

```text
priority = 1
AND status = 'pending'
AND (next_run_at IS NULL OR next_run_at <= <now ISO>)
ORDER BY enqueued_at ASC LIMIT 1
```

語意：**p1_oldest_sec = 「現在就可被 claim、卻仍未被處理」的最舊 p1 年齡**。

- 欄位維持 `enqueued_at`（已查證即為現行欄位，不改成 `created_at`）。
- `next_run_at IS NULL` 視為**立即可 claim**（與 worker claim 的 `.lte('next_run_at', now)` 語意保持一致需確認；
  若 worker 的 `lte` 會排除 NULL，則兩處採同一 NULL-safe 條件，**同一 PR 一起改，不留歧義**）。
- 時區/比較：一律 `new Date().toISOString()`（UTC ISO）對 `timestamptz`，與現行 worker claim 同寫法。
- `stepDownTarget('tier3_paused')` 的 `p1OldestPendingAgeSec < 600` **閾值不動**，自動因訊號修正而可成立。
- `usage_ge_80/90`、`429_streak`、`reservation_stuck` 一律不動。

**測試（Deno，純函式 + 查詢建構）**：
1. future `next_run_at` 的 quota_deferred p1 → 不計入；
2. ready p1（`next_run_at <= now`）→ 必須計入；
3. `next_run_at IS NULL` → 計入；
4. 全部 p1 皆 deferred → `p1OldestPendingAgeSec = 0` → `desiredMode` 不得回 `p1_stalled`；
5. 真 upstream：`usagePct=92` → 仍回 `tier2_paused`（保護未被弱化）。

---

## 3. `bsr_backlog_metrics()`（唯讀函式，命名不再混淆）

```text
A ready（現在可 claim）
  ready_pending_count      pending AND COALESCE(next_run_at,'-infinity') <= now()
  oldest_due_since_h       now() - min(next_run_at)  → 「到期後等了多久」
  oldest_ready_original_h  now() - min(enqueued_at)  → 同一集合的原始年齡

B deferred debt（債，未到期但存在）
  deferred_count           pending AND last_error='quota_deferred' AND next_run_at > now()
  oldest_original_age_h    now() - min(enqueued_at)   ← 不受 defer 影響
  next_ready_at            min(next_run_at)

C historical failed cohort
  historical_quota_failed_remaining  failed AND last_error LIKE 'finmind_admission_%' AND max_attempts < 8
  cohort_by_pool                     {keepwarm: n, interactive: n}（由 last_error 的 :pool= 後綴解析）
  oldest_failed_original_h           now() - min(enqueued_at)

D funnel audit（來自 data_source_refresh_logs, source_key='bsr_quota_recovery'）
  tokens_issued_24h / selected_24h / last_budget_reason / last_next_admission_at
```

**`oldest_due_since_h` 與 `oldest_original_age_h` 是兩個名字不同的指標**，v1 的混用已修正。
`bsr_recovery_budget` 改為呼叫本函式，單一定義來源。
**不新增欄位**：B/C 的原始年齡用既有 `enqueued_at`（`defer_bsr_job_quota` 不改它，已由 id 45208 實證），
故 `first_ready_at` 不需要；`created_at` 全程不寫。

---

## 4. Recovery 漏斗與誠實的 liveness 定義

```text
failed selected → token issued（audit 落地）
               → claimed after admission opens
               → done / partial / quota_deferred / unsupported
               → rows_written > 0（自然 worker response）
```

- **fact EXISTS 只當 readiness，不當成功**（v1 的 `recovered_with_fact_rows_24h` 撤回）。
  job 45632 即反例：`outcome=done`、`rows_written=0`、fact 早已 799 列存在。
- **liveness 唯一憑證**：自然 worker HTTP response 的該 job `rows_written > 0`；
  次佳憑證為同 stock/date 的 `tw_chip_fact` count **前後 delta > 0**（回補前後各讀一次）。
- token 上限：每 job lifetime ≤3（`max_attempts` 5→8，既有 `< 8` 條件已表達，不改）。
- 選取：既有 `FOR UPDATE SKIP LOCKED LIMIT cap` + **新增 `pg_advisory_xact_lock`** 防併發重複發。
- **禁止 mass update**：唯一寫入路徑是受 cap 的 `LIMIT`。
- 已 read-back 證明 **唯一 caller 是 `enqueue_chips_prefetch_gaps`**（`pg_proc` 全庫掃描，
  `recover_quota_failed_bsr_jobs` 與 `bsr_recovery_budget` 各只有這一個呼叫者）。

### 4.1 選取排序與公平（回應第 8 點）

現行 `ORDER BY trade_date DESC, priority ASC` 會讓 08-07（579 筆）永遠壓住 04-06 的舊債。
改為 **`ORDER BY enqueued_at ASC`（最舊優先）**，cap 極小的前提下這是最公平也最能證明 liveness 的順序。

- **不重選**：token 發出後 `status` 變 pending 且 `max_attempts+1`，離開 `status='failed'` 選取集；
  若之後再因 quota 失敗回到 failed，`max_attempts` 已 6 → 最多再兩次，達 8 後永久退出（防無限回收）。
- **非 quota 類再次失敗**（如 `no_chip_data`）→ `last_error` 不符 `finmind_admission_%`，
  自動退出 recovery cohort，**不再被選**（維持既有語意，不改）。

---

## 5. Cap 算術（修正 v1 的錯誤）

v1 寫「3/hr ≈ backfill 的 <1%」是錯的：3/hr = 72/day = keepwarm `daily_budget 384` 的 **18.8%**，
且 recovery 實際走 keepwarm/interactive 而非 backfill。**撤回。**

- 目前**沒有** per-day recovery ledger（`finmind_quota_ledger` 無 job_id、7 天清理，無法精確歸因），
  因此 **不得聲稱任何 72/day 安全額度**。
- 採 **canary：`floor = 1`、`cap = 1`（per invocation）**，job106 每小時一次 →
  理論上限 24/day，但驗收僅跨 **3 輪 → 最多 3 筆**，之後回 Plan 再談是否放寬。
- **per-day reserve**：token 只在該 cohort pool `used_today < daily_budget` 時發，
  等同直接沿用既有 quota ledger／pool 帳，不另立帳本；持股／既有 pending 的額度天然優先，
  因為 worker claim 順序不變且 cap=1 遠小於 batch=30。
- **p1 starvation**：cap=1 且 worker batch=30、claim 順序不變，結構上不可能排擠 p1。

---

## 6. next_admission_at 語意（回應第 4 點）

- pool exhausted → **不發 token**，函式只回 `{tokens_issued: 0, budget_reason:'pool_daily_exhausted', next_admission_at}`。
- **絕不觸碰 selected cohort 以外的任何 row**；v1 的「把既有 deferred 的 next_run_at 對齊」**整段刪除**。
- 下一個自然 job106 重新判定，無人工介入。

---

## 7. 精確變更清單

| 物件 / 檔案 | 變更 | Rollback |
|---|---|---|
| `public.bsr_backlog_metrics()` → `jsonb` | **新增**唯讀函式（`STABLE`，`SECURITY DEFINER`，`SET search_path=public`），A/B/C/D 四區 | `DROP FUNCTION public.bsr_backlog_metrics();` |
| `public.bsr_recovery_budget(p_full_budget integer)` → `jsonb` | **改寫**（簽名不變）：gate 分層、floor、per-cohort pool 可用性、改用 §3 指標、回傳 `budget_reason` / `next_admission_at` | 反向 migration，還原舊 body（舊定義已完整存於本 plan 查證紀錄） |
| `public.recover_quota_failed_bsr_jobs(p_max integer)` → `jsonb` | **改寫**（簽名不變）：advisory lock、`ORDER BY enqueued_at ASC`、exhausted 不發 token、只碰 selected cohort、寫一筆 `data_source_refresh_logs`、回傳漏斗欄位 | 同上 |
| `public.enqueue_chips_prefetch_gaps(int,int)` | **不改**（cap 由 `bsr_recovery_budget(12)` 回傳值自然收斂到 1） | — |
| `supabase/functions/_shared/bsrDegrade.ts` | **不改** | — |
| `supabase/functions/tw-bsr-finmind-sync/index.ts` | `collectSignals` p1 查詢 NULL-safe ready 過濾（§2）；如 worker claim 的 NULL 語意不一致，同 PR 對齊 | 還原並重新部署 |
| `supabase/tests/bsr_quota_recovery_test.sql` | 擴充：gate 矩陣、floor、exhausted 不發 token 且不動他人 row、advisory lock 併發、cap=1、`ORDER BY enqueued_at`、audit 落地一筆 | 檔案還原 |
| `supabase/tests/bsr_backlog_metrics_test.sql` | **新增**：deferred 不得讓 A 類歸零、B 的 original age 不受 defer 影響、C 依 pool 分組正確 | 刪檔 |
| `supabase/functions/tw-bsr-finmind-sync/degrade_signal_test.ts` | **新增**：§2 的 5 個案例 | 刪檔 |

**Read-back 清單**：三個函式的 `pg_get_functiondef`、`enqueue_chips_prefetch_gaps` 未變更、
`pg_proc` 全庫確認 recovery/budget 仍只有單一 caller、cron job 45/81/106/107 command 未變。

**不建立**：dashboard、endpoint、scheduler、control plane、新表、新欄位、新 config key、新 cron。

---

## 8. 自然驗收（safety 與 liveness 分開）

### Safety（exhausted window，今日可取得）
每輪 job106 記錄 `runid / start / end / status`、`budget_reason`、`selected / tokened(=0) / next_admission_at`，
以及 A/B/C 三類指標。**PASS 條件**：`tokened = 0`、cohort 外無任何 row 被修改（以 `updated_at` 差集證明）、
kill switch 與真 upstream 保護未被繞過。

### Liveness（admission open window，須跨 reset，`reset_at` 前進後）
**PASS 條件**：至少 1 個 token 自然 issued → claimed → 該 job 在 worker response 的 `rows_written > 0`
（或同 stock/date 的 `tw_chip_fact` 前後 delta > 0），且 `historical_quota_failed_remaining` 由 1,728 真實下降。

- 上游本來就無該股資料 → 依 `partial` / `unsupported` 誠實分類，**不算成功**。
- 所有 selected 都已有 fact 且 `rows_written = 0` → **不得宣稱回補 PASS**；
  繼續自然輪次，直到觀測到真實寫入，或證明整個 cohort 已 fresh 並以「安全結案」明確標示（非 liveness PASS）。
- 未到自然 reset 前**誠實等待**，不以手動觸發或狀態搬移代替。

每輪一律列：runid、budget_reason、selected / tokened / claimed / done / partial / deferred / rows_written / fact delta、A/B/C/D 指標。

---

## 9. 批准範圍

Approve = **只執行 Build 1b**，完成上述「跨 reset 的自然驗收」即停。
**Build 1b PASS 前禁止進入 Build 2**（Lane A/B、cursor、job70 等一律不動）。
