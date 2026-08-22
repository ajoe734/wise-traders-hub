# 持倉看板背景回補 — 唯讀稽核 findings 與續作 Plan

本輪 0 變更：未改 code / schema / RLS / RPC / cron / data，未 deploy、未 Publish。以下全部是 production 唯讀查詢與檔案搜尋的實測結果。

## 0. 結論先講

背景預抓「有排程、有被呼叫、但實際 0 產出」。**worker 每次都 fail-closed 直接返回 HTTP 200**，所以 cron 全綠是假訊號。同時上游 FinMind 分點來源仍是 sponsor 等級拒絕。狀態維持 **PARTIAL**。

兩個獨立阻斷點：

| # | 阻斷點 | 證據 | 影響 |
|---|---|---|---|
| **P0-A** | 部署漂移：Stage B 版 `tw-bsr-finmind-sync` 已上 production，但 Stage B 的 SQL 從未套用到 production | 每次 worker 回應：`{"ok":true,"note":"admission_gate_closed","admission":{"decision":"rpc_error","reason":"admission_status_rpc_error:Could not find the function public.bsr_admission_status without parameters in the schema cache"},"claimed":0,"processed":0,"provider_calls":0}`。`pg_proc` 查 `%admission%` 只有 `bsr_check_tier_admission(_api,_tier,_limit)`，**沒有** `bsr_admission_status()`。該函式只存在於 `db/r1/c/SB/001_stage_b.sql`（clone 排練用），`supabase/migrations/` 內完全沒有 | 所有 BSR worker（46 / 51 / 98 / 107）claim=0，14 天內 `tw_bsr_attempt_logs` = 0 筆 |
| **P0-B** | 上游 FinMind 分點來源不可用 | `tw_bsr_sync_config.market_batch`：`supported:false`、`last_probe_outcome:unsupported`、`last_probe_error:unsupported_plan:http_400:{"msg":"Your level is register..."}`、`probed_at 2026-08-17T13:30Z` | 即使 P0-A 修好，分點仍抓不到；三大法人／價量不受影響 |

## 1. 現況盤點（exact）

### 檔案 / 函式
- Edge（production 已部署）：`tw-bsr-finmind-sync`（enqueue/worker/probe）、`tw-chips-orchestrator`、`chips-guardian`、`tw-bsr-window-converge`、`tw-institutional-daily-sync`、`backfill-snapshots-twse-bulk`、`tw-chips-detail`、`tw-chips-detail-v2`（side-by-side）。
- Shared：`supabase/functions/_shared/bsrAdmissionGate.ts`（呼叫 `bsr_admission_status`，即 P0-A 來源）。
- 前端：`ChipsSection` → `useChipsLifecycle` → `useChipsAutoBackfill` / `useChipsBackfill` → Gateway；`src/checkup/lib/chipsRepository.ts` 預設端點已切 `tw-chips-detail-v2`（rollback 用 `VITE_CHIPS_ENDPOINT`）。此路徑只是 fallback，非主要供給者。
- Clone-only、**未進 production**：`db/r1/c/SB/001_stage_b.sql`（`bsr_admission_status` / `bsr_block_and_terminalize_claims` / `bsr_unblock_after_probe` / `tw_bsr_sync_queue_admission_gate`）。

### Cron（production，全部 active）
| jobid | name | schedule |
|---|---|---|
| 106 | chips-prefetch-enqueue-hourly | `2 * * * *`（純 SQL：`enqueue_chips_prefetch_gaps(10,300)`） |
| 107 | tw-bsr-worker-hourly | `7 * * * *` |
| 46 | tw-bsr-worker-trading | `*/10 6-12 * * 1-5` |
| 51 | tw-bsr-worker-tier1-catchup | `*/15 6-12 * * 1-5` |
| 98 | tw-bsr-worker-weekend | `*/10 * * * 6,0` |
| 45 / 53 | enqueue post-close / holdings-delta | `30 7 * * 1-5` / `0,30 7-12 * * 1-5` |
| 80/81/82 | tw-chips-orchestrator wave1-3 | `35 7,9,11 * * 1-5` |
| 69 / 96 / 50 / 47 | guardian / reap-stale / purge-reservations / prune | `*/10`, `*/10`, `* * * * *`, `0 20 * * *` |
| 72 | tw-institutional-fastlane | `0 * * * *` |
| 87 / 99 | twse-bulk 日 / 週末 | `15 7 * * 1-5` / `20 7,13 * * 6,0` |

