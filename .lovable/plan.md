# P7 Plan R1 addendum（只讀調查產出，尚未實作）

修正 R0 的三個矛盾：cron 頻率/週末、深度語意、失敗回退與公平性。

---

## A. Cron exact diff

### A-1 現況（production read-back，唯讀）

| jobid | jobname | schedule | active | database | username | command |
|---|---|---|---|---|---|---|
| 71 | tw-inst-backfill-enqueue | `15 22 * * *` | true | postgres | postgres | `SELECT public.enqueue_institutional_backfill_universe();` |
| 72 | tw-institutional-fastlane | `*/5 6-11 * * 1-5` | true | postgres | postgres | `SELECT public.cron_edge_call('tw-institutional-daily-sync', '{"days": 60, "mode": "fastlane", "batch": 10}'::jsonb, 120000);` |

每輪預算：job71 為單次 SQL scan（0 外部 call）。job72 `batch=10` → 每輪最多 claim 10 檔，每檔 1 次 FinMind 呼叫（days=60 單次區間查詢），故每輪 upper bound ≈ 10 calls，實際受 `finmind_quota_pools`（backfill pool daily_budget=600、interactive 240、keepwarm 960）admission 控制。job72 目前 weekday 72 runs/day（Taipei 14:00–19:55）。

job72 近 12 次自然 run 全 `succeeded`（最後 2026-08-14 11:55Z）。

### A-2 提議 diff（只改 schedule，command 逐字不變）

```text
job71: 15 22 * * *        ->  15 * * * *          (每小時 idempotent gap/enqueue scan)
job72: */5 6-11 * * 1-5   ->  */5 6-11 * * *      (七天皆跑，離峰窗不變)
```

不改 jobid/jobname/command/active/database/username；不新增 job；不動 67/105/106/107。

### A-3 job72 頻率比較（離峰窗 UTC 06–11 = Taipei 14:00–19:59）

| 選項 | runs/day | claim upper bound/day | weekday 能力 | 5 檔補到 ≥20 天所需 | 風險 |
|---|---|---|---|---|---|
| `*/15 6-11 * * *` | 24 | 240 | **降級**（72→24） | 1 個窗內即可（5 檔 < 24 輪） | 破壞既有 weekday 吞吐 |
| `*/5 6-11 * * *`（推薦） | 72 | 720（實際受 quota gate） | 不變 | 1 個窗內即可 | 僅在佇列大量積壓時吃 backfill pool，已有 admission reject |

**推薦 `*/5 6-11 * * *`**：最小 diff、零 weekday 回歸、週末新增能力；量的上限本來就由 quota pool 決定而非 cron 頻率。

### A-4 下一次自然 run（migration 上線後）

- job71：上線後最近的整點 +15 分（每小時一次，週末照跑）。
- job72：週六 2026-08-15 Taipei 14:00（UTC 06:00）起，每 5 分鐘一次至 19:55。
- 因此**本週六即可處理，不必等週一**。禁止 manual invoke；錯過就等下一輪。

---

## B. Failure state machine（不新增欄位/表）

現況欄位：`institutional_new_stock_queue(stock_id, status, attempts, next_attempt_at, last_error, requested_at, updated_at)`；`claim_institutional_new_stock` 只挑 `status='pending' AND next_attempt_at<=now()`，claim 時 `attempts+1` 並把 `next_attempt_at` 推 lease。

現況缺陷：`enqueue_institutional_backfill_universe` 的 upsert 對所有 `cov<40` 的股票**無條件** `status='pending', attempts=0, next_attempt_at=now(), last_error=NULL`（只避開 `running`）。一旦 job71 改成每小時，永久失敗股（停牌、下市、新上市無資料）會每小時復活並燒 quota；且現存 2 筆 `running` 自 2026-07-28 卡死永不回收。

R1 語意（僅用現有欄位）：

```text
eligible  : cov < 40 且（該列不存在）或（status='pending' 且 next_attempt_at<=now()）
            或（status='failed'/'dead' 且 attempts < 5 且 next_attempt_at<=now()）
backoff   : 重排時 next_attempt_at = now() + 30min * 2^attempts（上限 24h），attempts 不歸零
terminal  : attempts >= 5，或 last_error 命中 no_data/delisted/ineligible 樣式 → 永不由 job71 復活
stale     : status='running' 且 next_attempt_at < now() - 30min → 視為 failed，走 backoff 重排
protected : status='pending'（未到期）、'running'（未逾時）、'done' 且 cov>=40 → 一律不得被觸碰
```

`enqueue_institutional_backfill_universe` 改為只在上述 eligible 條件下 upsert，且**不再重設 attempts=0、不再清空 last_error**。函式簽章、回傳型別不變。

