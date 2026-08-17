# BSR 上游狀態語意修正（Plan v2）— 三態分類、Stage A/B 分離

本輪仍是唯讀診斷 + 計畫。現況每一項皆由本輪實測（v2 live response、production SELECT、原始碼）確認。

## 1. 唯讀證據（2026-08-17 11:5x UTC）

### 1.1 2308 v2 真實 machine fields（遮密）

| field | value |
| --- | --- |
| `as_of` / `as_of_lag_days` | `2026-08-17` / `0`（法人是新的） |
| `bsr_as_of` / `bsr_as_of_lag_days` | `2026-08-14` / `3` |
| `bsr_expected_date` / `bsr_lag_weekdays` | `2026-08-17` / `1` |
| `bsr_freshness_status` | **`syncing`** |
| `bsr_source` / `bsr_fallback_used` / `bsr_broker_count` | `rollup` / `true` / `807` |
| `bsr_last_failure` | `{trade_date: 2026-08-17, error_code: "finmind_error", attempts: 1, next_retry_at: null, backoff_seconds: 60, consecutive_failures: 1, last_successful_as_of: 2026-08-14, lookback 08/17~08/17}` |
| `bsr_sync_status` | `{eligible: true, queued: true, status: "pending", next_run_at: 12:10:10Z, attempts: 1/5, error_code: "finmind_error", retryable: true}` |
| `upstream_circuit.finmind_bsr` | `{state: "open", disabled_until: 12:10:09Z, consecutive_failures: 65, last_error_code: "http_400"}` |
| `readiness.institutional` | 1/5/10/20/60 全 `ready`（have 60） |

payload 自己同時說「circuit open / http_400 / 連續 65 次失敗」與「pending、retryable=true」；UI 只讀後者，於是講出「同步中／暫時性／下輪自動重試／預計 20:10」。

### 1.2 DB 現況：目前完全沒有 terminal 分類

- `tw_bsr_fetch_failures`（近 24h：100 列 updated、66 列新建）：唯一 `reason = finmind_error`，`last_error` 全為 `finmind_http_400:{"msg":"Your level is register. Please update your user level..."}`，`error_class` **全為 NULL**。
- `tw_bsr_sync_queue`：`failed` 1,574（max attempts 60）、`pending` 75（`last_error='quota_deferred'`）、`done` 9,956。
- 2308 當前 job：`pending, attempts 1/5, last_error='quota_deferred', next_run_at 12:10:10Z, enqueued_by=chips_prefetch_hourly:r1`。
- `data_source_health.finmind_bsr`：`open / consecutive_failures 65 / last_error_code http_400 / last_success 2026-08-15T15:10Z`。
- 近 24h 新 enqueue 66 筆（`chips_prefetch_hourly:r1` 30、`:r3` 30、`tier1_first_fetch` 3、`tier1_holdings` 3），全部 `trade_date=2026-08-17`、全部停在 pending。

### 1.3 exact call graph（誤導文案的產生點）

```text
worker  supabase/functions/tw-bsr-finmind-sync/index.ts
  L121 fetchFinmindOneDay → admitFinmind(circuitSource:'finmind_bsr')
    L134 circuit open → throw 'finmind_admission_<reason>'
    L154 HTTP!=200 → recordCircuit(false,'http_400') + throw 'finmind_http_400:<body>'
  L205 recordFailure() → tw_bsr_fetch_failures.reason 硬寫 'finmind_error'（不看狀態碼、不寫 error_class）
  L621 isQuotaRejection('finmind_admission_…')=true → defer_bsr_job_quota → 回 pending、attempts 抵銷
       ⇒ 400 打開 circuit ⇒ 之後每輪都變 quota_deferred ⇒ 永遠 pending、永不 failed（= 現在 75 筆假 pending）
  L636 else：finmind_http_400 走一般 backoff，attempts 到 5 才 failed（歷史 1,574 筆）
edge    supabase/functions/tw-chips-detail-v2/index.ts
  L241 error_code = reason（'finmind_error'）   L268 pending/running → freshness='syncing'
  L284 retryable = pending|running|failed（恆 true）
front   chipsFreshnessSegments.ts L84 syncing → `${asOf} · 同步中`
        ChipsSection.tsx L591-604 同步中文案／L628 分點延遲／L657-658「額度或暫時性錯誤，下輪自動重試」／L674-683「預計 hh:mm 自動重試」
        useChipsState.ts L135 bsrFresh==='syncing' → syncing 分支
```

## 2. 三態分類（核心修正）

### 2.1 狀態定義與可採取的動作

