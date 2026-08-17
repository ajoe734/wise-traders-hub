# BSR 狀態語意修正：terminal provider rejection 不得再稱「同步中／自動重試」

本輪只做唯讀診斷 + 計畫。以下每一項現況都由本輪實測（v2 response、production SELECT、原始碼）確認。

## 1. 唯讀證據（2026-08-17 11:5x UTC）

### 1.1 2308 v2 真實 machine fields（遮密）

| field | value |
| --- | --- |
| `as_of` / `as_of_lag_days` | `2026-08-17` / `0`（三大法人是新的） |
| `bsr_as_of` / `bsr_as_of_lag_days` | `2026-08-14` / `3` |
| `bsr_expected_date` / `bsr_lag_weekdays` | `2026-08-17` / `1` |
| `bsr_freshness_status` | **`syncing`** |
| `bsr_source` / `bsr_fallback_used` | `rollup` / `true` |
| `bsr_broker_count` / `bsr_low_quality` | `807` / `false` |
| `bsr_last_failure` | `{trade_date: 2026-08-17, error_code: "finmind_error", attempts: 1, next_retry_at: null, backoff_seconds: 60, consecutive_failures: 1, last_successful_as_of: 2026-08-14, lookback 08/17~08/17}` |
| `bsr_sync_status` | `{eligible: true, queued: true, status: "pending", next_run_at: 12:10:10Z, attempts: 1/5, error_code: "finmind_error", retryable: true}` |
| `upstream_circuit.finmind_bsr` | `{state: "open", disabled_until: 12:10:09Z, consecutive_failures: 65, last_error_code: "http_400"}` |
| `readiness.institutional` | 1/5/10/20/60 全 `ready`（have 60） |
| `snapshot_state` | `partial`（08/14，lane_a partial、lane_b/c sealed） |

也就是說：payload 自己同時說「circuit open、http_400、連續失敗 65 次」與「pending／retryable=true」。UI 只讀後者，所以顯示「同步中／暫時性／下輪自動重試」。

### 1.2 DB：terminal 還是 retryable？

- `tw_bsr_fetch_failures`（近 24h，100 列 updated、66 列新建）：**唯一 reason = `finmind_error`**，`last_error` 全為
  `finmind_http_400:{"msg":"Your level is register. Please update your user level..."}`，`error_class` **為 NULL**（BSR FinMind 路徑沒填 error_class）。
- `tw_bsr_sync_queue` 現況：`failed` 1,574（max attempts 60）、`pending` 75（`last_error='quota_deferred'`）、`done` 9,956。
- 2308 當前 job：`status=pending, attempts=1/5, last_error='quota_deferred', next_run_at=12:10:10Z, enqueued_by=chips_prefetch_hourly:r1`。
- `data_source_health.finmind_bsr`：`circuit_state=open, consecutive_failures=65, last_error_code=http_400, last_success_at=2026-08-15T15:10Z`。
- 近 24h 新 enqueue 66 筆（`chips_prefetch_hourly:r1/r3` 各 30、`tier1_first_fetch`/`tier1_holdings` 各 3），全部 trade_date=2026-08-17，全部停在 pending。

結論：**目前系統沒有任何 terminal classification**。register-level 400 被記成通用 `finmind_error`，佇列則因 circuit 開啟而被判為 admission 拒絕、無限延後。

### 1.3 exact call graph（誤導文案的產生點）

```text
worker  supabase/functions/tw-bsr-finmind-sync/index.ts
  L121 fetchFinmindOneDay → admitFinmind(circuitSource:'finmind_bsr')
    L134 circuit open → throw 'finmind_admission_<reason>'
    L154 HTTP!=200 → recordCircuit(false,'http_400') + throw 'finmind_http_400:...'
  L205 recordFailure() → tw_bsr_fetch_failures.reason = 'finmind_error'（硬寫死，不看 400）
  L621 isQuotaRejection('finmind_admission_…')=true → defer_bsr_job_quota → status 回 pending、attempts 抵銷
       ⇒ 400 打開 circuit → 之後每輪都變 quota_deferred → 永遠 pending、永不 failed
  L636 else 分支：finmind_http_400 走一般 backoff，attempts 到 5 才 failed（歷史 1,574 列）
edge    supabase/functions/tw-chips-detail-v2/index.ts
  L241 error_code = reason（= 'finmind_error'）
  L268 status pending/running → freshness = 'syncing'   ← 「同步中」源頭
  L284 retryable = pending/running/failed               ← 一律 true
front   src/checkup/components/freecheckup/chipsFreshnessSegments.ts L84
        case 'syncing' → `${asOf} · 同步中`
        src/checkup/components/freecheckup/ChipsSection.tsx
  L591-604 syncing → 「今日資料同步中，先顯示 08/14 的關鍵分點」
  L628     「分點資料延遲（顯示前次成功抓取）」
  L657-658 error_code==='finmind_error' → 「上游 API 呼叫失敗（額度或暫時性錯誤），下輪自動重試」
  L674-683 next_retry_at → 「預計 20:10 後自動重試」
```

三者都沒錯，錯在**上游從未被分類為 terminal**。

