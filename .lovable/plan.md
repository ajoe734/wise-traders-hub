# Plan v2 — BSR 單一垂直切片：持股新鮮度 + 全市場公平輪轉

已於 2026-08-12 07:00Z 重新查證 production definitions。以下每個「現況」皆有對應查詢佐證。

## v1 問題 → v2 修正

| # | v1 問題 | v2 修正 |
| --- | --- | --- |
| 1 | job 106 宣稱唯一 owner，卻留 job 45 tier2 | 查證 tier2 可由 cron payload 單獨關閉（`body?.tier2 !== false`），canary 期間 job 45 改 `tier2:false`，並停 job 70 converge，達成單一 T86 owner |
| 2 | 300/hr 上界與實際 ~30 jobs/hr 消化量脫節 | 改用四種單位分開表述；insert cap 以 **queue jobs/hour** 表示（總 24/hr），加 pending/age/quota 三重 backpressure |
| 3 | 1,728 failed 留待 PASS 後 | 已完成分類（100% quota 類），本切片內含 bounded quota-requeue，且改由 worker 不再把 quota 記成 failed |
| 4 | 只列 migration，未列 Edge Function | 納入 `tw-bsr-finmind-sync/index.ts`（quota→skipped、回報 rows/materialized）與 focused tests；同時修正 v1 錯誤指控：worker 目前**沒有**把 empty 標 done |
| 5 | materialize overload 只列 blocker | 已查證 overload 仍在（date / date+text[] 兩個 signature），最小修法：orchestrator 呼叫端明確轉型 `_trade_date::date`＋帶 `_stock_ids: null` |
| 6 | Lane A 只保證「入列」 | 依實測 63 檔 supported、11 檔缺最新日，訂出可驗證 materialization SLA 與 priority 證明 |
| 7 | cursor 原子性含糊 | 依實際 `tw_bsr_sync_config` PK(key)+version 欄位設計 CAS；lock 取不到記 `skipped_locked` |
| 8 | 忽略既有 (10,300) 參數語意 | 明確定義新舊參數對應與相容性 |
| 9 | 驗收缺門檻 | 全部改為數值門檻，並要求 authenticated pf-holdings-v2 路徑 |

## A. 現況查證（2026-08-12 07:00Z）

- **T86 universe**：最新交易日 4 碼普通股 **2,016** 檔；`tw_bsr_daily` 2026-08-11 覆蓋 **517**（25.6%）；**563 檔從未有任何 BSR**。
- **Queue**：pending 401、running 11、failed 1,728、done 9,176。
- **實際消化量**：非交易時段 **30 jobs/hr**（job 107 + batch 30），台北收盤時段峰值 ~210/hr；近 24h 合計約 **500–700 jobs/day**。Quota ledger 24h：granted 1,074、rejected 997（keepwarm daily_exhausted 862）。
- **失敗分類（全部 1,728 筆）**：`finmind_admission_daily_exhausted` 1,466、`finmind_admission_rate_limited` 235、其他 27——**100% 為 quota 類，0 筆 upstream/empty/date/unsupported**。全部 `attempts ≥ 5`。
- **飢餓機制證實**：`recover_stale_bsr_queue_jobs` 只復活 `attempts < max_attempts` 且屬持股 universe 者 → 這 1,728 筆永不復活；又因 `tw_bsr_sync_queue_active_uniq`（含 failed）而永遠 dedupe 掉新候選。
- **T86 寫入者盤點**：
  - job 45 `tier2:true` → `enqueueTier2Gaps`：T86 全市場 gap，**是**目前唯一全市場 owner。
  - job 53 已是 `tier2:false`，不衝突。
  - job 106 `enqueue_chips_prefetch_gaps(10,300)` → `detect_chip_gap_jobs` → universe 只有 `checkup_prefetch_universe()`（持股/訊號/registry），**不是**全市場。
  - job 70 `converge_bsr_windows`：持股/訊號 universe，會寫同一 stock/date，需納入互斥。
  - `tw-bsr-daily-sync` priority2 路徑僅在該函式自身流程觸發，非 cron 常態全市場來源。
