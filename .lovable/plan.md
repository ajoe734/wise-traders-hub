# Build 1b — Recovery Liveness / Backlog Metric / Degrade 自癒（Plan v1）

範圍嚴格限定三件事：**recovery liveness**、**backlog 指標誠實化**、**degrade 自癒**。
不做 Lane A/B、cursor、job70、UI、coverage、任何其他 pipeline。Build 2 仍未授權。

---

## 0. 本輪重新查證的 production 事實（皆為本回合實讀）

| 事實 | 來源 |
|---|---|
| `bsr_recovery_budget` 的 halt 條件為 `kill_switch IS NOT TRUE OR degrade_mode <> 'normal'` → 只要非 normal 就 budget=0 | `pg_proc.prosrc` |
| hard_stop 條件為 `pending>600 OR oldest_ready_age>12h OR keepwarm_quota_ratio>=0.8` | 同上 |
| `oldest_ready_age` 取 `min(next_run_at)`（pending 且 ready），**deferred 把它推向未來即隱形** | 同上 |
| degrade 訊號 `p1OldestPendingAgeSec` 取「**任何** priority=1 pending 的最舊 `enqueued_at`」，**不看 next_run_at** | `tw-bsr-finmind-sync/index.ts:399-404` |
| 目前最舊 p1 pending = id 45208 / 6515，`enqueued_at 07:00:03`、`next_run_at 10:38:04`、`last_error=quota_deferred` | queue 實讀 |
| 即：一筆被 quota 正確 defer 的 p1，其 age 仍持續累積 → `p1_oldest_sec ≥ 1800` 永真 → `tier3_paused(p1_stalled)` 永不退階 → budget 永 0 → 永不 recovery。**死鎖成立** | 交叉推導 |
| kill switch `chips_all` = **enabled=true**（未被人為關閉） | `system_kill_switches` |
| pool 現況：`interactive` used 240/240 exhausted、`keepwarm` used 702/384（ratio 1.83）exhausted、**`backfill` used 85/600 仍有 515 額度** | `finmind_quota_pools` |
| 每日 reset 的 SoT 是 `finmind_quota_pools.reset_at`（date，台北）+ `finmind_admit_v2` 內 `IF p.reset_at < today_tw THEN reset`；`finmind_pool_reset()` 同語意 | `pg_proc.prosrc` |
| failed 1,728 筆 **全部 max_attempts=5**（token 從未發過），最舊 `created_at 2026-07-21 12:46` | queue 實讀 |
| `tw_bsr_sync_queue` 已有 `enqueued_at / created_at / updated_at / attempts / max_attempts / last_error / next_run_at`，**無 first_ready_at** | information_schema |

結論：`keepwarm_quota_ratio=1.43`（現已 1.83）與 `oldest_ready_age` 都是**症狀**；根因是
**「deferred 汙染 p1 age → 誤判 p1_stalled → 禁止 recovery → p1 永不前進」**的自我維持迴圈。

---

## 1. 三種 gate 的正確分層

| Gate | 現行行為 | Build 1b 分類 | 理由 |
|---|---|---|---|
| `check_kill_switch('chips_all')` = false | budget=0 | **絕對 safety stop**：禁止 API call、禁止 token issuance | 人為總開關，不得繞過 |
| degrade `claim_halt` / `p1_only` | budget=0 | **絕對 stop**（禁 API、禁 token） | reservation stuck 或極端狀態，真故障 |
| degrade `tier2_paused`（`usage_ge_90` / `rate_limited_streak`） | budget=0 | **禁止 token issuance，但不視為永久**（真 upstream 保護，維持） | 429 streak 是真 upstream 訊號 |
| degrade `tier3_paused` reason = `usage_ge_80` | budget=0 | **只降 cap（≤2/hr），不歸零** | 用量高 ≠ 故障 |
| degrade `tier3_paused` reason = **`p1_stalled`** | budget=0 | **不得歸零 — 這正是要修的東西**；改為 liveness floor | 症狀本身不能禁止治療 |
| `keepwarm_quota_ratio ≥ 0.8` | budget=0 | **只降 cap**；且改讀 recovery 實際使用的 pool | recovery 走 backfill pool，keepwarm ratio 不是它的可用性 |
| 該 pool **`used_today ≥ daily_budget`**（真 daily_exhausted） | 無此判定 | **禁止 token issuance，並把 token 排到下一個 reset**（不是立即 pending） | 避免 pending→claim→deferred churn |
| `pending_ready > 600` | budget=0 | **只降 cap**（backpressure 仍在，但不歸零） | 排隊多不代表不能修最舊的債 |
| `oldest_ready_age > 12h` | budget=0 | **降 cap 至 liveness floor（≥1）**，不歸零 | 舊 = 更該修，不是更該停 |

