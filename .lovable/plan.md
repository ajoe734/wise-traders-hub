# P7 Plan R2 final diff（只讀產出，尚未實作）

## A. Cron exact diff（command 逐字不變，只改 schedule）

```text
job71 tw-inst-backfill-enqueue : 15 22 * * *        ->  15 * * * *
job72 tw-institutional-fastlane: */5 6-11 * * 1-5   ->  */15 6-11 * * *
```

- job72 = 24 runs/day × batch 10 → upper bound 240 calls/day < backfill daily_budget 600。接受 weekday 72→24 取捨。
- 窗口 UTC 06:00–11:45 = Taipei 14:00–19:45，七天皆跑。
- 不改 jobid/jobname/command/active/database/username；不動 67/105/106/107。

## B. `enqueue_institutional_backfill_universe()` exact 行為

簽章 / 回傳 int / SECURITY DEFINER / `search_path=public` 不變。

Universe（跨 user code 去重，`^[1-9][0-9]{3}$`）：

```text
rank1 saved      : checkup_storage key LIKE 'pf-holdings%' 內 code/symbol   LIMIT 20
rank2 open       : trade_records 未平倉 + expert_signals(market='TW')       LIMIT 15
rank3 others     : 其餘 universe（v_active_tw_holdings 等）                 LIMIT 5
```

- 三段各自為獨立 ranked CTE，`UNION ALL` 後**不再套總 LIMIT**；總上限 40 由 20+15+5 自然構成，rank3 不會被擠掉。
- 低 rank 已出現的 code 從高 rank 段排除（去重）。
- 候選前置條件仍為 `cov(tw_institutional_daily distinct dates) < 40`。

每小時掃描的逐狀態語意（硬規格）：

| 目標列狀態 | 動作 |
|---|---|
| 不存在 | `INSERT (stock_id,'pending',0,now())` |
| `pending`（不論是否到期） | **完全不 UPDATE**，留給 claim |
| `running` | **完全不 UPDATE**（本票不做 stale recovery） |
| `done` | **完全不 UPDATE** |
| `failed`/`dead` 且 last_error 明確 retryable 且 `attempts<5` 且 `next_attempt_at<=now()` | `status='pending'`、`next_attempt_at=now()+30min*2^attempts`（上限 24h）；**attempts 不歸零、last_error 不清空** |
| terminal：last_error 命中 `no_data|delisted|ineligible|sealed`，或 `attempts>=5` | 永不由 job71 復活 |

實作上 `ON CONFLICT (stock_id) DO UPDATE` 的 `WHERE` 子句僅涵蓋最後一列 retryable 條件；pending due **不列入** eligible。

Known out-of-scope：`institutional_new_stock_queue` 現有 2 筆 `status='running'`（3363、3152，自 2026-07-28 卡住）不處理，不阻塞其他 claim。

## C. P7-B exact 行為

`enqueue_bsr_backfill(p_stock_id text, p_days int)`：僅 `public.has_role(v_uid,'admin')` → `public.has_role(v_uid,'company_admin')`。其餘 body 逐字/正規化等價；signature、owner、ACL、SECURITY DEFINER、`search_path` 不變。current md5 `019fa470d2814b9ac0bb55c5e840fd23`。

## D. Exact files（allowlist，其他一律禁止）

1. `supabase/migrations/<ts>_p7a_institutional_saved_holdings.sql` — 單一 transaction：`CREATE OR REPLACE enqueue_institutional_backfill_universe()` + `cron.alter_job(71,...)` + `cron.alter_job(72,...)`。rollback 腳本：還原原函式（md5 `479ebaef7ead9273131383c7f98cd85b`）+ 兩筆 schedule 原字串。
2. `supabase/migrations/<ts>_p7b_enqueue_bsr_backfill_role.sql`
3. `supabase/tests/institutional_fairness_backoff_test.sql`
4. `supabase/tests/enqueue_bsr_backfill_authz_test.sql`
5. （條件性）`supabase/tests/fixtures/bsr_e2e_functions.sql` — 僅當 ephemeral loader 確實需要時；動則必列對應函式來源與 pre/post hash，不得順便修其他 fixture。

不改 `detect_institutional_gap_jobs`。0 Edge deploy、0 UI、0 schema/table/column、0 其他 cron。

## E. Test gates（順序固定，任一新 FAIL 即停，不得改測試前提）

P7-A：baseline（現有 chips/BSR scoped tests）→ `institutional_fairness_backoff_test.sql`
- 連續 24 輪 rank3 每輪 ≥1 且有進展
- 永久失敗 rank1 不重排且不擋 rank2/3
- 持續新增 rank1 時 rank3 仍推進
- terminal 列 24 輪 0 重試
- retryable 僅到期後重試，backoff 指數
- pending/running/done 列 24 輪後 exact diff = 0
- 配額斷言：單輪 rank1≤20、rank2≤15、rank3≤5

→ apply P7-A → read-back（函式 md5、job71/72 完整 row、其他 cron exact diff = 0）

P7-B：baseline → `enqueue_bsr_backfill_authz_test.sql`（anon / 非持有 user / 持有 user / company_admin 四象限）→ apply → read-back（md5、ACL、proconfig）

## F. Natural times（禁止 manual invoke）

1. job71：上線後最近 `HH:15Z`，此後每小時。
2. job72：週六 2026-08-15 UTC 06:00–11:45（Taipei 14:00–19:45），每 15 分鐘。
3. 錯過最近一次就等下一次。

## G. Acceptance

- 3529 / 4979 / 5271 / 6180 / 8086：`latest = expected_trade_date` 且 request window 內 distinct trade dates ≥ 20（現況皆 14）。
- 29 檔 hypothetical drawer readiness 全 ready，且期間 0 前端 enqueue。
- `finmind_quota_ledger` / pools 無新增 `daily_exhausted`。
- rank3 若可觀測則需有自然進展；不可觀測記 N/A，不得冒充 PASS。
- production 自然驗收完成前，offline test 綠燈不得稱完成。

---

**READY FOR APPROVAL**