### Kill switch（`enabled=true` = 放行）
`chips_all=true`、`chips_interactive=true`、`chips_backfill=true`、**`chips_keepwarm=false`（關閉，updated_at 2026-08-22T01:20:47Z）** — keepwarm lane 目前是關的，需確認是 guardian 自動降級還是殘留手動設定。

## 2. 最近 cron 真鏈（runid → request_id → HTTP → job）

`cron.job_run_details` 對應 `net._http_response`（本輪 8 小時內全部 `status_code=200`、`timed_out=false`）：

| runid | jobid | scheduled (UTC) | cron status | net response id | HTTP | body 摘要 |
|---|---|---|---|---|---|---|
| 584875 | 107 | 02:07:00 | succeeded | 272088 | 200 | admission_gate_closed, claimed 0, processed 0, provider_calls 0, run_id `55940668…` |
| 584588 | 107 | 01:07:00 | succeeded | 271934 | 200 | 同上，run_id `336c8eb2…` |
| — | 98 | 02:10:57 | succeeded | 272098 | 200 | 同上，run_id `c838c0ae…` |
| — | 98 | 02:00:02 | succeeded | 272067 | 200 | run_id `bc289e2c…` |
| — | 98 | 01:50:01 | succeeded | 272044 | 200 | run_id `99760172…` |
| — | 98 | 01:40:04 | succeeded | 272018 | 200 | run_id `7c9cc52f…` |
| — | 98 | 01:30:05 | succeeded | 271996 | 200 | run_id `38564035…` |
| — | 98 | 01:20:46 | succeeded | 271970 | 200 | run_id `74f91856…` |
| 584853 | 106 | 02:02:00（5.3s） | succeeded | —（純 SQL 無 HTTP） | — | enqueue 端仍會跑，但下游無人消化 |

enqueue / claim / done / failed / skipped：
- queue 總計 `done 8432 / pending 548 / failed 1572`。
- pending 的 `next_run_at` 最早停在 **2026-08-17 12:58Z**，代表 5 天沒有任何 claim。
- 近 48h 有 updated 的 pending：`chips_prefetch_hourly:r1` 70、`:r3` 62、`tier1_first_fetch` 9、`tier1_holdings` 3。
- `tw_bsr_attempt_logs` 近 14 天 **0 筆**；`tw_bsr_fetch_failures` 近 30 天 5331 筆、最後一筆 **2026-08-17 07:21Z**。

→ 真鏈在「HTTP 200」這一格就斷了，之後沒有任何 job／provider call。這正是「週末 worker 98 空轉」的同型錯誤，但這次不是 queue 空（有 548 pending），是 gate fail-closed。

## 3. Coverage（canonical，同一段 SQL）

INIT_HOLDINGS 20 檔（`src/checkup/seedData.js`）實測：

| 分類 | 代號 | BSR latest | chip_fact | 三大法人 | OHLCV | pending / failed |
|---|---|---|---|---|---|---|
| TW 普通股（16 檔，`^[1-9]\d{3}$`，eligible=true） | 1503 1717 2308 2313 2543 3006 3013 3017 3231 3443 3491 4583 6274 6770 6862 8227 | **全部 2026-08-14（stale 5 交易日）** | 2026-08-14 | 2026-08-21（3491/6274/8227 為 08-17） | 2026-08-21 | 各 5–6 pending；2543/4583/6862 各 1 failed、3006 4 failed |
| 非 TW 普通股（4 檔） | `00637L`（invalid_stock_id）、`039108`／`053848`（unsupported_asset_type）、`702157`（invalid_stock_id） | 無（正確） | 無 | 有（00637L 08-21、053848 08-19、039108 05-04、702157 07-28） | 08-20~08-21 | **0 / 0 — 沒有製造假 failed job，符合要求** |