**Liveness floor 原則：** 只要不在絕對 stop、且 recovery pool 當日仍有實際額度，
每自然小時 **至少發 1 個 token**（floor=1，cap 見 §5）。

---

## 2. p1_stalled 死鎖的最小解法

兩處最小修正，互相獨立、各自可回滾：

1. **度量修正（edge function）**：`collectSignals` 的 p1 查詢加上 `.lte('next_run_at', now)`。
   語意變成「**現在就能被 claim 卻沒被處理的 p1 有多舊**」——這才是 stalled 的定義。
   被 quota 正確 defer、還沒到 `next_run_at` 的 p1 不再灌爆這個訊號。
   **不弱化任何真 upstream 保護**：`usage_ge_80/90`、`429_streak`、`reservation_stuck` 全部不動。

2. **恢復條件修正（同檔 `stepDownTarget`）**：`tier3_paused → normal` 的 `p1OldestPendingAgeSec < 600`
   沿用同一個修正後訊號即可自動成立，**不改閾值**。

3. **quota 真耗盡時不 churn**：token 發放時若 recovery pool `used_today >= daily_budget`，
   則**不發 token**，並回報 `next_admission_at`（由 SoT 推導：`reset_at + 1 day` 的台北 00:00，
   與 `finmind_admit_v2` 的 `reset_at < today_tw` 判定同源，**不寫死午夜常數、不猜**）。
   已 deferred 的 job 的 `next_run_at` 若早於 `next_admission_at`，一併對齊到該時點（單筆 cap 內、非 mass update）。

---

## 3. 三類真實 backlog 指標（不加新表、不加新欄位）

新增單一 read-only 函式 `public.bsr_backlog_metrics()`（唯讀，無副作用），回傳：

```text
A. ready_pending_count        pending AND next_run_at <= now()
   oldest_ready_age_h         now() - min(next_run_at) 於同一集合

B. deferred_count             pending AND last_error='quota_deferred' AND next_run_at > now()
   oldest_original_age_h      now() - min(enqueued_at) 於同一集合   ← 債仍可見
   next_deferred_ready_at     min(next_run_at)

C. historical_quota_failed_remaining   failed AND last_error LIKE 'finmind_admission_%' AND max_attempts < 8
   recovery_tokens_issued_1h            pending AND last_error='quota_recovery_token' AND updated_at > now()-1h
   recovered_with_fact_rows_24h         status='done' AND max_attempts > 5 AND EXISTS(tw_chip_fact 同 stock/date)
```

**first_ready_at 不需要新增。** B 類用既有 `enqueued_at`（`defer_bsr_job_quota` 從不改它，
已由 07:00 那筆 45208 實證），C 類用 `max_attempts > 5` 當 token 標記。既有欄位足以表達，
因此本 Build **不新增任何欄位、不新增 config key、不新增表**，也不會動到 `created_at`。

`bsr_recovery_budget` 改為呼叫本函式取數，避免兩套定義漂移。

---

## 4. Recovery 完整漏斗（PASS 不等於搬 row）

```text
failed selected  → token issued → claimed after admission opens
                 → done / partial / quota_deferred → fact rows written
```

- 每 job lifetime **token ≤ 3**（`max_attempts` 5 → 8，既有 `< 8` 條件已達成此上限，不改）。
- 每自然小時 **hard cap**（§5），由 `bsr_recovery_budget` 單一出口決定。
- 選取沿用既有 `FOR UPDATE SKIP LOCKED LIMIT cap`；另加 `pg_advisory_xact_lock` 防兩個 job106 併發重複發 token。
- **禁止 mass update**：受 cap 限制的 `LIMIT` 是唯一寫入路徑，不新增任何無 LIMIT 的 UPDATE。
- 成功定義（liveness PASS）為 **C 類 `recovered_with_fact_rows` > 0 且
  `historical_quota_failed_remaining` 真下降**，不是 pending 數變化。