- **Lane A 實際規模**：supported 63 檔、缺 08-11 者 11 檔、never-covered 0 檔、pending 64、failed 219。
- **Materialize**：兩個 overload 同時存在（`(date)`、`(date, text[])`），orchestrator 以具名參數 `_trade_date` 呼叫 → 仍會 ambiguous。`tw_bsr_daily_snapshot_status` 最新僅到 2026-07-27（皆 legacy_migration），代表 orchestrator 自 7/27 起未成功落地任何 sealed 記錄；但 `tw_chip_fact` 08-11 有 156,180 筆 → **fact 有、daily 落後**，正是需修的落地層。
- **Kill switch**：`chips_all`/`chips_keepwarm`/`chips_interactive`/`chips_backfill` 全 enabled；degrade mode = normal。

## B. 單一 owner（互斥，先做，否則無法歸因）

1. job 45 payload 改為 `{"mode":"enqueue","tier1":true,"tier2":false}`（`cron.alter_job`，一行可回滾）。tier1 持股保留。
2. job 70 `tw-bsr-window-converge` canary 期間停用（`cron.alter_job(70, active:=false)`）。
3. canary 期間全市場 T86 只剩 job 106 一個 owner；所有 insert 以 `enqueued_by` 標記 `lane_a_holdings` / `lane_b_rotation`，作為 attribution 依據。
4. 若上述任一 cron 無法單獨關閉即為 blocker——已查證可關，非 blocker。

## C. 量能與 backpressure（四種單位分離）

定義：`candidates_inspected`（cursor 掃過的代碼數）、`stocks_selected`、`queue_jobs_inserted`、`api_calls`。cap 只綁 **queue_jobs_inserted / hour**。

- 總 insert cap：**24 jobs/hr**（= 實測 30 jobs/hr 消化量的 80%）。
  - Lane A：最多 16 jobs/hr（63 檔 × 最多 3 日期，穩態每日新增缺口僅約 11）。
  - Lane B：保底 8 jobs/hr（A 用不完則補到 24）→ 約 192 jobs/day，與 quota 餘裕相符。
- Backpressure（enqueue 前評估，任一命中即 B=0）：
  - `pending > 600`
  - 最老 pending age > 6h
  - keepwarm `used_today ≥ 0.8 × daily_budget`
  - degrade mode ≠ normal
  - A 仍保留最小 SLA 配額 8 jobs/hr（除非 `chips_all` 關閉）。
- cursor 掃描上限（`candidates_inspected`）可到 300/輪，但**只要 insert cap 用盡就立即停止**，cursor 只前進到最後一個已處理代碼，不得跨過未 enqueue 的 gap。

## D. Failed 1,728 的 bounded 回收

- 分類結論：全部 quota 類 → **retryable**。（若未來出現 upstream/date/unsupported，維持不復活。）
- 本切片內：
  - Worker 修正：quota 拒絕不再寫 `failed`，改 `status='skipped_quota'` 語意（沿用既有 `pending` + `next_run_at` 退避，不新增 status 值，`last_error` 標 `quota_deferred`），且**不累加 attempts**。
  - 一次性 bounded requeue：僅針對 `last_error LIKE 'finmind_admission_%'` 者，將 attempts 重設為 `max_attempts - 1`（單次機會）、`status='pending'`、`next_run_at` 依 stock 雜湊分散 0–24h，避免瞬間洪峰。非 quota 類不動。
  - 唯一 stale recovery owner：canary 期間 `recover_stale_bsr_queue_jobs`（job 106 內）只處理 `running` 逾時；`reap_stale_bsr_queue_jobs`（job 96）維持不變且不碰 failed，避免兩套 recovery 互踩。

## E. Materialize 落地層修正

- orchestrator 呼叫改為明確 signature：`materialize_bsr_daily_from_fact(_trade_date => tradeDate::date, _stock_ids => null)`，不重構、不刪 overload。
- 加 focused regression：呼叫成功、回傳 `materialized_rows`，且 `tw_bsr_daily` 該日 rows 增加。
- PASS 需雙層可說明：`tw_chip_fact` rows 增加 → 對應日 `tw_bsr_daily` materialized（或 snapshot_status 誠實 partial）。

## F. Cursor 原子性

- `tw_bsr_sync_config` PK = `key`，含 `config jsonb` / `version int` / history trigger → 可 CAS：`UPDATE ... SET config=..., version=version+1 WHERE key='laneB_cursor' AND version=$expected`。
- 單一 transaction 涵蓋「掃描 → insert → cursor update」；以 `pg_try_advisory_xact_lock` 保護，取不到只回 `{skipped_locked:true}`，不算成功、不推進 cursor。
- wrap：掃到尾端即結束本輪，剩餘 cap 不同輪續掃（避免同輪重複掃描歸因困難），下輪從頭開始。
- `universe_date` 變更時記錄於 cursor payload；低於 cursor 的新代碼於下一次 wrap（預估 2,016 / 192 ≈ 11 天）內必被掃到；若超過 SLA 則告警。