點名核對：**3017 / 4583 / 6862 三檔 BSR 都停在 2026-08-14**，各有 5 筆 pending（6862、4583 另各 1 failed），與 8/10 baseline 的 `6862 = NONE` 相比已有資料，但自 8/14 起再無推進。

全表：`tw_bsr_daily` max 2026-08-14（3,679,883 列）、`tw_chip_fact` max 2026-08-14、`tw_institutional_daily` max **2026-08-21**（19,087,755 列）。US 標的不進 BSR，走各自價量來源，無 BSR 缺口概念。

## 4. 「不靠開抽屜／不靠登入」的證明與缺口

已成立：`enqueue_chips_prefetch_gaps` → `detect_chip_gap_jobs` → **`checkup_prefetch_universe()`**（server-side single source of truth，SECURITY DEFINER），universe 由四個來源 UNION：
1. `trade_records`（TW/TWSE/TPEX，任何使用者持股）
2. `expert_signals`（已發佈）
3. **`checkup_storage`，`key='pf-holdings-v2'`，讀 `cs.data`（陣列或 `data->'holdings'`）** — 舊的 `payload` bug **已修**，production 函式定義確認用 `cs.data`
4. `chips_prefetch_targets`（registry，active 20 筆＝16 supported ＋ 4 unsupported）

排序公平性：`source_rank` 1=checkup_storage、2=open trade_records、3=registry，避免 demo seed 餓死真實使用者持股。新標的自動被下一輪 hourly gap detect 涵蓋，無需硬編碼。

缺口：**universe 正確不等於有資料**。目前 rank 1/3 都排進 queue 了（`chips_prefetch_hourly:r1 / :r3`），但 worker 一律 claim=0。所以「不依賴開抽屜」在 enqueue 這一半成立，在 fulfil 這一半**尚未成立**。

## 5. 節流 / 冪等 / 鎖 稽核

| 項目 | 現況 |
|---|---|
| 每批上限 | worker `batch:30`、`budget_ms:45000`；enqueue `p_max_stocks` 預設 300、hourly 用 (10, 300) |
| 冪等 / dedupe | `INSERT ... ON CONFLICT DO NOTHING` + 先查 `tw_bsr_daily` 存在才排；`detect_chip_gap_jobs` 排除已有 pending/running |
| lease / lock | `tw_bsr_sync_locks`、`purge_expired_bsr_reservations`（每分鐘）、`reap_stale_bsr_queue_jobs(60)`（每 10 分）、`lock_ttl_sec:90` |
| 防重疊 | `finmind_inflight_requests` + `finmind_admit_v2` + `finmind_quota_pools`（token bucket：`capacity/tokens/refill_per_min/daily_budget`） |
| retry / backoff | `backoff_steps_sec:[60,300,1800,7200,21600]`、`max_consecutive_before_freeze:4`、`freeze_window_ms:86400000`；`degrade:finmind` 目前 `mode:normal` |
| dead-letter | `tw_bsr_fetch_failures`（5331 筆）、queue `failed` 1572；`recover_quota_failed_bsr_jobs` 受 `bsr_recovery_budget(12)` 限量 |
| 只放行普通台股 | `tw_bsr_eligibility()` 已把 ETF / 權證 / 美股標成 `unsupported_asset_type` / `invalid_stock_id`，實測 4 檔 pending=0、failed=0 |
| API storm | enqueue 端持續生 job 但 worker 不消化 → 目前**沒有** storm，但 gate 一旦修好，548 pending 會一次湧入，需先確認 pool 預算與 batch 上限 |

風險：`circuit_breaker_config.enabled=false`、`warm_chips_cache_enabled.enabled=false`、`chips_keepwarm` 關閉 — 修 gate 前要先確定這三者的期望狀態，否則會在錯誤的保護等級下開閘。

## 6. checkup_storage / RLS contract test

