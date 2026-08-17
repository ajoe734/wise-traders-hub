# Stage B Plan — 停止對 terminal provider rejection 的無效重試（唯讀稽核已完成，尚未 Apply）

所有數字皆為本輪唯讀查詢，時間戳 **2026-08-17 13:08 UTC（21:08 台北）**。

## 0. 真實基線（附查詢）

`select count(*) ... from tw_bsr_sync_queue group by status`（13:08:32 UTC）

| 指標 | 值 |
|---|---|
| pending | 77（全部 `last_error='quota_deferred'`） |
| running | 0 |
| failed | 1572（近 24h 內 24 筆為 `finmind_http_400:{"msg":"Your level is register...`） |
| done | 9956 |
| 近 24h 新建 job | 66（`chips_prefetch_hourly:r1` 30、`:r3` 30、`tier1_first_fetch` 3、`tier1_holdings` 3） |
| 近 24h 被更新 | 101 |
| 現在可 claim（next_run_at<=now） | 14；最早 next_due 2026-08-17 12:58 UTC |
| tw_bsr_daily max(trade_date) | **2026-08-14**（卡住） |
| tw_institutional_daily / daily_price_snapshots max | **2026-08-17**（正常，Stage B 不得影響） |

`tw_bsr_fetch_failures`（resolved_at is null）簽章分布：`finmind_admission_daily_exhausted` 4447、`finmind_admission_rate_limited` 502、`finmind_http_400 register level` 47（最新 2026-08-17 11:07）、`finmind_admission_circuit_open:*` 77、其餘為歷史 materialize/captcha。**`error_class` 全表皆為 NULL** —— 目前沒有任何持久化分類。

`tw_bsr_sync_config.key='market_batch'`：`supported=false`、`last_probe_outcome='unsupported'`、`last_probe_error='unsupported_plan:sponsor_level'`、`last_probe_at=2026-08-14T13:30Z` —— 這是唯一已持久化的 plan-level 拒絕證據（Stage A v2 已用它）。

`system_kill_switches`：僅 `chips_all / chips_backfill / chips_interactive / chips_keepwarm`，四者 enabled=true。**語意皆為「停 worker/停抓取」**，用它們會讓 77 筆 pending 永不收斂 → 依你的要求，Stage B **不使用** kill switch。

## 1. Exact call graph（含 cron jobid / schedule，24h runs 全 succeeded）

```text
[新 job admission]
 45 tw-bsr-enqueue-post-close   30 7 * * 1-5   → cron_edge_call('tw-bsr-finmind-sync',{mode:enqueue,tier1})
 53 tw-bsr-enqueue-holdings-delta 0,30 7-12 * * 1-5 → 同上（tier2/3 false）
106 chips-prefetch-enqueue-hourly 2 * * * *    → SQL public.enqueue_chips_prefetch_gaps(10,300)  ← 近 24h 60/66 筆來源
      ↓ index.ts enqueueTier1Holdings/Tier2Gaps/Tier3Backfill → enqueueBatch()  (L354-393, 純 INSERT)
      ↓ INSERT tw_bsr_sync_queue(status='pending', next_run_at=now, enqueued_by, post_close_only)

[既有 job processing]
 46 tw-bsr-worker-trading    */10 6-12 * * 1-5  batch30 max_priority3
 51 tw-bsr-worker-tier1-catchup */15 6-12 * * 1-5 max_priority1
107 tw-bsr-worker-hourly      7 * * * *         ignore_window
 98 tw-bsr-worker-weekend    */10 * * * 6,0
 96 tw-bsr-reap-stale-jobs   */10 * * * *      → reap_stale_bsr_queue_jobs(60)
 67 tw-bsr-market-batch-probe-daily 30 13 * * 1 → mode=probe（下一次 2026-08-24 13:30 UTC）
      ↓ rpc claim_bsr_queue_jobs(_batch,_max_priority)  (attempts+1, SKIP LOCKED)
      ↓ processStock() → fetchFinmindOneDay() → FinMind
        ├ ok            → queue.done / skipped / pending(partial)
        ├ isQuotaRejection(err)  // lib.ts L50: error.startsWith('finmind_admission_')
        │    → rpc defer_bsr_job_quota(job,15~60min) → status='pending', attempts-1,
        │      last_error='quota_deferred'   ← **無限循環來源：attempts 永不累積**
        └ 其他        → attempts>=max_attempts ? failed : pending+backoff
      ↓ recordFailure() upsert tw_bsr_fetch_failures(reason='finmind_error', last_error=raw)
        ← **未寫 error_class，也未呼叫 classifier**
```