---

## 5. 吞吐 / cap（依三輪實測）

實測：R1 30 success / R2 7 success + 23 deferred / R3 1 idempotent + 29 deferred；
`interactive`、`keepwarm` 皆 daily_exhausted，`backfill` 尚餘 515。

- **Canary cap：每自然小時最多 3 個 token**（`p_full_budget` 由 12 降為 3），liveness floor = 1。
  以 R2/R3 的成功率（~23%）估算，每小時真實 API 消耗 ≤3，佔 backfill 日額度 <1%。
- **p1 starvation 防護**：token 一律發給 `priority ASC, trade_date DESC` 排序後的尾端（歷史債為 priority 2/3），
  且 recovery 發出的 job 保持原 priority；worker claim 順序不變，p1 永遠優先。
  cap=3 遠小於 worker batch=30，結構上不可能排擠 p1。
- **quota exhausted 當天不 churn**：§2.3 的 `next_admission_at` 對齊，當日不再發 token；
  reset 後（`reset_at` 前進）第一個 job106 自然恢復發放，**無需人工**。

---

## 6. 精確變更清單

| 物件 | 變更 | 回滾 |
|---|---|---|
| `public.bsr_backlog_metrics()` | **新增**（唯讀函式，無副作用） | `DROP FUNCTION` |
| `public.bsr_recovery_budget(int)` | **改寫**：gate 分層、liveness floor、改讀 backfill pool 可用性、改用 §3 指標 | 反向 migration 還原舊定義（舊 body 已存檔於本 plan 的查證紀錄） |
| `public.recover_quota_failed_bsr_jobs(int)` | **改寫**：加 advisory lock、加 `next_admission_at` 對齊、回傳漏斗欄位 | 同上 |
| `supabase/functions/_shared/bsrDegrade.ts` | **不改**（純邏輯，閾值全部維持） | — |
| `supabase/functions/tw-bsr-finmind-sync/index.ts` | 僅 `collectSignals` 的 p1 查詢加 `next_run_at <= now()` 條件（約 1 行） | 還原該行後重新部署 |
| `supabase/tests/bsr_quota_recovery_test.sql` | 擴充：gate 分層矩陣、liveness floor、exhausted 不 churn、advisory lock 併發、無 mass update | 檔案還原 |
| `supabase/tests/bsr_backlog_metrics_test.sql` | **新增**：三類指標互不汙染（deferred 不得讓 A 類歸零） | 刪檔 |
| `supabase/functions/tw-bsr-finmind-sync/*_test.ts` | 新增 p1 訊號單測：future `next_run_at` 的 p1 不得計入 `p1OldestPendingAgeSec` | 刪檔 |

**不建立**：dashboard、endpoint、scheduler、control plane、新表、新欄位、新 config key、新 cron。
job106 / job107 的排程與 payload **完全不動**。

---

## 7. 自然驗收（至少三輪，且必須跨 quota reset）

每輪（job106 + 隨後 worker）記錄：

- job106 `runid / start / end / status`；
- `budget_reason`（新版 gate 名稱）、`selected / tokened`；
- worker `runid / response id / HTTP status`、`claimed / done / partial / deferred`、per-job `rows_written`；
- 對回 `tw_chip_fact` 實際列數；
- 三類 backlog 指標（A/B/C）逐輪快照。

**安全 PASS**：任何一輪 `tokened ≤ cap(3)`、無 mass update、kill switch 與真 upstream 保護未被繞過。
**Liveness PASS**：至少 1 筆歷史 failed 走完漏斗並寫入 fact rows，且
`historical_quota_failed_remaining` 由 1,728 真實下降。

因今日 `interactive`/`keepwarm` 已 daily_exhausted，**跨日 reset 前不會有 liveness 證據；
屆時誠實回報「等待 reset」，不以手動觸發或狀態搬移代替**。`backfill` pool 若仍有額度，
canary token 可在當日即取得部分證據，一併如實區分標示。

---

## 8. 批准範圍

Approve 本 Plan = **只執行 Build 1b**，完成上述自然驗收即停。
**Build 1b PASS 前禁止進入 Build 2**（Lane A/B、cursor、job70 等一律不動）。
