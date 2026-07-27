# Phase I — Keep-warm SLO 告警（TDD）

## 目標
Phase D 有卡片，還沒接告警。新增守門邏輯：wave 落後 > 30 分鐘或連續遺漏就寫 `system_alerts`，走 `alerts-watchdog` 既有推播通道。

## TDD 順序

### I1. 紅燈
新增 `supabase/functions/_shared/keepWarmSlo_test.ts`：
- 缺 wave（0 筆）→ critical, reason='missing'
- 最新 wave 距 now 超過 `expectedIntervalMin + 30` → warning, reason='late'
- 超過 `expectedIntervalMin + 120` → critical
- 連續 2 筆 `status !== 'ok'` → critical, reason='consecutive_failed'
- 正常（<30 min 且 status='ok'）→ 不觸發
- `evaluateAllWaveSlo` 逐 wave 聚合

### I2. 最小實作
`supabase/functions/_shared/keepWarmSlo.ts`：
```ts
export const LATE_WARN_MIN = 30;
export const LATE_CRIT_MIN = 120;
export type SloRow = { wave; started_at; status };
export type SloDecision = { wave; triggered; level; reason; age_min; detail };
export function evaluateWaveSlo(rows, now, expectedIntervalMin): SloDecision
export function evaluateAllWaveSlo(rowsByWave, now, expectedByWave): SloDecision[]
```

### I3. 接進 watchdog
`supabase/functions/alerts-watchdog/index.ts`：
- 新增 `checkKeepWarmSlo(admin)`：讀 `tw_bsr_keepwarm_metrics` 近 24h，依 wave 分組，套 `evaluateAllWaveSlo`，觸發時 fire `keepwarm_slo_w${wave}`（60 分鐘去重）。
- 加入 `Promise.allSettled` 陣列。

### I4. 綠燈 + 部署
- `deno test` 通過。
- 部署 `alerts-watchdog`。

## 完工後刪除本檔。
