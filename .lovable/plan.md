# Build 1f — Gate Plan v7.2（討論稿，不執行）

自然 gate 沿用 v7.1（第 1–7 節原樣）；本版只改寫 remote identity 章節與 Build 2 解鎖條件。

## 1. 既有實作讀回（read-only 佐證）

- `is_tw_trading_hours()`：Asia/Taipei，週一～週五 09:00–13:29 為 in-hours。
- `claim_bsr_queue_jobs`：token slot 與 normal 兩段皆帶 `(NOT in_hours OR post_close_only = false)`；token slot `LIMIT 1`，排序 `next_run_at ASC, id ASC`。
- `recover_quota_failed_bsr_jobs`：cap 恆 1，只把 failed job 改回 `pending / last_error='quota_recovery_token'`，**不改寫 `post_close_only`**。
- 排程：job106 `2 * * * *`；job107 `7 * * * *`（`ignore_window:true` 只作用於 Edge 端，DB claim 仍受盤中保護）。
- 佇列現況：pending 11、recovery token 8（**8/8 `post_close_only = true`**）。

**可 claim 的 `:07` 輪次（Taipei）**：平日 `00:07–08:07`、`14:07–23:07`；`09:07–13:07` 不可。週六日全時段可。

## 2. Streak 語意（嚴格）

- target class streak 只由**時間上連續**的 eligible `:07` cycles 組成。
- 中斷：另一 class、eligible FAIL、MIXED、UNPROVEN。
- **N/A 僅限盤中 ineligible cycle**：不開始、不延續 streak。
- 正式計數重設 **open 0/3、exhausted 0/3**；舊 open 2/3 僅為行為佐證。

## 3. 兩套 gate（依實際 code 欄位）

Worker 回應欄位（`tw-bsr-finmind-sync/index.ts`）：`claimed`、`rows_written`（總和 L670）、`jobs_quota_deferred`（L673）、`jobs[]`（`job_id`/`priority`/`outcome`/`rows_written`/`last_error`，完成時 push）。Audit（`data_source_refresh_logs`，`bsr_quota_recovery`）：`budget_reason`、`tokens_issued`、`tokened_job_ids`、`reconciled_job_ids`、`cap`、`pools`、`degrade`。

**Open gate（每輪）**：audit 恰 1 筆且 `tokens_issued = 1`、`tokened_job_ids` 非空 → `:07` 唯一 HTTP 200 → 最舊 eligible token 被 claim → 該 token `rows_written > 0` → `tw_chip_fact` 對應 `stock_id + trade_date` 有 delta → 無非預期寫入、我方 write delta = 0。

**Exhausted gate（每輪）**：audit 恰 1 筆且明列 `budget_reason` / `tokened_job_ids` → `:07` 唯一 HTTP 200 → `jobs_quota_deferred > 0` → total `rows_written = 0` → 無 fact delta、無非預期寫入、我方 write delta = 0。

## 4. token-first 直證不可得

`jobs[]` 由 `recordOutcome` 於完成時推入 → 為 completion order，非 assignment order；body 無 assignment-order telemetry。**production 直證不可得**，只用 frozen source/hash read-back、最舊 token 被處理、時序推論作佐證，明確標示為推論。不新增 telemetry。非 blocking（v6.2 §8 僅要求 completion order 含該 id）。

## 5. Class 判定

`bsr_recovery_budget` branch：`kill_switch`、`degrade_claim_halt`/`degrade_p1_only`/`degrade_tier2_paused`/`degrade_reservation_stuck`、`pool_reserve_blocked`、`cap_1`、`cap_zero`；另 `lock_contended`。Pool 每日 reset = **Taipei 00:00（UTC 16:00）**，`finmind_quota_ledger.granted=false / reason='daily_exhausted'` 為 exhausted 權威訊號。

- **OPEN**：`:02` `budget_reason = cap_1` + `:07` `jobs_quota_deferred = 0` + 該時段 ledger 無 `daily_exhausted`。
- **EXHAUSTED**：`:02` `pool_reserve_blocked` / `cap_zero`（且 ledger 有 `daily_exhausted`）+ `:07` `jobs_quota_deferred > 0` 且 total `rows_written = 0`。
- **MIXED**：`:02` 與 `:07` 矛盾或期間轉態 → 中斷。
- **UNPROVEN**：`kill_switch` / `degrade_*` / `lock_contended` 或必要 log 缺失 → 中斷。

## 6. 結果分類

| 分類 | 條件 |
| --- | --- |
| PASS | 該 class 全部條件成立 |
| FAIL | eligible open 輪次發了 token 但 worker `no_jobs`/queue empty；eligible 輪次條件明確不成立 → streak 歸零 |
| UNPROVEN | eligible 輪次必要 log 遺失（cron run／audit／`net._http_response` body） → 歸零 |
| MIXED | class 訊號矛盾或轉態 → 歸零 |
| N/A | 僅限盤中 ineligible cycle |
| BLOCKED | 需改 code 或關閉盤中保護才可能通過 |