---

## C. Bounded fairness（每輪上限）

同 P6-R1 的 rank 語意，但 rank1 也設上限：

```text
rank1 = 已存檔持倉（checkup_storage pf-holdings*）   每輪 <= 20
rank2 = 未平倉 trade_records / expert_signals        每輪 <= 20
rank3 = 其餘 universe                                每輪 <= 10，且保證 >= 1
每輪總上限 = 40（rank1 未滿時不得由 rank2/3 補滿到超過各自上限）
```

排序仍以 `next_attempt_at` 偏移表達 rank（rank1 = now()、rank2 = now()+1s、rank3 = now()+2s），claim 端不改。

新增測試（`supabase/tests/institutional_fairness_backoff_test.sql`）：
1. 連續 24 輪 job71 模擬，rank3 每輪至少推進 1 檔。
2. 永久失敗 rank1（attempts 5）不再被重排，且不擋 rank2/3。
3. 持續新增 rank1 時，rank3 仍在 24 輪內完成一輪覆蓋。
4. 同一 terminal 列跨 24 輪 0 次重試。
5. retryable 列只在 `next_attempt_at` 到期後才重試，backoff 呈指數。
6. pending/running/done-達標列在 24 輪後欄位 exact diff = 0。

---

## D. 修正後的深度 acceptance

- `days=60` 是 **60 calendar days**，FinMind 於該區間實際回傳的交易日通常約 38–42 天，**不得**稱「目標 60 個 trade dates」。
- 驗收條件（對 5 檔 3529 / 4979 / 5271 / 6180 / 8086，現況皆 `distinct trade dates = 14`、latest = 2026-08-14）：
  - `max(trade_date) = expected_trade_date`（`tw_trading_days` 認定的最近已收盤交易日），且
  - request window 內 `count(distinct trade_date) >= 20`。
- 理想值取「API 在該 60 calendar days 實際回傳的可用交易日數」，不硬寫 60，不以 40 當硬門檻。
- `cov < 40` 只作為**候選觸發**條件，不是完成定義；停牌/新上市股在達 terminal 後即退出，避免永遠重排。

---

## E. 修正後 allowlist

| 檔案 | 內容 |
|---|---|
| `supabase/migrations/<ts>_p7a_institutional_saved_holdings.sql` | 單一 transaction：`enqueue_institutional_backfill_universe` 改寫（universe 併入 saved holdings、rank 上限、backoff/terminal/stale 語意）＋ `cron.alter_job(71, schedule=>'15 * * * *')` ＋ `cron.alter_job(72, schedule=>'*/5 6-11 * * *')`。rollback：反向 `CREATE OR REPLACE`（保留原 md5 `479ebaef7ead9273131383c7f98cd85b`）＋兩筆 alter_job 還原字串。 |
| `supabase/migrations/<ts>_p7b_enqueue_bsr_backfill_role.sql` | 獨立：`enqueue_bsr_backfill` 內 `has_role(v_uid,'admin')` → `'company_admin'`，其餘逐字不變（現 md5 `019fa470d2814b9ac0bb55c5e840fd23`）。 |
| `supabase/tests/institutional_fairness_backoff_test.sql` | 新增，C 節 6 項。 |
| `supabase/tests/enqueue_bsr_backfill_authz_test.sql` | 新增，權限矩陣（anon / 一般 user 非持有 / 一般 user 持有 / company_admin）。 |

不改既有 migration。0 Edge deploy、0 UI change、0 其他 cron change、0 新表/新欄位。

實作順序：先 P7-A 完整回歸綠燈 → 再 P7-B。任一 FAIL 即停，且不得為了過測試修改 fixture 前提。兩筆可同輪批准，但 apply / read-back / test / rollback 證據分開列。

---

## F. Next natural times（migration 上線後，禁止 manual invoke）

1. job71 hourly enqueue：上線後最近的 `HH:15Z`。
2. job72 weekend window：週六 2026-08-15 UTC 06:00–11:55（Taipei 14:00–19:55），每 5 分鐘。
3. HTTP/result 落地：`cron.job_run_details` + `tw_institutional_daily` 逐檔 read-back。
4. 5 檔 distinct trade dates ≥ 20 且 latest = expected_trade_date。
5. 29 檔 hypothetical drawer readiness（不開抽屜、僅 SQL 推導）全 ready。

production 自然驗收完成前，offline test 綠燈**不得**稱為完成。

---

## G. 最終批准建議

建議批准 P7-A（含 cron alter，同 transaction，附 rollback 腳本）與 P7-B（獨立 migration），採 job72 `*/5 6-11 * * *` 保守值。停在此處等待審核。