下一次自然 worker 窗口：`107` 每小時 :07（下次 **2026-08-17 14:07 UTC**）；`46/51` 為台北交易時段（06-12 UTC）今日已過，下次 2026-08-18 06:00 UTC 起。

**根因（證據支撐）**：77 筆 pending 全是 `quota_deferred`，而 quota 拒絕來自 admission circuit —— circuit 之所以 open，是因為底層 FinMind 一律回 `HTTP 400 register level`（plan 拒絕）。`defer_bsr_job_quota` 會把 attempts 減回去，因此這 77 筆永遠不會走到 failed，每小時無效重試一次，永久循環。

## 2. 要做的最小修正

### B-1 classifier 收斂（`supabase/functions/_shared/bsrProviderState.ts`）
現有 `classifyBsrError` 已符合大部分要求（terminal 僅 exact 簽章 + 4xx；429/5xx/timeout/network 為 retryable；其餘 unknown）。僅新增：
- `finmind_admission_*` 前綴 → 新增 `admission_deferred` 判定（非 terminal、非 retryable-provider），供 worker 決定是否還能 defer。
- 匯出 `MAX_UNKNOWN_ATTEMPTS = 5`：unknown_degraded 超限 → `failed` + code `unclassified`，不得永久 defer。
- negative case 鎖在測試：`http_400:{"msg":"data not exists"}`、`http_400:{"msg":"params error"}` 必須是 unknown_degraded，**不得** terminal。
worker 與 v2 共用同一支，worker 不得自行 regex。raw body 只進 classifier 與 `tw_bsr_fetch_failures.last_error`（server-only），永不進 client payload。

### B-2 worker：既有 pending 自然收斂（`tw-bsr-finmind-sync/index.ts`）
- `recordFailure()` 增寫 `error_class = classifyBsrError(...).code`（新增欄位寫入，欄位已存在，無 schema 變更）。
- quota 分支：先看全域 terminal 證據（`tw_bsr_sync_config.market_batch.supported=false` + `last_probe_error` 經 classifier 判為 `provider_plan_rejected`）。若 terminal：**不再 defer**，直接把該 job 寫成 `status='failed'`、`last_error='provider_plan_rejected'`、`next_run_at=null`（schema 無 `blocked`，依你的指示用 `failed`），outcome 記為 `terminal_blocked`。
- 非 terminal 的 quota 拒絕維持現行 defer 行為不變。
- unknown_degraded 加上限：attempts>=max_attempts → failed（現行已有，補上 error_class 標記供 manual review 篩選）。
- worker **不停機**：77 筆會在後續每小時 :07 的自然 run 逐輪 claim 後單調下降到 0。不做任何 bulk UPDATE/DELETE。

### B-3 admission gate（阻擋新 job，不阻擋既有 job）
新增 `public.bsr_admission_open()`（STABLE, SECURITY DEFINER, search_path=public）：讀 `tw_bsr_sync_config.market_batch`，terminal 時回 false。
- `enqueueBatch()` 開頭呼叫，false 則 return 0（enqueue 模式 45/53 受阻）。
- `enqueue_chips_prefetch_gaps`（jobid 106，SQL 函式）加同一判斷 → 這是 24h 內 60/66 筆的來源，必須一起改，否則 gate 形同虛設。
- **worker claim 路徑完全不動**（`claim_bsr_queue_jobs` 不改），確保既有 pending 仍會被處理。
DML：無。gate 狀態沿用既有 `market_batch` row，不新增 kill switch row，不 INSERT/UPDATE 任何既有資料。