Eligible exhausted 輪次若 claim 成功但零 defer → **FAIL**；body 遺失 → **UNPROVEN**。不得以 N/A 跳過。

## 7. 時間表（自然、不手動觸發）

- **Exhausted 3/3**：2026-08-13（四）**17:07、18:07、19:07**，回讀閘門 Taipei 19:12（近 7 日 ledger 顯示每日 16:00–23:59 `daily_exhausted`）。
- **Open 3/3**：2026-08-14（五）**00:07、01:07、02:07**，回讀閘門 Taipei 02:12。
- 今日 14:07/15:07 因後接 exhausted 轉態，不構成 3 連，不採計。

## 8. Remote identity（v6.2 §6）— **UNPROVEN / BLOCKING**

**A) Stage B deploy 事實（對話歷史 #8526，2026-08-12 22:15）**
- 動作：於 **22:13–22:14 UTC** 完成 migration + 「只 deploy `tw-bsr-finmind-sync`」，回報 deploy 成功。
- 該報告原文：「**remote version/deployment_id 讀回為 PENDING**：管理 API token 不在此環境，`edge_boot_events` 對此 fn 目前 0 筆，最近 boot 為 22:07（部署前）」。
- 沒有任何 remote version、deployment_id、remote source identifier 被記錄。

**B) 三段鏈追溯（本輪唯讀查證）**
1. deploy action → remote version：**斷**。此環境無 Edge 管理 API surface，deploy 工具回傳未含 version/deployment_id，歷史亦未保存。
2. remote version → 自然 log：**斷**。`edge_boot_events` 全表**沒有任何 `fn` 含 `bsr`** 的列（該 fn 從未上報 boot event），無法取得 23:07 之後任一輪的 deployment_id。
3. remote source checksum / bundle identity：**不可讀**。無任何唯讀 surface 提供 remote bundle checksum，因此 frozen `index.ts 01b4f5b9…` / `lib.ts 300a1f29…` 無法與遠端關聯。
4. Analytics `function_edge_logs` **有** `version` / `deployment_id` 欄位，但實測保留窗僅約 **9–10 分鐘**（本輪查得 t0 01:19Z → t1 01:28Z），22:13 當時與 23:07 首輪自然 log 皆已不可回溯。
5. 本地 hash 與 DB `md5(prosrc) = c28474cc…` 只能證明 local repo 與 DB 函式，**不能證明遠端 Edge source**。

**C) 22:14 之後是否另有 deploy**
- 對話歷史中無其他 `tw-bsr-finmind-sync` deploy 紀錄；但**沒有任何遠端 deployment history surface 可查**，故只能記為「**無法排除**」，不得假設沒有。

**D) 依 v6.2 §6 逐條判定**

| §6 條款 | 判定 |
| --- | --- |
| 只 deploy `tw-bsr-finmind-sync`，不 deploy 其他、不 Publish | PASS（歷史紀錄） |
| read-back：remote version 遞增 | **UNPROVEN** |
| read-back：remote source 對應 local `lib.ts 300a1f29…` / `index.ts 01b4f5b9…` | **UNPROVEN** |
| response JSON 139 keys、added=0/removed=0 | PASS（deploy 當時比對） |

→ **v6.2 §6 deploy identity gate = UNPROVEN，且為 BLOCKING**。不得以「§8 未要求」繞過，也不得以行為推論或「目前 version 311」等替代宣稱滿足。

**最小可行、零 side effect 的補救（僅提案，未執行）**
- 在自然 `:07`（job107）發生後的 **9 分鐘保留窗內**，純 SELECT `function_edge_logs` 取該 fn 的 `version` / `deployment_id`。此為讀取既有平台 log，無寫入、無 invoke、無 telemetry 新增。
- 此法可建立「自然 log → 目前 remote version/deployment_id」與後續各輪的**版本連續性**，但**仍無法**回溯連到 22:13 的 deploy action，也無法取得 remote source checksum。
- 因此：即使補齊，§6 的「remote version 遞增」「remote source 對應 local hash」兩條仍為 **UNPROVEN**，除非你接受「連續性 + 無其他 deploy 紀錄」作為替代證據，或另行提供管理 API 唯讀憑證。
- 若兩者皆不可行 → 誠實記為 **BLOCKED**；不新增 telemetry、不 deploy、不 manual invoke。

## 9. Build 2 解鎖條件

需同時 PASS：**scheduler** + **v6.2 §6 deploy identity** + **exhausted 3/3** + **open 3/3**。目前 deploy identity = UNPROVEN/BLOCKING → Build 2 **blocked**。

## 10. 不做

- 不修改盤中保護（`is_tw_trading_hours`、`post_close_only`）。
- 不手動 trigger job106/job107/worker/Edge/RPC/`net.http_post`，不手動耗 quota。
- 不新增 telemetry、table、view、function、column、script、monitor。
- 不 migration、不 deploy、不 Publish。
- 不開始 Build 2。
