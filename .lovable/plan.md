# Plan v5 — Holdings freshness (H0–H6)。S1-min 判定：production NO-GO

## 0. Critical-path 結論（先回答）

**S1-min 不是 freshness 修復的前置，production 保持 NO-GO。**

依賴掃描（唯讀，本輪執行）：
```
rg -l "app_ledger|public_projection_version|public_projection_withheld|replay_manifest_key" src supabase e2e
→ 0 個檔案
```
- 沒有任何 freshness table / RPC / Edge Function / cron / 前端 import 參照 S1-min 的任何 object。
- S1-min 只新增 `app_ledger.*` 與兩張 public projection 表，服務的是 performance projection（相依 `trade_records` / `expert_signals`），與籌碼新鮮度鏈完全不相交。
- 因此：**clone artifacts 僅作為未來獨立 migration 的證據保存**，不把不相關 schema 推上 production。S1/S2 是否上線，日後由 performance projection 自己的需求決定，不搭 freshness 便車。

Freshness 鏈的真實 object 清單（與 S1-min 無交集）：
`tw_bsr_sync_queue`、`tw_bsr_daily`、`tw_chip_fact`、`tw_chips_rollup`、`bsr_coverage_daily`、`tw_bsr_fetch_failures`、`tw_bsr_attempt_logs`、`chips_prefetch_targets`、`system_kill_switches`；RPC `enqueue_chips_prefetch_gaps` / `claim_bsr_queue_jobs` / `rebuild_bsr_rollup` / `get_bsr_daily_series` / `tw_bsr_eligibility`；Edge `tw-chips-detail` / `tw-bsr-finmind-sync` / `chips-guardian` / `tw-chips-orchestrator`；cron 106 / 107。

## 1. 現行 call chain 與斷點（唯讀證據）

### 1.1 抽屜開啟 → 讀取
```text
ChipsSection.tsx
  → useTwChipsDetail (react-query)
    → chipsRepository.fetchChipsPayload / fetchChipsStamp / fetchChipsBatch
      → gateway requestText  GET /tw-chips-detail?stock_id=XXXX
        → supabase/functions/tw-chips-detail/index.ts
            L136 rpc rebuild_bsr_rollup   ← **抽屜開啟時的寫入**（rollup 物化）
            L172 rpc get_bsr_daily_series ← 讀
            L205 rpc tw_bsr_eligibility   ← 讀
```
- `ChipsSection.tsx:192` 已註明 P3 拿掉 `ensure_bsr_window` / `ensure_bsr_queued`，**抽屜不再 enqueue**。
- 但 `rebuild_bsr_rollup` 仍是抽屜觸發的寫入 → 這是 H5 要移除的最後一個 drawer write。

### 1.2 hourly cron
```text
cron 106 chips-prefetch-enqueue-hourly  "2 * * * *"
  → SELECT public.enqueue_chips_prefetch_gaps(10, 300)
  → 來源只有 chips_prefetch_targets（20 列，全部 source='demo_seed'）

cron 107 tw-bsr-worker-hourly           "7 * * * *"
  → public.cron_edge_call('tw-bsr-finmind-sync', {"mode":"worker",...})
  → claim_bsr_queue_jobs → FinMind fetch → 寫 tw_bsr_daily / coverage
```
斷點（量化）：
1. **FinMind 授權層級**：近 7 天 `tw_bsr_fetch_failures` 517 筆，全部 `reason=finmind_error`，`last_error=finmind_http_400:{"msg":"Your level is register. Please update your user level..."}`，最後一筆 2026-08-17 07:21。這是 400 而非 429 → 退避重試永遠救不回來。
2. **觀測斷鏈**：`tw_bsr_attempt_logs` 全表 0 列（歷史從未寫入）。cron 106/107 近 24h 共 48 次 `succeeded`，但那只代表 SQL dispatch 成功，串不到 worker boot / claim / attempt / write。
3. **開關**：`chips_backfill=false`（其餘 `chips_all` / `chips_interactive` / `chips_keepwarm` 皆 true）。
4. **需求宇宙空洞**：enqueue tier1/tier3 只從 `trade_records.instrument`（開倉 21 筆 / 21 檔）＋ demo 20 檔取樣本；`stock_names` 僅 74 列，**沒有全市場 master**。
5. queue 現況：done 9,956 / failed 1,573 / pending 76；`tw_bsr_daily` 近 14 天 1,237,849 列、1,368 檔、最新 `trade_date=2026-08-14`、當日 40,055 列 → 資料鏈「部分活著」，缺的是需求覆蓋與可追溯性，不是整條死掉。

## 2. 持股來源分離（不可混為一談）

| 來源 | 現況（唯讀查得） | 是否進 enqueue |
|---|---|---|
| `trade_records`（專家持倉） | open 21 筆 / 21 檔 | 是（tier1/tier3） |
| `checkup_storage: pf-holdings-v2` | **38 列 / 38 使用者**；全 storage keys 共 39 使用者 → 「38/39」矛盾解消：第 39 位有其他 key、沒有 holdings | 否 |
| browser localStorage-only 使用者 | DB 完全沒有痕跡，數量不可知 | 否 |
| `chips_prefetch_targets` | 20 列，全 `source='demo_seed'` | 是（cron 106） |
| 全市場 TW master | 不存在（`stock_names` 74 列） | 無 |

