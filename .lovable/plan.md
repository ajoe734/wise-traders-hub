# Build 1f — Gate Plan v7（討論稿，不執行）

第 3 個 literal cron cycle（Taipei 09:02 / 09:07）為真實 FAIL：token 全數 `post_close_only = true`，09:07 屬盤中，`claim_bsr_queue_jobs` 合法排除 → `no_jobs`。此結果**不改寫為 PASS**，也**不關閉盤中保護**。

## 1. 既有實作讀回（read-only 佐證）

- `is_tw_trading_hours()`：Asia/Taipei，週一～週五，09:00–13:29 為 in-hours。
- `claim_bsr_queue_jobs(_batch, _max_priority)`：token slot 與 normal 兩段皆帶 `(NOT in_hours OR post_close_only = false)`。token slot `LIMIT 1`，排序 `next_run_at ASC, id ASC`。
- `recover_quota_failed_bsr_jobs()`：cap 恆為 1，只把 failed job 改回 `pending / last_error='quota_recovery_token'`，**不會改寫 `post_close_only`** → token 沿用原 job（由 `enqueue_chips_prefetch_gaps` 產生）的 `post_close_only = true`。
- 排程：job106 `2 * * * *`（`enqueue_chips_prefetch_gaps(10,300)`）、job107 `7 * * * *`（`tw-bsr-finmind-sync` worker，`ignore_window:true` 僅作用於 Edge 端，DB claim 仍受 `is_tw_trading_hours` 管）。
- 目前佇列：pending 11，其中 recovery token 8 筆，**8 筆全部 `post_close_only = true`**，最舊 token `next_run_at = 2026-08-12 18:02Z`。

**結論**：09:07 回 `no_jobs` **完全符合既有產品安全語意**（盤中不對外抓 BSR），不是 bug。

**Taipei 一天中可 claim token 的 `:07` 自然輪次**
- 週一～週五：`00:07–08:07` 與 `14:07–23:07`（19 個/日）。**不可** claim：`09:07、10:07、11:07、12:07、13:07`（13:07 < 13:30 仍屬盤中）。
- 週六、週日：`00:07–23:07` 全部可 claim（另有 job98 每 10 分鐘）。

## 2. 「連續 3 輪」原文稽核

凍結原文（`.lovable/plan/build-1f-final-plan-v6-2-...md` 第 8 節）只寫「**Open window：連續 3 輪**」「**Exhausted window：連續 ≥ 3 輪**」，**未定義**是 literal cron cycle 還是 eligible cycle。屬文字不明確。

依較嚴格方案處置：
- 既有 open 2/3 **降級為行為佐證**，不計入正式連續計數。
- **計數重設為 open 0/3、exhausted 0/3**，從下一個 eligible cycle 起算。
- 不修改任何 code / SQL 以遷就計數。

## 3. Quota 事實（read-only）

- Pool 每日額度：`interactive 240`、`keepwarm 960`（base 480 + boost）、`backfill 600`；`bsr_recovery_budget` 保留 `DAILY_RESERVE 30` / `BURST_RESERVE 30`，`interactive` 排除於發 token 之外。
- Reset 時點：`finmind_quota_pools.reset_at` 為 date，ledger 顯示每日 **Taipei 00:00（UTC 16:00）**恢復 granted。
- 共用消費者（自然、非手動）：job46 盤中 worker、job51 tier1 catchup、job98 週末 worker、job107 每小時 worker、job45 收盤 enqueue、job38 institutional sync、以及使用者互動抽屜（interactive pool）。
- 近 7 日 `daily_exhausted` 實測時窗（Taipei，來自 `finmind_quota_ledger`）：**每日約 16:00–16:59 起進入 exhausted，持續到 23:59**；00:00 後全數恢復 granted（08-10、08-11、08-12 三日一致）。

**推估最早自然驗收時窗（今天 2026-08-13 週四）**
- Exhausted class eligible `:07` 輪次：**17:07、18:07、19:07**（今日即可湊滿 3 連），回讀閘門 Taipei 19:12。
- Open class eligible `:07` 輪次：今日 **14:07、15:07**，再接 **08-14（五）00:07**，回讀閘門 Taipei 08-14 00:12。
- 不手動耗 quota、不手動 trigger。