## G. Lane A SLA 與 priority

- SLA：`expected_latest_bsr_date()` 前進後 **6 小時內**（或次一開盤前，取較早者），Lane A 63 檔中 ≥ 95% 於 `tw_bsr_daily` 有該日資料。依據：每日新增缺口約 11 檔，實測 30 jobs/hr → 理論 <1 小時可清。
- Priority：Lane A 一律 `priority=1`、`post_close_only=false`；Lane B 一律 `priority=3`。`claim_bsr_queue_jobs` 的 `ORDER BY priority ASC, next_run_at ASC, id ASC` 保證 A 先被 claim；job 51（`max_priority:1`）為 A 專用通道，不受 B 積壓影響。
- 驗收必須走 authenticated `pf-holdings-v2` 路徑（真實登入帳號的持股），不得用 demo 代替；若無可用登入 session 則標 blocker。

## 變更清單（精確）

| 類型 | 檔案 / 物件 |
| --- | --- |
| Migration | `enqueue_chips_prefetch_gaps(int,int)` 改寫（雙 lane + cursor + backpressure + 回傳 JSON）；新增 `tw_bsr_sync_config` key `laneB_cursor` 初始 row |
| 資料（一次性） | bounded quota requeue（僅 `finmind_admission_%`） |
| Cron payload | job 45 → `tier2:false`；job 70 → inactive（canary） |
| Edge Function | `supabase/functions/tw-bsr-finmind-sync/index.ts`（quota 不記 failed、不加 attempts；HTTP body 增 `rows_written`/`materialized_rows`/`coverage_delta`/`quota_deferred`，既有欄位保留） |
| Edge Function | `supabase/functions/tw-chips-orchestrator/index.ts`（materialize signature 明確化） |
| SQL tests | `supabase/tests/bsr_lane_ab_test.sql`（A/B cap、backpressure、cursor CAS、wrap 不漏 gap） |
| Unit tests | `supabase/functions/tw-bsr-finmind-sync/lib_test.ts` 增 quota-deferred 分支 |
| CI | `.github/workflows/finmind-bsr-tests.yml` 掛上新 SQL test |

參數相容性：`enqueue_chips_prefetch_gaps(p_lookback_days=10, p_max_stocks=300)` 語意重新定義為 `p_lookback_days` = Lane A 回看天數上限（沿用 10，實際受 insert cap 限制）、`p_max_stocks` = 每輪 `candidates_inspected` 上限（沿用 300）。既有 cron 呼叫不需改，且不會被默默忽略。

Kill switch：`chips_all` 關閉 → 整個 enqueue 提前 return；新增 config key `laneB_enabled` 於 enqueue 前檢查，關閉時 queue 不再成長（不倚賴 worker quota 拒絕）。

## 驗收（數值門檻）

前置：完成 B（互斥）與 D（failed 分類/回收）後才記 baseline。

1. baseline 快照：pending、oldest pending age、failed by class、coverage(最新日)、`tw_chip_fact` rows、`tw_bsr_daily` rows。
2. 連續三輪自然 cron（job 106）：
   - 每輪回傳含 `lane_a_inserted`/`lane_b_inserted`/`candidates_inspected`/`cursor_from`/`cursor_to`/`backpressure`。
   - 三輪合計 `queue_jobs_inserted ≤ 72`。
   - 至少 5 檔**非持股**代碼由 worker claim 且 `tw_chip_fact` 實際新增 rows（附 job id 對照），不能只是被掃過。
3. Queue 健康門檻：pending ≤ baseline + 50；oldest pending age ≤ 6h；三輪期間 `new jobs ≤ materialized jobs × 1.2`。
4. Lane A：`expected_latest_bsr_date()` 該日 63 檔覆蓋率 ≥ 95%，且透過 authenticated pf-holdings-v2 帳號實際開站確認（不開抽屜亦已有資料）。
5. Materialize：orchestrator 一次自然執行無 ambiguity 錯誤，`tw_bsr_daily` 對應日 rows 增加或 snapshot_status 誠實 partial。

回滾：還原 `enqueue_chips_prefetch_gaps` 舊函式體、`laneB_enabled=false`、job 45 payload 還原 `tier2:true`、job 70 重新啟用、Edge Function 還原前一版。