### Privacy-safe demand registry 規格
新表 `public.symbol_demand_registry`：`market`、`symbol`、`first_requested_at`、`last_requested_at`、`request_count`、`source_class`（`holding|drawer|batch|demo`）、`updated_at`。
- **不存** `user_id`、`quantity`、`cost`、任何可還原個人持倉的欄位；主鍵 `(market, symbol)` → 同一 symbol 天然去重，1 位或 1 萬位使用者持有都只有一列。
- 寫入只允許 `SECURITY DEFINER` RPC `register_symbol_demand(p_market, p_symbol)`，僅遞增計數與時間戳（no-op upsert），對 anon/authenticated 只授 EXECUTE，不授表權限；表本身 RLS 拒讀（僅 service_role / company_admin 可讀）。
- localStorage-only 使用者：在前端載入持股清單時呼叫該 RPC 註冊 symbol（不送任何數量成本），因此不必登入也能被背景回補涵蓋。

## 3. Staged plan H0–H6（彼此獨立、各自 rollback；全程不動 `trade_records` / `expert_signals` / public performance / 既有 ACL）

- **H0 觀測先行（唯讀 + 新表）**：把 attempt log 寫入補回（worker 每次 claim/attempt/write 落一列，含 `correlation_id`、`run_id`、`http_status`），新增 `freshness_run_trace` view。Rollback：drop view + 關掉寫入 flag。
- **H1 demand registry**：新增 `symbol_demand_registry` + `register_symbol_demand` RPC + grants。純新增。Rollback：drop 表與函式。
- **H2 TW market master**：新增 `tw_market_symbols`（上市/上櫃全代號 + 類型），由每日 master sync 維護；不覆寫 `stock_names`。Rollback：drop 表 + 停 cron。
- **H3 enqueue / worker 改造**：enqueue 來源改為 `trade_records ∪ demand_registry ∪ demo_seed`（fast lane）與 `tw_market_symbols`（slow sweep），加 claim lease / idempotency / fairness。Rollback：還原 enqueue 函式定義（單一函式 replace，有前版備份）。
- **H4 FinMind 400 與 weekend policy**：授權層級修復（sponsor token 或改走全市場 storage_objects 路徑）；circuit 分類為 `auth_permanent` 時停止重試並告警而非燒配額；週末只補 backlog 與備份，**禁止產生新的 trade_date**。Rollback：關閉新 policy flag。
- **H5 移除 drawer write**：把 `tw-chips-detail` 的 `rebuild_bsr_rollup` 改為背景維護（cron/worker 觸發），Edge 端變成純讀。Rollback：還原該 Edge 版本。
- **H6 前端 freshness UI + E2E**：抽屜顯示真實 `as_of` / `state`（fresh / stale / pending / unavailable），並以 E2E 驗證開抽屜前後 queue/attempt 增量為 0。Rollback：前端 revert。

## 4. 量化目標（SLO 與參數）

| 資料型別 | 目標新鮮度 | 覆蓋率 |
|---|---|---|
| 持倉／demand fast lane（TW BSR） | 收盤後 T+1 09:00 前完成，落後 ≤ 1 交易日 | ≥ 99% |
| 全市場 slow sweep | 落後 ≤ 5 交易日 | ≥ 95% 上市＋上櫃 |
| 法人／chip fact | T+1 10:00 前 | ≥ 99%（demand 集合） |
| demo_seed | 與 fast lane 同級 | 100% |

- 配額分配：每小時 worker 預算的 **70% fast lane / 30% slow sweep**；fast lane 空手時 slow sweep 可吃滿 100%。
- Rate limit / backoff：指數退避 base 2s、cap 300s、jitter ±20%、單 symbol 連續失敗 6 次進 circuit；`auth_permanent`（HTTP 400 授權類）**不退避、不重試**，直接告警。
- Queue fairness：每輪 claim 每個 `source_class` 上限 = batch/2，`priority ASC, last_requested_at DESC, symbol` 排序；claim lease 90s，逾時由 `reap_stale_bsr_queue_jobs` 回收。
- Idempotency：`(symbol, trade_date)` 唯一鍵 upsert，重跑不產生第二筆 attempt 效果。
- 去重：同 symbol 多使用者在 registry 只有一列，enqueue 前對 `(symbol, trade_date)` 去重，重複需求只提升 `request_count` 與優先度。

## 5. 驗收（不接受「cron succeeded」）

1. 連續 **3 個自然 hourly run_id**，每個都能完整串起：`cron.job_run_details` → `cron_dispatch_log` HTTP → `edge_boot_events` → `claim` → `tw_bsr_attempt_logs` → `tw_bsr_daily` 寫入 → `bsr_coverage_daily` 更新，且 `correlation_id` 一致。
2. 週末 run 僅補 backlog／備份，`tw_bsr_daily` **不得出現非交易日 trade_date**（以 `tw_market_holidays` 交叉檢查）。
3. 抽屜驗收：開啟前後 `tw_bsr_sync_queue` 與 `tw_bsr_attempt_logs` 增量必須為 0；畫面 freshness timestamp/state 與 DB `as_of` 一致。
4. demand registry：抽樣 symbol 確認只有 `symbol/market/last_requested_at/request_count`，欄位層級不存在 user/quantity/cost。

## 6. 沒有 authenticated tester 時的測試邊界

- **可用 production read-only / anon**：cron 與 dispatch 鏈、attempt/coverage/queue 統計、freshness SLO、週末 trade_date 檢查、公開頁與 anon 抽屜（demo 模式）的 read-only 行為。
- **必須用 controlled Preview fixture**：登入後的持股註冊、view-as、任何需要 `auth.uid()` 的 RPC。fixture 結果只當「程式邏輯正確」的證據。
- **明確禁止**：把 mocked／fixture E2E 當成 production 真資料證據；兩者在報告中分欄呈現，不合併計分。

## 7. 邊界

本輪與 H0–H6 全程：不做任何 production DDL/DML/GRANT/REVOKE、不 deploy Edge、不 Publish。S1-min 維持 clone-only PASS 且 production NO-GO。