| provider state | 判定條件（**必須**符合） | worker 動作 | UI 承諾 |
| --- | --- | --- | --- |
| `terminal_provider_rejected` | **exact 已知永久簽章**：`finmind_http_400` **且** 正規化 body 命中 `register level` / `please update your user level` / `sponsor level required` 簽章表；或已持久化 `error_class='provider_plan_rejected'` | 停止重試、停止新 enqueue（Stage B） | 「上游來源中止／更新已暫停」，**不承諾時間** |
| `retryable` | `http_429`、`http_5xx`、timeout/abort、network error、明確 `rate_limited` | 正常 backoff 重試 | 「同步中，將自動重試」＋ `next_retry_at` |
| `unknown_degraded` | 其他一切（含**非簽章的 400**：參數／日期／代號錯誤、bad json、未知字串） | **有限次**重試（沿用 max_attempts 上限，超限 → `failed` + `manual_review` 標記），**絕不永久 kill** | 「上游狀態待確認，暫不承諾更新時間」，**不得稱 terminal** |

明確拒絕舊提案：**不得**單靠 `data_source_health.last_error_code='http_400' + consecutive_failures>=N` 判 terminal。circuit 只作為「目前打不通」的旁證，不能單獨升級為 terminal。terminal 只有兩個合法來源：sanitized failure signature 命中，或 DB 已持久化的 `error_class='provider_plan_rejected'`。

「判不出來就保守」只套用在 **UI 承諾**（不承諾恢復時間），不套用在 worker 動作。

### 2.2 shared pure classifier（worker 與 v2 唯一資料源）

新檔 `supabase/functions/_shared/bsrProviderState.ts`（Deno 端唯一實作；前端不重判，只讀 server enum）。

```ts
export type BsrProviderState =
  | 'ineligible'
  | 'terminal_provider_rejected'
  | 'retryable'
  | 'unknown_degraded'
  | 'fresh'
  | 'stale_no_error';

export interface BsrProviderInput {
  eligible: boolean;
  bsrAsOf: string | null;        // 已落地的最新 BSR 日期
  expectedDate: string;          // 期望交易日
  queueStatus: 'pending' | 'running' | 'failed' | 'skipped' | 'done' | null;
  lastErrorRaw: string | null;   // tw_bsr_fetch_failures.last_error / queue.last_error（僅供分類，不外流）
  persistedErrorClass: string | null; // tw_bsr_fetch_failures.error_class
  attempts: number; maxAttempts: number;
}

export interface BsrProviderVerdict {
  state: BsrProviderState;
  /** 對外安全代碼，如 'provider_plan_rejected' | 'upstream_rate_limited' | 'upstream_5xx' | 'unclassified' */
  code: string;
  retryable: boolean;            // worker 是否可再排程
  hasStaleData: boolean;         // 有無舊資料可顯示
  nextRetryAllowed: boolean;     // UI 是否可承諾自動重試
}
```

- **precedence（固定順序）**：`ineligible` > `terminal_provider_rejected` > `retryable` > `unknown_degraded` > `fresh` > `stale_no_error`。
- **不外洩保證**：classifier 只接受 raw 字串作輸入，輸出僅 enum + 白名單 code；v2 payload 一律不放 `last_error` 原文、不放 token/plan/URL。既有 `bsr_last_failure` 也改為只回白名單 code（現在會回 `finmind_error`，尚可，但要加上 sanitize 斷言測試）。
- worker（Stage B）與 v2（Stage A）都 import 同一支，杜絕再次漂移。

## 3. Stage A（本次若核准的唯一授權範圍）

### 3.1 exact mutations

| 動作 | 對象 |
| --- | --- |
| 新增 repo 檔 | `supabase/functions/_shared/bsrProviderState.ts` + `bsrProviderState_test.ts` |
| 修改 repo 檔 | `supabase/functions/tw-chips-detail-v2/index.ts`（additive：`bsr_provider_state`、`bsr_provider_code`、`bsr_retry_promised`；`retryable` 改由 verdict 決定） |
| 修改前端 | `src/checkup/components/freecheckup/chipsFreshnessSegments.ts`、`ChipsSection.tsx`（L591-604 / 628 / 655-683）、`src/checkup/hooks/useChipsState.ts`（L135） |
| production mutation | **只有一項**：redeploy `tw-chips-detail-v2` |

**不碰**：舊 `tw-chips-detail`（不 deploy／不 redeploy／不刪）、`tw-bsr-finmind-sync`、任何 DB data/object/ACL/cron/kill switch、Publish。三大法人與價格 pipeline 一行不動。

### 3.2 UI 文案（Stage A 定案）

| 狀態 | 文案 |
| --- | --- |
| terminal + 有舊資料（2308 現況） | 「2026/08/14 · 上游來源中止，顯示前次成功資料」 |
| terminal + 無任何資料 | 「上游目前不提供此資料，更新已暫停」 |
| `unknown_degraded` | 「上游狀態待確認，暫不承諾更新時間」（不得寫 terminal、不得寫自動重試） |
| `retryable` | 「同步中，將自動重試」＋ `next_retry_at` |
| `ineligible` | 「不適用（ETF／權證／受益憑證）」 |
| `fresh` | 日期本身 |

