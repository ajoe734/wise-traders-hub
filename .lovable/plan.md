# Build 1f — Gate Plan v7.1（討論稿，不執行）

第 3 個 literal cycle（Taipei 09:02 / 09:07）為真實 FAIL/N/A 分類問題：token 全數 `post_close_only = true`，09:07 屬盤中，`claim_bsr_queue_jobs` 合法排除 → `no_jobs`。不改寫為 PASS，不關閉盤中保護。

## 1. 既有實作讀回（read-only 佐證）

- `is_tw_trading_hours()`：Asia/Taipei，週一～週五 09:00–13:29 為 in-hours。
- `claim_bsr_queue_jobs`：token slot 與 normal 兩段皆帶 `(NOT in_hours OR post_close_only = false)`；token slot `LIMIT 1`，排序 `next_run_at ASC, id ASC`。
- `recover_quota_failed_bsr_jobs`：cap 恆 1，只把 failed job 改回 `pending / last_error='quota_recovery_token'`，**不改寫 `post_close_only`**。
- 排程：job106 `2 * * * *`；job107 `7 * * * *`（`ignore_window:true` 只作用於 Edge 端，DB claim 仍受盤中保護）。
- 佇列現況：pending 11、recovery token 8（**8/8 `post_close_only = true`**），最舊 token `next_run_at = 2026-08-12 18:02Z`。

**可 claim 的 `:07` 輪次（Taipei）**：週一～週五 `00:07–08:07`、`14:07–23:07`；`09:07–13:07` 不可（13:07 < 13:30）。週六日全時段可。

## 2. Streak 語意（嚴格版，取代 v7）

- target class streak **只由時間上連續的 eligible `:07` cycles 組成**。
- 中斷 streak：出現另一 class、eligible 但 FAIL、MIXED、UNPROVEN。
- **N/A 僅限盤中 ineligible cycle**：不開始、也不延續 streak（不算中斷，但不接續前段）。實務上等同 streak 必須落在同一段連續 eligible 區塊內。
- 舊 open 2/3 僅列為行為佐證，正式計數 **open 0/3、exhausted 0/3** 重設。

## 3. 兩套 gate（依實際 code 欄位）

Worker 回應欄位實測（`supabase/functions/tw-bsr-finmind-sync/index.ts`）：`claimed`、`rows_written`（總和，L670）、`jobs_quota_deferred`（L673）、`jobs[]`（每筆含 `job_id`、`priority`、`outcome`、`rows_written`、`last_error`，於完成時 push）。Recovery audit 欄位（`data_source_refresh_logs`，source_key `bsr_quota_recovery`）：`budget_reason`、`tokens_issued`、`tokened_job_ids`、`reconciled_job_ids`、`cap`、`pools`、`degrade`。

**Open gate（每輪）**
1. job106 該輪 `bsr_quota_recovery` audit **恰 1 筆**，`tokens_issued = 1`、`tokened_job_ids` 非空。
2. 其後自然 `:07` job107 有唯一一筆 HTTP 200 回應。
3. 最舊 eligible recovery token 被 claim（body `jobs[].job_id` 含之）。
4. 該 token per-job `rows_written > 0`。
5. `tw_chip_fact` 對應 `stock_id + trade_date` 有 delta。
6. 無非預期寫入；我方 write delta = 0。

**Exhausted gate（每輪）**
1. job106 該輪 audit **恰 1 筆**，明列 `budget_reason` 與 `tokened_job_ids`（可為空）。
2. `:07` 唯一 HTTP 200。
3. `jobs_quota_deferred > 0`。
4. body `rows_written`（total）= 0。
5. 無 fact delta、無非預期寫入；我方 write delta = 0。

兩套互斥，同一輪只用其一，依第 5 節 class 判定。

## 4. token-first 直證的可得性

`jobs[]` 由 `recordOutcome` 在**完成時**推入（L544–556），是 **completion order 而非 assignment order**；`partitionTokenFirst`（L539）只保證進入 worker pool 的排序，body 沒有任何 assignment-order telemetry。v6.2 §8 亦只要求「`jobs[]`（completion order）含該 id」。

結論：**production token-first 直證不可得**。改以三項佐證併列，且明確標示為推論：
- frozen source / hash read-back（DB `md5(prosrc) = c28474cc…`、Edge `index.ts 01b4f5b9…` / `lib.ts 300a1f29…`）證明 `partitionTokenFirst` 已在線上。
- 最舊 eligible token 確實被 claim 並處理。
- `finished_at` / body 順序的時序推論。

不新增 telemetry、不偽稱直證。此項**非 blocking**（v6.2 §8 原始 gate 只要求 completion order 含該 id）。

## 5. Class 判定（不可只靠單一 budget_reason）

