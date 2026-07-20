# FinMind BSR 同步 — 運維手冊

## 架構總覽

- Edge Function：`tw-bsr-finmind-sync`
  - `mode=enqueue`：依 tier1(持倉) / tier2(缺口) / tier3(回填) 入列
  - `mode=worker`：從 `tw_bsr_sync_queue` claim jobs、經全域限流器呼叫 FinMind
  - `mode=stats`：回傳監控快照（用量、in-flight、queue 深度、延遲、429、P1 age）
  - `mode=manual`：管理員指定 stock_id，仍會走 queue（不繞路）
- 全域限流：原子額度預留（60 分鐘滑動視窗，上限 1500/hr）
  - `reserve_bsr_api_quota` → `settle_bsr_reservation`（成功／429）→ `release_bsr_reservation`（未送出）
  - `purge_expired_bsr_reservations`：回收過期 lease

## Cron 排程（jobname / schedule）

| jobname | schedule | 用途 |
| --- | --- | --- |
| `tw-bsr-purge-expired-reservations` | `*/5 * * * *` | 回收過期未結算的 reservation（防止額度永久佔用） |
| `alerts-watchdog-every-5min` | `*/5 * * * *` | 執行所有告警檢查，含新增的 4 條 BSR 檢查 |
| `tw-bsr-worker-trading` | `*/5 1-13 * * 1-5` | 交易時段每 5 分鐘跑 worker（UTC，對應台北 09:00–21:00）|
| `tw-bsr-enqueue-post-close` | `30 7 * * 1-5` | 台北 15:30 收盤後入列 tier1+tier2 |
| `tw-bsr-prune-daily` | `0 20 * * *` | 清除已完成的 queue 舊資料 |

## 告警規則（system_alerts.kind）

| kind | 觸發條件 | 升級 critical |
| --- | --- | --- |
| `bsr_rate_limit_high` | 用量（含 in-flight）≥ 80% | ≥ 95% |
| `bsr_reservation_stuck` | 最舊 in-flight ≥ 60s 或過期未結 ≥ 5 | ≥ 300s 或 ≥ 20 |
| `bsr_rate_limited_streak` | 近 60 分鐘連續 ≥ 3 個分鐘 bucket 收到 429 | ≥ 10 分鐘 |
| `bsr_p1_queue_stalled` | 最舊 P1 pending 年齡 ≥ 30 分鐘 | ≥ 120 分鐘 |

觸發後 `alerts-watchdog` 會透過 `line_push_jobs` 推送 admin LINE 綁定。

## 快速診斷 SQL

```sql
-- 目前限流狀態（含 in-flight）
SELECT * FROM check_bsr_rate_limit(1500, 'finmind');

-- Reservation 健康度
SELECT * FROM bsr_reservation_stats('finmind');

-- 過去 6 小時每分鐘用量
SELECT bucket_start, call_count, success_count, error_count, rate_limited_count
  FROM tw_bsr_api_usage
 WHERE api_name = 'finmind' AND bucket_start >= now() - interval '6 hours'
 ORDER BY bucket_start DESC;

-- 未結算的 in-flight reservation（依年齡）
SELECT id, reserved_at, expires_at,
       EXTRACT(EPOCH FROM (now() - reserved_at))::int AS age_seconds
  FROM tw_bsr_api_reservations
 WHERE settled_at IS NULL AND released = false
 ORDER BY reserved_at ASC LIMIT 50;

-- Queue 深度與最舊 pending
SELECT priority, status, count(*),
       min(enqueued_at) AS oldest_enqueued_at
  FROM tw_bsr_sync_queue
 WHERE status IN ('pending','running')
 GROUP BY priority, status ORDER BY priority;

-- 卡最久的 P1 pending
SELECT id, stock_id, trade_date, attempts, last_error, enqueued_at
  FROM tw_bsr_sync_queue
 WHERE priority = 1 AND status = 'pending'
 ORDER BY enqueued_at ASC LIMIT 10;

-- 最近 24 小時告警
SELECT fired_at, kind, level, title, metric_value, threshold, resolved_at
  FROM system_alerts
 WHERE fired_at >= now() - interval '24 hours' AND kind LIKE 'bsr_%'
 ORDER BY fired_at DESC;
```

