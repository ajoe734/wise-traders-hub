# Chips Pipeline Runbook

> 適用範圍：`tw-chips-detail`、`tw-bsr-finmind-sync`、`tw-institutional-daily-sync`、`chips-guardian`
> 上次審閱：2026-07-25（PR-9 交付版）

半夜被叫起來時，先看「三步應急」；有時間再看完整章節。

---

## 三步應急

1. **打開後台**：`/company/data-source-health`
   - 若 `finmind_bsr` 或 `twse_t86` 為 `open` → 進入 §3-A
   - 若 `interactive / keepwarm / backfill` 任一 pool `remaining=0` → §3-B
   - 若任何 kill-switch 為 `disabled` → §3-C
2. **看告警**：`/company/alerts`，找 code 開頭 `guardian_*` 的最新事件
3. **看 cron**：`/company/publish-batch-status` → `pg_cron 執行紀錄`

---

## 1. 架構圖

```text
使用者操作
    │
    ▼
[tw-chips-detail]  ── 讀 tw_chips_rollup / current_prices / data_source_health
    │                    │
    │ (miss + eligible)  ▼
    │              [admitFinmind:'interactive']─┐
    │                                            │
    ▼                                            ▼
[tw-bsr-finmind-sync]  ◄──── pg_cron 15:30/17:30/19:30 (keepwarm 波次)
    │                        pg_cron 週日 03:00       (backfill 60d)
    ▼
[FinMind API]  ── circuitBreaker(finmind_bsr) 保護
    │
    ▼
[tw_chips_rollup] (snapshot-first)
    │
    ▼
UI 5 態 (useChipsState) : ineligible / upstream_outage / filling_new_stock / d1_fallback / ready
```

Guardian (`chips-guardian`) 每 5 分鐘掃 circuit + ledger，自動拉下 kill-switch。

---

## 2. 關鍵指標與看板

| 指標 | 位置 | 正常範圍 |
|---|---|---|
| finmind_bsr circuit | `/company/data-source-health` | `closed`；`half_open` 短暫可接受 |
| 三 pool remaining | 同上（Quota Pool 卡片） | 交易時段 08:00-14:00 剩 > 30% |
| rollup lag（天） | `/company/bsr-audit` | ≤ 1 交易日 |
| 5 態分布 | `chips_state_resolved` GTM 事件 | `ready` > 80% |
| Guardian 觸發次數 | `/company/alerts` code=`guardian_*` | 0～1 次/日 |

---

## 3. 常見告警與處置

### 3-A. `finmind_bsr` circuit 長時間 open

**症狀**：`/company/data-source-health` 顯示 `open`，`disabled_until` 一直延長。
Guardian 會在 open ≥ 2 小時後自動關 `chips_keepwarm`，寫 `guardian_kill_keepwarm_circuit_open` 告警。

**處置**
1. 檢查 [FinMind 官方狀態](https://finmindtrade.com/)
2. 若對方沒事，看 `data_source_health.last_error_code`：
   - `http_402 / http_429` → quota 用完，考慮升級方案或縮小 keepwarm 波次
   - `http_5xx` → 對方伺服器問題，等
   - `network` → 我方 Deno 出口問題
3. 手動 reset：`/company/data-source-health` 點 `重置為 closed`
4. 修復後，把 `chips_keepwarm` kill-switch 打回 `enabled=true`

### 3-B. Pool 提早耗盡

**`interactive` 08:00 用完**（連續 3 天）：
```sql
select finmind_pool_set_budget('interactive', 400);
```
或後台頁直接改。

**`backfill` 拒絕率 > 80%**：guardian 已自動關 `chips_backfill`，代表新股 60 天回補暫停。不急就等到隔日 00:05 reset。

### 3-C. Kill-switch 被關

看 `system_kill_switches.disabled_reason` 判斷是人工還是 guardian。
- `chips_all` 被關 → 全站 chips 停擺，屬於緊急降級。上游修好後手動 enable。
- 單一 pool 被關 → 對應功能停擺（見 PR-8 pool 對照表）。

---

## 4. 上線 / 降級開關

**全站緊急關閉 chips 相關 FinMind 呼叫**：
```sql
select toggle_kill_switch('chips_all', false, '緊急降級：<原因>');
```

**只關 keepwarm，保留使用者互動**：
```sql
select toggle_kill_switch('chips_keepwarm', false, 'FinMind quota 緊繃');
```

**恢復**：
```sql
select toggle_kill_switch('chips_keepwarm', true);
```

**手動重置熔斷**（`/company/data-source-health` UI 或 SQL）：
```sql
select reset_data_source_circuit('finmind_bsr');
```

**手動清當日 quota 帳**：
```sql
select finmind_pool_reset();
```

---

## 5. 升級 FinMind 方案 checklist

1. 到 FinMind 後台換 token，更新 Supabase secret `FINMIND_TOKEN`
2. 確認新 plan 是否支援 `TaiwanStockTradingDailyReport` 的 bulk API（`data_id` 空值取全市場）
3. 若支援，開啟 `/company/bsr-sync-config` 內的 `market_batch_bsr` 開關
4. 依新 plan 調三 pool 預算：
   ```sql
   select finmind_pool_set_budget('interactive', 600);
   select finmind_pool_set_budget('keepwarm',    600);
   select finmind_pool_set_budget('backfill',    300);
   ```
5. 觀察 24 小時 `finmind_quota_ledger` 拒絕率

---

## 6. Runbook 一致性檢查

CI 會確認以下名稱都真的存在（`.github/workflows/full-tests.yml` 內）：
- Tables：`finmind_quota_pools`, `finmind_quota_ledger`, `system_kill_switches`, `data_source_health`, `tw_chips_rollup`
- RPCs：`finmind_admit`, `finmind_pool_set_budget`, `finmind_pool_reset`, `check_kill_switch`, `toggle_kill_switch`, `reset_data_source_circuit`
- Edge Functions：`tw-chips-detail`, `tw-bsr-finmind-sync`, `tw-institutional-daily-sync`, `chips-guardian`

Runbook 修改後請跑：`node scripts/verify-runbook-refs.mjs`（如缺失請補）。