FRESH 徽章保留，tooltip 持續明講「本次請求時間，非資料日期」。

### 3.3 Stage A 驗收（缺一不可）

1. v2 deploy **前後** function 清單／版本 read-back。
2. v2 + import closure static no-writer audit（denylist：`rebuild_bsr_rollup`、`makeInflightHook`、`finmind_inflight_requests`、`insert/update/upsert/delete`、任何 VOLATILE RPC）。
3. 三類 case × 3 次 = 9 次呼叫，7 表（`tw_bsr_daily`／`tw_chip_fact`／`tw_chips_rollup`／`tw_bsr_sync_queue`／`bsr_coverage_daily`／`tw_bsr_attempt_logs`／`finmind_inflight_requests`）rowcount + max(timestamp) + md5 前後完全一致。
4. 2308 live Preview（真實瀏覽器，非 mock）：畫面**不得**出現「同步中／自動重試／預計 hh:mm／暫時性」，且仍顯示 **8/14 券商分點數據**與 **8/17 三大法人**；console error = 0。
5. 回應 payload 斷言：不得含 FinMind raw body（`Your level`、`sponsor`、URL、token 片段）。

### 3.4 Stage A 測試矩陣

- classifier positive/negative：`http_400 + register level` → terminal；**同為 http_400 但 body 是參數/日期/代號錯誤** → `unknown_degraded`（不得誤判 terminal）；`429` / `500` / `502` / timeout / network → `retryable`；空字串／未知 → `unknown_degraded`。
- 五類 UI 快照：terminal_stale（2308 真實形狀）、terminal_no_data、unknown_degraded、retryable（含 next_retry_at）、ineligible、fresh。
- 週末／休市：不得標紅、不得說落後。
- 既有 chips E2E 全綠 + 開抽屜 no-write 回歸。

### 3.5 Stage A rollback（先備 artifact，再改）

1. redeploy 前先取得並保存**目前 production v2 的可重部署 artifact 或可驗證 source commit + bundle hash**；沒有這份就不動 deploy。
2. rollback = 用該 artifact 重新部署 v2（**只**針對 v2），或直接 delete v2 + 刪 `.env.development.local`，Preview 立即回舊 endpoint。
3. rollback 指令先做 side-by-side rehearsal（在確認驗收後不真的執行）。
4. **舊 `tw-chips-detail` 在任何情境下都不 deploy。**

## 4. Stage B（本次不授權，之後單獨審批）

### 4.1 exact mutations（含 production DML，誠實列出）

- `supabase/functions/tw-bsr-finmind-sync/index.ts`：`recordFailure()` 寫入正確 `reason` + `error_class`（`provider_plan_rejected` / `upstream_rate_limited` / `unclassified`）；terminal 不再進 `isQuotaRejection` 的無限 deferral；`unknown_degraded` 走有限次 backoff，超限 `failed` + `manual_review`。
- enqueue admission：terminal 期間停止新 enqueue。若採用 `system_kill_switches`，**這是 production DML（INSERT/UPDATE）**，Stage B 必須明列受影響 row，不得再宣稱「無 DB 變更」。
- `recordFailure` 開始寫 `error_class` 亦屬 production DML（既有表新資料），一併列入。

### 4.2 既有 75 筆 pending 的自然收斂（禁止 bulk DML）

- 不執行任何手動 UPDATE/DELETE。
- 停止新 enqueue 後，既有 job 由**自然 cron run** 取用；terminal 分類生效後被標 `failed` + terminal code（schema 無 `blocked` 狀態，故用 `failed` + code，不新增 enum）。
- 證明方式：natural cron runid → worker log → queue delta（pending 75 → 0 的逐輪遞減表），不接受人工 invoke 當證據。

### 4.3 恢復機制（不可永遠卡死）

- 解除條件：provider credential/plan 修復後，由 company_admin 執行一次**探測**（單一 symbol、單日、read-only 判定），HTTP 200 且回傳非空即視為通過。
- 通過後才允許：關閉 kill switch → 由既有 `chips_prefetch_hourly` 自然重新入隊（不手動 bulk enqueue）。
- 探測失敗維持 terminal，不自動解除；每次探測與解除都寫 audit。

## 5. 狀態界線（不得誤述）

Stage A 完成後：v2 server 與 Preview 前端已修正語意；**production frontend 尚未 Publish**，真實使用者仍走舊 `tw-chips-detail`（該版每次開抽屜仍 rebuild 寫入），因此原症狀**對正式使用者尚未解除**。Stage B 未執行前，worker 仍會對 terminal 400 產生無效重試噪音。

## 6. Stop points

1. 本文件 → 等你 Approve。
2. Stage A 實作 + 驗收 → 回報後停下。
3. Stage B（worker + kill switch + production DML）→ **需另外單獨核准**。