- `checkup_storage.data` bug：**已修**（production `checkup_prefetch_universe` 用 `cs.data`）。
- 既有測試：`supabase/tests/chips_prefetch_universe_test.sql`、`chips_lane_a_fairness_test.sql`、`institutional_fairness_backoff_test.sql`、`bsr_acl_metadata_test.sql`。
- 缺口（列為必補）：
  1. 沒有任何測試 assert **`bsrAdmissionGate.ts` 呼叫的每個 RPC 都存在於 `supabase/migrations/`**（P0-A 就是被這個洞放行的）。
  2. 沒有 INIT_HOLDINGS contract test（20 檔 ↔ registry ↔ eligibility 分類）。
  3. 沒有一般會員 RLS 路徑下的 `pf-holdings-v2` → universe 端對端 contract test。

## 7. 分階段修復 Plan（待審核後才 Build）

### Stage 1 — 解除部署漂移（最小、可逆）
把 `db/r1/c/SB/001_stage_b.sql` 中**僅 gate 相關**的物件（`bsr_admission_status()`、`bsr_block_and_terminalize_claims`、`bsr_unblock_after_probe`、`tw_bsr_sync_queue_admission_gate` 及其 REVOKE/GRANT）整理為單一 production migration，SQL 逐字沿用已排練版本，不改語意。
- 驗收：`pg_proc` 有該函式；下一個 `:07` worker HTTP body 不再出現 `admission_status_rpc_error`；貼出 runid → request_id → HTTP → run_id → claimed>0。
- Rollback：`db/r1/c/SB/099_rollback.sql`（已存在，DROP 這幾支函式即回到今天的行為，worker 回到 claim=0，不會壞既有資料）。

### Stage 2 — 開閘前的保護等級定案
確認 `chips_keepwarm` 為何在 01:20 被關、`circuit_breaker_config.enabled=false` 是否刻意；必要時只調這兩個旗標，不動 batch。
- 驗收：貼出開閘後首 3 個 worker 週期的 `provider_calls`、pool `tokens/used_today`、無 429/freeze。

### Stage 3 — 分點上游決策（P0-B，需你裁決）
FinMind sponsor 級別擋住全市場分點。三選一：(a) 升級 FinMind 方案；(b) 換授權來源；(c) 正式把 BSR 標為 unavailable，只保證三大法人＋價量新鮮度。**在 (a)/(b) 落地前，Stage 1/2 只能證明 pipeline 活著，無法讓 BSR 前進到 08-21。**
- 驗收：BSR latest 推進到最新交易日，或 UI 明示 unavailable（分段新鮮度已具備）。

### Stage 4 — 防再犯的 contract tests
1. 靜態測試：掃 `supabase/functions/**` 內所有 `.rpc('…')`，assert 每個名稱都能在 `supabase/migrations/**` 找到定義（會直接紅在今天這個 bug 上）。
2. INIT_HOLDINGS contract test：20 檔以 **server-side registry** 為準（不散落硬編碼 SQL），assert 16 supported / 4 unsupported 分類與 `tw_bsr_eligibility` 一致。
3. `pf-holdings-v2` → `checkup_prefetch_universe` 端對端測試，禁止 zero-fill / mock。
4. Guardian 加一條 alert：worker 連續 N 次 `claimed=0` 但 `pending>0` 即告警（今天這種「綠燈空轉」就會被抓到）。

### Stage 5 — 結案驗收（缺一即維持 PARTIAL）
- cron runid → request_id → HTTP 200 → run_id → claimed/processed/provider_calls > 0 → coverage after（同一段 canonical SQL 前後對照，含 3017 / 4583 / 6862）。
- fresh Preview 直接載入 `/holding-checkup`，**不開任何個股抽屜**，驗 20 檔＋另一位真實使用者持股：network fan-out、console 0 error、前端 stale/unsupported 狀態正確。
- 測試綠燈或空 queue 不列為證據。

## 目前正在跑的可觀測 ID（不要重排第二個任務）
- cron jobid 106（`:02` enqueue）、107（`:07` worker）、98（週末 `*/10`）皆 active 且每次 succeeded。
- 最新 worker run_id：`c838c0ae-1b0b-4125-9caa-b50d35c5f333`（02:10:57Z）、`55940668-ea43-403f-ae94-c42c8642a36f`（02:07Z）。
- 對應 net response id：272098 / 272088。三者都是 claimed=0，屬空轉，非進行中的有效任務。
