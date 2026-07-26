# Chips Lanes Runbook

籌碼面資料管線（P5 上線後）維運手冊。

## 資料流概觀

```text
Lane A (broker_scraper)   ─┐
Lane B (finmind_batch)    ─┼─►  tw_chip_fact  ──►  materialize_bsr_daily_from_fact()  ──►  tw_bsr_daily  ──►  rollup + UI
Lane C (finmind_per_stock)─┤
Lane D (legacy_migration) ─┘         │
                                     └── reconcile_snapshot() ── tw_bsr_daily_snapshot_status.sealed_at
```

- **fact 表為 append-only**，每個 lane 各自寫入自己的紀錄，永不覆寫他人。
- **materializer** 依 `broker_scraper > finmind_batch > finmind_per_stock > legacy_migration` 選出 authoritative row 寫回 `tw_bsr_daily`。
- **sealed** 之後 `tw_bsr_daily` 不再變動；lane 仍可寫 fact 但不會回傳給 UI。

## 常見情境

### 1. Sealed 誤判需解除
```sql
-- 僅授權路徑：先解封，再要求 orchestrator 重跑
UPDATE public.tw_bsr_daily_snapshot_status
   SET sealed_at = NULL, sealed_by_lane = NULL
 WHERE trade_date = 'YYYY-MM-DD';
SELECT public.reconcile_snapshot('YYYY-MM-DD'::date);
```

### 2. Lane 衝突（`/company/data-source-health` → Lane 衝突偵測）
- 對照 fact 表原始筆數：`SELECT * FROM tw_chip_fact WHERE trade_date=... AND stock_id=... AND broker_id=... ORDER BY source;`
- 若 broker_scraper 明顯錯誤，直接刪除該筆並重跑 materializer：
  ```sql
  DELETE FROM public.tw_chip_fact WHERE id = <fact_id>;
  SELECT public.materialize_bsr_daily_from_fact('YYYY-MM-DD'::date);
  ```

### 3. Fact-log 24h 內零寫入（guardian 高優先告警 `guardian_fact_log_stale`）
1. 檢查三條 lane cron 是否運作：`SELECT * FROM cron_dispatch_log WHERE created_at > now() - interval '2h' ORDER BY created_at DESC;`
2. 檢查熔斷：`SELECT source, circuit_state FROM data_source_health;`
3. 檢查 kill-switch：`SELECT key, enabled, disabled_reason FROM system_kill_switches;`

## Kill-switch 對照

| Switch key | 影響 |
| --- | --- |
| `chips_keepwarm` | 停 Lane B / D 的 keepwarm cron |
| `chips_backfill` | 停 60 日新股 backfill 佇列 |
| `chips_orchestrator` | 停三波 orchestrator，materializer 不會被自動呼叫 |
| `chips_broker_scraper` | 停 Lane A |

Guardian 自動關的 switch 會在條件解除時自動 re-enable；`disabled_reason` 開頭為 `manual:` 者永不自動打開。

## Backfill 授權路徑

```sql
-- 從既有 tw_bsr_daily 補進 fact 表（source = legacy_migration）
SELECT * FROM public.backfill_legacy_bsr_to_fact('YYYY-MM-DD', 'YYYY-MM-DD');
```

- 已存在 `(stock_id, trade_date, broker_id, source='legacy_migration')` 者會 skip。
- 之後若真實 lane 補資料進來，materializer 會自動用更高優先度覆蓋。

## 健康指標速查

- `/company/data-source-health` → **Fact-log 健康**：總筆數、Sealed 覆蓋率、每日 lane 分布、衝突。
- `SELECT * FROM public.chip_fact_summary(20);` — 近 20 日彙總。
- `SELECT * FROM public.chip_fact_health;` — 每日 lane 明細（近 30 交易日）。