## 2. 修正方案（最小、fail-closed）

### 2.1 統一狀態機（單一資料源）

新增 `bsr_provider_state`（server 決定，UI 不再自行推論）：

| 類別 | 條件（server） | UI 文案 |
| --- | --- | --- |
| `ineligible` | eligible=false | 「不適用（ETF／權證／受益憑證）」 |
| `terminal_stale`（2308 現況） | provider terminal 且有舊 BSR | 「2026/08/14 · 上游來源中止（顯示前次成功資料）」，不得出現同步中／重試／時間承諾 |
| `terminal_no_data` | provider terminal 且無任何 BSR | 「上游目前不提供此資料，更新已暫停」 |
| `retryable`（含 pending/running/429/5xx） | 非 terminal 且已排隊 | 「同步中，將自動重試」＋ `next_retry_at` |
| `fresh` | `bsr_as_of >= bsr_expected_date` | 日期本身 |

terminal 判定（只讀既有欄位，不新增資料表）：`tw_bsr_fetch_failures.last_error` 命中 `finmind_http_(400|401|402|403)` 且訊息含 `level`/`Sponsor` 樣式，或 `data_source_health.finmind_bsr.last_error_code='http_400'` 且 `consecutive_failures >= N`。對外只回代碼 `provider_plan_rejected`，**不回傳上游原始訊息**（避免洩 token/plan 細節）。判不出來時一律 fail-closed 走 terminal 文案（寧可少承諾，不可假承諾）。

### 2.2 停止無效重試（不碰法人／價格 pipeline）

- `tw-bsr-finmind-sync`：`recordFailure()` 改寫入正確 `reason`/`error_class`（`provider_plan_rejected`），不再一律 `finmind_error`。
- 新增 terminal 分支：terminal 錯誤時 job 標 `blocked`（沿用 `failed` + terminal last_error，不再 backoff、不再 deferral），並停止該 provider 的 enqueue admission（沿用既有 `system_kill_switches` 機制，不新增 cron）。
- `isQuotaRejection` 分支只處理真 quota；circuit-open-due-to-terminal 不得再回 pending（這是目前 75 筆假 pending 的來源）。
- 量化目標：近 24h 66 筆新 enqueue + 100 筆 failure upsert → 0；`tw_bsr_daily`/`tw_chip_fact`/rollup 完全不動。

### 2.3 exact files

| 檔案 | 變更 |
| --- | --- |
| `supabase/functions/_shared/bsrProviderState.ts`（新） | terminal 判定 + 五類映射（Deno 端唯一資料源） |
| `supabase/functions/tw-chips-detail-v2/index.ts` | L241/L268/L284：additive `bsr_provider_state`、`bsr_terminal_reason`、`retryable` 改由狀態機決定 |
| `supabase/functions/tw-bsr-finmind-sync/index.ts` | L205 / L621 / L636：terminal 分類、停止 deferral 迴圈、blocked 轉移 |
| `src/checkup/components/freecheckup/chipsFreshnessSegments.ts` | 依 `bsr_provider_state` 五類輸出 state/tone/text |
| `src/checkup/components/freecheckup/ChipsSection.tsx` | L591-604 / L628 / L655-683：terminal 時移除「同步中／暫時性／下輪自動重試／預計 hh:mm」與 next_retry_at 區塊 |
| `src/checkup/hooks/useChipsState.ts` | `syncing` 判定改讀 provider_state，terminal 不進 syncing 分支 |

三大法人區塊、`daily_price_snapshots`、T86 pipeline 一行不動。

### 2.4 測試

- 單元（`chipsFreshnessSegments.test.ts`）：五類各一，含 **2308 真實 payload 形狀**（8/14 stale + circuit open + http_400）。
- Deno（`bsrProviderState_test.ts`）：register-level 400 → terminal；429/500/502 → retryable；空回應 → retryable；未知 → fail-closed terminal。
- E2E：2308 terminal_stale 斷言 `data-seg-state="terminal_stale"` 且畫面不得出現「同步中／自動重試／預計」；無資料個股 terminal_no_data；retryable 個股顯示 next_retry_at；週末／休市不得標紅。
- 既有 no-write 回歸：開抽屜 3 次，7 表 fingerprint 不變、`rebuild_bsr_rollup` 呼叫 0。

### 2.5 Rollback

前端純顯示層，`git revert` 即回舊文案；Edge 兩支為 additive 欄位 + 分類分支，可個別 redeploy 舊版；不新增 DB object、不改 ACL/cron，因此無 SQL 回滾。

## 3. 狀態界線

Production 前端仍未 Publish，真實使用者走舊 `tw-chips-detail`（該版每次開抽屜仍會 rebuild 寫入）。本計畫完成後也只在 Preview 生效，**原症狀對正式使用者尚未解除**，直到你決定 Publish。

## 4. Stop points

1. 唯讀診斷（本文件）→ 等你 Approve。
2. 實作前端 + `_shared/bsrProviderState.ts` + v2 additive 欄位（不動 worker）→ 回報測試。
3. worker terminal classification（會改變 production 寫入行為）→ 需你**另外**單獨核准後才做。