`bsr_recovery_budget` 實際 branch：`kill_switch`、`degrade_claim_halt` / `degrade_p1_only` / `degrade_tier2_paused` / `degrade_reservation_stuck`、`pool_reserve_blocked`、`cap_1`、`cap_zero`；另 `recover_quota_failed_bsr_jobs` 有 `lock_contended`。Pool 語意：`finmind_quota_pools` 每日 `daily_budget`，`bsr_recovery_budget` 另留 `DAILY_RESERVE 30` / `BURST_RESERVE 30`，`interactive` 排除；`finmind_quota_ledger.granted = false / reason = 'daily_exhausted'` 為 exhausted 的權威訊號。Reset 為 **Taipei 00:00（UTC 16:00）**。

判定規則（`:02` 與 `:07` 必須一致）：
- **OPEN**：`:02` audit `budget_reason = cap_1`（quota 可用、`issue_ok` 為真），且 `:07` body `jobs_quota_deferred = 0`，且該輪 ledger 無 `daily_exhausted`。
- **EXHAUSTED**：`:02` audit `budget_reason = pool_reserve_blocked` 或 `cap_zero`（且 ledger 該時段有 `daily_exhausted`），且 `:07` body `jobs_quota_deferred > 0` 且 total `rows_written = 0`。
- **MIXED**：`:02` 與 `:07` 訊號矛盾，或期間發生 quota 轉態 → 中斷 streak。
- **UNPROVEN**：`kill_switch` / `degrade_*` / `lock_contended`，或必要 log 缺失 → 中斷 streak。

## 6. 結果分類

| 分類 | 條件 |
| --- | --- |
| PASS | 該 class 全部條件成立 |
| FAIL | eligible open 輪次 audit 發了 token 但 worker `no_jobs` / queue empty；eligible 輪次條件明確不成立 → 該 class streak 歸零 |
| UNPROVEN | eligible 輪次必要 log（cron run、audit、`net._http_response` body）遺失或無法回讀 → 歸零 |
| MIXED | class 訊號矛盾或期間轉態 → 歸零 |
| N/A | **僅限盤中 ineligible cycle**（09:07–13:07 平日）；不開始、不延續 streak |
| BLOCKED | 需改 code 或關閉盤中保護才可能通過 |

Exhausted 輪次若無可 defer 的 job：依凍結 gate（要求 `jobs_quota_deferred > 0`）記 **FAIL**（若 claim 成功但零 defer）或 **UNPROVEN**（若 body 遺失），**不得以 N/A 跳過**。

## 7. 校正時間表（自然、不手動觸發）

- **Exhausted 3/3**：今日 2026-08-13（四）**17:07、18:07、19:07**（近 7 日 ledger 顯示每日 16:00–23:59 為 `daily_exhausted`），回讀閘門 **Taipei 19:12**。三輪必須同屬 exhausted class。
- **Open 3/3**：**2026-08-14（五）00:07、01:07、02:07**（Taipei 00:00 quota reset 後的連續 eligible 區塊），回讀閘門 **Taipei 02:12**。
- 今日 14:07 / 15:07 雖為 open eligible，但後接 16:07 起的 exhausted 轉態，無法組成 3 連 → 不採計為正式 streak。

## 8. Remote version / deployment identity

v6.2 原文中 remote version 只出現在 **§6 Edge deploy gate 的 deploy-time read-back**（「remote version 遞增；remote source 對應 local hash」），**不在 §8 自然證據 gate**；§9 另明訂 cron request correlation 維持 UNKNOWN / best-effort。

既有唯讀 surfaces 盤點（不新增 telemetry）：Lovable 端 repo source hash（frozen artifact）、DB `md5(prosrc)` read-back、`edge_boot_events`、Supabase analytics function logs（有保留期缺口）。

結論：**per-cycle remote version / deployment_id 找不到即維持 UNKNOWN**；其 blocking 與否**依 v6.2 原文**——deploy-time gate 已於 Stage B 以 source/hash read-back 滿足；自然 gate 未列此項，故不因 UNKNOWN 判 FAIL，但也**不由本計畫自行宣布 non-blocking**，如需升級為 blocking 由你裁示。

## 9. Build 2 解鎖條件

scheduler + open 3/3 + exhausted 3/3（皆為嚴格連續 eligible streak）全 PASS 後，才可開 Build 2 Plan。目前 **blocked**。

## 10. 不做

- 不修改盤中保護（`is_tw_trading_hours`、`post_close_only`）。
- 不手動 trigger job106/job107/worker/Edge/RPC/`net.http_post`，不手動耗 quota。
- 不新增 telemetry、table、view、function、column、script、monitor。
- 不 migration、不 deploy、不 Publish。
- 不開始 Build 2。