## 4. 兩個 gate 的可達性

- **Open gate**：可達。條件是該輪 job106 `budget_reason = cap_1` 且發出 token、且 `:07` 落在非盤中時段。今日 14:07/15:07 pool 尚未 exhausted，符合。
- **Exhausted gate**：可達，但有一項風險（非 BLOCKER）：`jobs_quota_deferred > 0` 需要該輪 claim 得到至少 1 筆 job。目前 pending 11 筆、且 17:07 後 `post_close_only` 限制解除，可滿足；若某輪 claim 回 `no_jobs`（佇列被清空），該輪記 **N/A 不計數**、不記 FAIL，等下一輪。
- **BLOCKER（明列，不降低條件）**：無法在盤中（09:07–13:07）取得任何 token-first 直證，這是既有安全語意的必然結果。因此 gate 只在 eligible cycle 上驗收，literal 盤中輪次一律 **N/A**。

## 5. 每輪 read-only acceptance（重新定義）

每個 eligible cycle 需同時具備：
1. `cron.job_run_details` 中 job106（`:02`）與 job107（`:07`）各 1 筆 succeeded runid。
2. `data_source_refresh_logs` 中該輪 `bsr_quota_recovery` **恰 1 筆** audit，記 `budget_reason` 與 `tokened_job_ids`。
3. `net._http_response` 該輪唯一一筆 HTTP 200 與其 body（自然 dispatch，不得手動）。
4. 最舊 eligible recovery token 的 FIFO 證據（可以不是本輪新發 token）。
5. token-first：**直證**（body `jobs[]` 首位為該 token id）與**推論**（以 `finished_at` 排序推得）分開標記，不得混充。
6. 該 token `rows_written > 0`，且 `tw_chip_fact` 對應 `stock_id + trade_date` 有 delta。
7. 整批 totals / quota 消耗、`tw_chip_fact`、`tw_bsr_daily`、queue 的非預期寫入檢查。
8. 我方 production write delta = 0。

Exhausted 輪次改判定：HTTP 200、`jobs_quota_deferred > 0`、`total rows_written = 0`、無非預期寫入。

**Cycle class 事前判定規則**（避免事後挑輪次）：以該輪 job106 audit 的 `budget_reason` 決定 —— `cap_1` → open class；`pool_reserve_blocked` / `cap_zero` → exhausted class。兩個計數器各自獨立累計，class 不同不互相 reset。

**version / deployment_id**：`edge_boot_events` 與 analytics 保留不足時維持 **UNKNOWN**，明列為 **非 blocking gate**（Stage B 已有 DB `md5(prosrc)` 與 Edge 原始碼 hash 作為身分證據），不猜測。

## 6. Plan v7 交付內容

| 項目 | 定義 |
| --- | --- |
| Gate 單位 | eligible `:07` cycle（非 literal cron cycle） |
| 計數 | open 重設 0/3、exhausted 重設 0/3；舊 2/3 僅列為行為佐證 |
| PASS | 同 class 連續 3 個 eligible cycle 全部滿足第 5 節條件 |
| FAIL | eligible cycle 中條件未達（例：token 存在卻未被 claim、rows_written=0 於 open class）→ 該 class 歸零重數 |
| N/A | 盤中輪次、claim `no_jobs` 且佇列為空、pg_net 記錄已被清除且無替代證據 |
| BLOCKED | 需要改 code 或關閉盤中保護才可能通過者 |
| 最早時間表 | exhausted 3/3 最快 Taipei 08-13 19:12 回讀；open 3/3 最快 Taipei 08-14 00:12 回讀 |
| Build 2 解鎖 | scheduler + open 3/3 + exhausted 3/3 全 PASS 後才可開 Build 2 Plan；目前 blocked |

**不做**
- 不修改盤中保護（`is_tw_trading_hours`、`post_close_only`）。
- 不手動 trigger job106/job107/worker/Edge/RPC/`net.http_post`，不手動耗 quota。
- 不新增任何 table / view / function / column / script / monitor。
- 不 migration、不 deploy、不 Publish。
- 不開始 Build 2。
