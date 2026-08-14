# P7-C Schedule Equalization Plan（只讀調查完成，尚未實作）

## 判定：GO

把 job72 從「UTC 06–11 每 15 分」改成「每小時整點、七天皆跑」在程式與上游契約上都沒有阻礙，且每日呼叫上限不變。

## 1. 事實與證據（唯讀查證）

**現況 production row（read-back）**
- job72 `tw-institutional-fastlane`：schedule `*/15 6-11 * * *`，command md5 `e361f063b9fa39fa0c19b6136de2e8e3`，command 逐字為
  `SELECT public.cron_edge_call('tw-institutional-daily-sync', '{"days": 60, "mode": "fastlane", "batch": 10}'::jsonb, 120000);`，active=t、database=postgres、username=postgres、nodename=localhost:5432。
- job71 `tw-inst-backfill-enqueue`：`15 * * * *`，md5 `4d0a256b38111012e9e16c6920ba2504`（本次不動）。
- job105 `backfill-worker-dispatch` `7 * * * *`、job107 `tw-bsr-worker-hourly` `7 * * * *`、job106 `chips-prefetch-enqueue-hourly` `2 * * * *`。

**呼叫上限 / 預算**
- fastlane 每輪最多 `batch=10` 檔，每檔 1 次 FinMind `TaiwanStockInstitutionalInvestorsBuySell`（`index.ts` `backfillStockViaFinmind`），另加 60s time budget 提前中止。
- 現行：4 runs/hr × 6 hr = 24 runs/day → upper bound 240 calls/day。
- 提案：1 run/hr × 24 hr = 24 runs/day → upper bound **240 calls/day，完全相同**；差別只在 burst 由「6 小時內 240」攤平成「每小時最多 10」。
- fastlane 路徑**不走** `finmind_admit` / `finmind_quota_pools`（該檔無任何 quota/pool/admit 參照），故 backfill/keepwarm/interactive pool 的每日預算不受影響；`finmind_upstream_quota` 目前 0 列（無上游硬性 header 限制紀錄）。
- flag `fastlane_enabled = {"enabled": true, "daily_stock_cap": 500}` 已開啟，240/day 遠低於 cap。

**時間衝突**
- 新的 :00 槽位同時有 job2（line-push-delayed，每小時 :00）與 job4/50/62（每分鐘）、job12（每 2 分）、job20/33/97（每 5 分）。都是輕量或不同上游，且 pg_cron 各自獨立 backend。
- 與 job105/107（:07）、job106（:02）、job71（:15）**皆不同分鐘，0 直接衝突**；現行 `*/15` 反而每小時和 job71 的 :15 同分鐘，改點後衝突減少。
- 新 holding 的最壞延遲：job71 於 :15 入列 → 下一個 :00 worker，最長約 45 分鐘。

**是否有 UTC06–11 的 code guard 或上游限制**
- `mode=fastlane` 分支（index.ts L820–876）只檢查 `fastlane_enabled` flag、batch/days/time budget，**沒有任何小時視窗或週末判斷**。
- 週末判斷（`isWeekend`）只出現在 keep_warm 與 T86 逐日回退路徑，fastlane 不經過。
- `backfillStockViaFinmind` 用 `start_date`/`end_date` 區間查歷史，週末呼叫只是回傳既有交易日資料，不會失敗。
- 結論：**沒有任何 code 或上游契約要求 UTC 06–11**，不觸發 NO-GO 條款。

## 2. 均勻度與風險

- 每小時整點更符合「每小時緩慢抓取」：單位時間對 FinMind 的壓力由最高 40 calls/hr 降到 10 calls/hr，且覆蓋 24 小時與週末。
- 風險（皆可接受）：
  - 單一 pending 積壓時的清空速度變慢（同樣 240/day，但不能在 6 小時內衝完）。目前 pending 僅 5 檔，一輪即可消化。
  - 夜間 FinMind 維護時段若失敗，走既有 backoff（5/15/60 分、attempts≥4 → dead），不會無限重刷。
  - :00 是全站最擁擠的分鐘；若日後要再降噪可改 `5 * * * *`，但本次照票面採整點。

## 3. 最小實作（單一 migration，0 其他變更）

只新增一筆 migration：

```sql
SELECT cron.alter_job(72, schedule => '0 * * * *');
```

不呼叫 unschedule/reschedule，不傳 command，不改 jobid/jobname/database/username/active；0 source、0 test 檔、0 Edge deploy、0 UI、0 schema、0 其他 cron。

## 4. 驗證（皆唯讀 read-back）

1. migration 前保存 job72 完整 row 與 `md5(command)`，以及全 cron 清單的同公式彙總 hash。
2. migration 後 read-back：
   - job72 `schedule = '0 * * * *'`，`md5(command) = e361f063b9fa39fa0c19b6136de2e8e3`（逐字未變），jobid/jobname/active/database/username 不變。
   - 其他所有 cron 的彙總 hash 與 pre 完全相同（exact diff = 0）。
3. 既有 P7 函式與測試不變證明：`enqueue_institutional_backfill_universe` / `enqueue_bsr_backfill` 的 `md5(prosrc)` 前後一致；`institutional_fairness_backoff_test.sql`、`enqueue_bsr_backfill_authz_test.sql`、`chips_lane_a_fairness_test.sql` 檔案 hash 未動（本次不改測試）。
4. 不做 manual invoke、不補跑、不 deploy、不 Publish。

## 5. 自然驗收

- 若於 Taipei 23:xx 上線，下一個自然 job72 = **UTC 2026-08-14 16:00 / Taipei 2026-08-15 00:00**。
- 由 E1 已入列的 5 檔（3529 / 4979 / 5271 / 6180 / 8086，pending、attempts=0）自然 claim；驗收看 `cron.job_run_details` job72 succeeded、queue 五檔轉 done、`tw_institutional_daily` 各檔 distinct trade_date 由 14 提升至 ≥ 20。
- 週末覆蓋驗收：Saturday Taipei 08-15 之後每個整點皆有輪次（不再限於 14:00–19:45）。

## 6. Rollback

以 forward migration 還原：

```sql
SELECT cron.alter_job(72, schedule => '*/15 6-11 * * *');
```

停在此處等你批准。