### B-4 恢復機制（fail-closed，company_admin only）
新增 `tw-bsr-provider-probe` 動作（沿用既有 `mode=probe`，加 `scope=single_stock|single_day`）+ RPC `bsr_admission_reopen(p_probe_result jsonb)`：
- 僅 `has_role(auth.uid(),'company_admin')` 可呼叫，否則 raise。
- 只有 probe **HTTP 200 + 非空 rows + schema validation 通過** 才會把 `market_batch.supported` 設回 true 並解除 gate；模糊 400 一律不解除。
- 解除同時寫 `audit_logs`（actor / time / probe result / 前後 config version）。
- 解除後由既有 enqueue cron 自然重新入隊，不做 bulk re-queue。

## 3. 驗收矩陣（Apply 後執行，非本輪）

| # | 項目 | 通過條件 |
|---|---|---|
| A1 | clone rehearsal ×2（全新 disposable） | exact terminal / 同 400 不同 body / 429 / 500 / timeout / network / unknown / 週末休市 / ineligible 全案例 PASS；catalog+data rollback read-back 一致 |
| A2 | 新 enqueue | gate 生效後 24h 內 `tw_bsr_sync_queue` 新增列 = 0（含 106 prefetch 路徑） |
| A3 | 既有 pending | 只經自然 cron 單調下降 77 → 0；期間 `last_error='quota_deferred'` 新增次數 = 0 |
| A4 | 證據鏈 | 每輪 `cron.job_run_details.runid` → pg_net request → edge invocation → queue delta 可對上；人工 invoke 只當 smoke |
| A5 | 連續 natural runs | 至少 3 次連續 jobid 107（:07）自然執行；今日 13:07 已過，**下次 2026-08-17 14:07 UTC**，交易時段 job 46/51 需等 2026-08-18 06:00 UTC → 這部分先列 **PENDING**，不以人工呼叫冒充 |
| A6 | 官方資料不受影響 | `tw_institutional_daily` / `daily_price_snapshots` max(trade_date) 持續前進（今日皆 2026-08-17） |
| A7 | fallback 保留 | 2308/2330 抽屜仍顯示 8/14 BSR 數值與圖表、8/17 法人；文案維持「上游來源中止」 |
| A8 | 隔離 | 不碰 `tw-chips-detail`（舊）、frontend、無關 ACL/cron；不 Publish |

## 4. Rollback

- Edge：保留部署前 bundle artifact 與 source commit hash；redeploy 舊版即回復。
- SQL：`bsr_admission_open` / `bsr_admission_reopen` 為新物件 → `DROP FUNCTION` 即完全回復；`enqueue_chips_prefetch_gaps` 以 `CREATE OR REPLACE` 修改，回滾腳本保存 `pg_get_functiondef` 原文。
- 資料：無 bulk DML，queue 狀態變化全部由 worker 自然產生，回滾後既有行為恢復。

## 5. 誠實邊界

Stage B 的成功定義是**停止無效重試 + 誠實顯示舊資料**。本輪 provider probe 已證實沒有合法免費的券商分點來源（FinMind 400 plan 拒絕、TWSE/TPEx 無 BSR）。Stage B 完成後 BSR 仍停在 2026-08-14，**不會**恢復新鮮度；真正新鮮 BSR 需要合法／付費 provider。

未解 GAP（沿用）：舊 `tw-chips-detail` 的 version/updated_at 無法由現有管理介面核實。

## 6. Stop points

1. 本 Plan 核准 → 只做 clone rehearsal（production 0 touch），交 A1 證據後停。
2. A1 通過並取得核准 → staged deploy（新 RPC + worker），交 A2/A3/A4 前兩輪證據後停。
3. A5 連續自然 runs 觀測完成 → 交最終 PASS/GAP。