## 失敗時的操作手冊

### 1) `bsr_rate_limit_high`（用量 ≥ 80%）

- 觀察 `/company/bsr-rate-limit` 儀表板：若 in-flight 遠大於實際 worker 數量 → 有 reservation 卡住（跳到 2）。
- 若確實是流量高（例如同時 tier3 回填 + tier1）：暫停 tier3。
  ```sql
  UPDATE tw_bsr_sync_queue SET status='paused'
   WHERE priority = 3 AND status = 'pending';
  ```
- 恢復：`UPDATE tw_bsr_sync_queue SET status='pending' WHERE status='paused';`

### 2) `bsr_reservation_stuck`（reservation 未結算）

- 立即回收：`SELECT purge_expired_bsr_reservations('finmind');`
- 若持續發生：檢查 `tw-bsr-finmind-sync` 邊緣函式 log，找出哪一步 timeout。
  - 常見：FinMind API 端 hang（20s timeout 內），需要調高 lease 或縮短 timeout。
- 強制釋放特定 reservation：
  ```sql
  UPDATE tw_bsr_api_reservations
     SET released = true, settled_at = now()
   WHERE id = <id> AND settled_at IS NULL;
  ```

### 3) `bsr_rate_limited_streak`（連續 429）

- 檢查是否有 4xx/5xx 集中：`SELECT last_error, count(*) FROM tw_bsr_sync_queue WHERE last_error IS NOT NULL AND updated_at > now() - interval '1 hour' GROUP BY 1 ORDER BY 2 DESC LIMIT 10;`
- FinMind 硬上限 1600/hr；我們設 1500 留 6% 緩衝。連續 429 表示上游額度 reset 延遲或誤判 → 暫停 15 分鐘：
  ```sql
  UPDATE tw_bsr_sync_config SET hourly_limit = 500 WHERE api_name='finmind';
  -- 15 分鐘後
  UPDATE tw_bsr_sync_config SET hourly_limit = 1500 WHERE api_name='finmind';
  ```

### 4) `bsr_p1_queue_stalled`（P1 延遲 ≥ 30 分）

- 檢查 worker cron 是否有跑：查 edge function log 或 `system_jobs_log`。
- 手動跑一次 P1：
  ```
  POST /functions/v1/tw-bsr-finmind-sync
  { "mode": "worker", "batch": 30, "max_priority": 1, "budget_ms": 45000 }
  ```
- 若 last_error 顯示同一種錯誤反覆出現：進 `/company/bsr-failures` 定位。

## 端到端驗證（staging / 小量正式）

小量正式驗證步驟（單一交易日、3 檔）：

1. 記錄目前用量 baseline：`SELECT * FROM check_bsr_rate_limit(1500, 'finmind');`
2. 直接 invoke `mode=manual` 或 `mode=enqueue` + `mode=worker`：
   ```sh
   curl -sX POST "$SUPABASE_URL/functions/v1/tw-bsr-finmind-sync" \
     -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" \
     -H "content-type: application/json" \
     -d '{"mode":"manual","stock_ids":["2330","2317","2454"],"date":"2026-07-17"}'
   ```
3. 驗收：
   - `SELECT count(*) FROM tw_bsr_daily WHERE stock_id IN ('2330','2317','2454') AND trade_date='2026-07-17';` 每檔 ≥ 15
   - `SELECT * FROM bsr_reservation_stats('finmind');` → in_flight=0、expired_unsettled=0
   - `check_bsr_rate_limit` 的 used 增量應等於實際打出的 fetch 次數

## 儀表板

- `/company/bsr-rate-limit`：用量、reservation、queue、延遲、每小時分布
- `/company/bsr-failures`：抓取失敗清單
- `/company/alerts`：告警中心（含 `bsr_*` kinds）
