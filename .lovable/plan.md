# HOLDINGS_SPARKLINE_STAGE2_PLAN_V1

Same-mount 跨 14:05 邊界時，sparkline 不會切換到新的 canonical expected trade date。以下先列逐項 source evidence，再給最小方案。

## A. Source evidence（唯讀確認）

**1. useSparklines effect / attemptedRef / inflight / cache / set state**
- `src/checkup/hooks/useSparklines.ts:143-149` — `useSparklines()`；`attemptedRef = useRef(new Set<string>())` (L146)，`codesKey`(L147)、`pricesKey`(L149)。
- L162 fetch effect；**deps = `[codesKey, enabled, pricesKey]`（L216）**。deps 完全不含時間／expected date。
- L164-168：`planSparklineFetch(...)` 再 `.filter(code => !attemptedRef.current.has(\`${code}:${sparklineCacheKey(code)}\`))`；L168 寫入同樣的 key。attemptedRef key **已含 expected date**（見第 2 點），所以 guard 本身是日期感知的；**唯一缺口是 effect 根本不會在邊界重跑**。
- L170-215：`getCheckupGateway().invoke('checkup-sparkline', { codes: missing })`，失敗 → `sparklineFailCache.setMany`；good → `sparklineCache.setMany` 並刪 partial/fail；partial 只在 `!sparklineCache.get(key)` 時寫入。`cancelled` flag (L215) 是唯一 unmount 保護。
- state：本 hook **不存資料在 state**，只有 `version`（L145）由三個 cache 的 `subscribe(bumpVersion)`（L153-161）遞增觸發重繪；L219-229 每次 render 直接從 cache 讀。

**2. sparklineCacheKey 是否含 canonical expected date → 是**
- `marketDataStatus.ts:141-147` `sparklineCacheKey → datasetCacheKey(code,'daily_ohlc',now,market)`。
- `confirmedClose.ts:102-114` `datasetCacheKey → identityOf({market, symbol, dataset, tradeDate: latestCompletedTradeDate(now,{market})})`。
- 結論：**排除「reload cache collision / 12h TTL」誤診**。新 mount 因 key 內 tradeDate 改變而自然分流；本案純粹是 same-mount effect 不重跑。TTL 不需要動。

**3. prefetchSparkline**
- 定義 `useSparklines.ts:240-264`；唯一 production caller `src/checkup/hooks/useChipsBatch.ts:291`（另有 harness `HoldingsDetailPanelVolumeHarnessEntry.tsx`）。
- cache gate（L243）用 `sparklineCacheKey(code)` → 日期感知，邊界後會自然放行，**不需要為本案改 gate**。
- 但 `sparklineInFlight`（L238、L244、L262）key 是**裸 code，不含 expected date**。這只在單股請求飛行中的短窗有影響，且方向是「少打一次」，非本案 bug。方案中僅把 inflight key 對齊為 cache key，讓它與 hook 共用同一 expected 維度（測試 H）。判定：**same-mount 邊界不需要另外改 prefetch 觸發邏輯**。

**4. useConfirmedCloses**
- `src/checkup/hooks/useConfirmedCloses.ts`，全 repo 除自身與 export default 外**無任何 import**（已 grep production 檔）。確認為 dead code；**本案不喚醒、不修改**。

**5. marketCalendar 能否給「下次 expected 變化時間」**
- 現有：`settleMinute()` (L46)、`sessionPhase()` (L142)、`latestCompletedTradeDate()` (L160)、`closeAuthorityLane()` (L180)、`isTradingDay/previousTradingDay` (L125/132)。**沒有**「下一次邊界時間」的函式 → 需新增純函式。
- `closeAuthorityLane` 已在 `!holidaysLoaded` 時回 `'unknown'`（L181）— fail-closed 前例。
- holiday loader `marketHolidaysLoader.ts:17-40`：每台北日一次、inflight 去重、失敗回 `false` 且**不**設定 `holidaysLoaded` → 已 production ready 且 fail-closed。

**6. 生命週期風險**
- StrictMode setup→cleanup→setup：目前 fetch effect 只靠 `cancelled`；新增 timer 必須在 cleanup `clearTimeout` 且用 ref 保證同一時間只有一顆。
- unmount：cache 是 module-level，`setVersion` 在 unmount 後可能被 subscribe 回呼觸發 → 需 `aliveRef` 保護新的 boundary state setter。
- background tab throttling / 系統睡眠：`setTimeout` 會**延後但仍會觸發**，因此 callback 內必須以「現在」重算 expected，而不是信任排程當下的計算值。

## B. 方案（最小、單一 one-shot timer、無 polling）

**新增 `src/checkup/lib/tradeDateBoundary.ts`（純函式）**
- `nextExpectedChangeAt(now, opts)`：回傳下一次 `latestCompletedTradeDate()` 會改變的絕對時刻。規則：若今天是交易日且 `localMinutes < settleMinute` → 今天 14:05（台北）；否則 → 下一個交易日的 14:05。以台北日曆計算後轉回 epoch。
- `msUntilNextExpectedChange(now)`：`max(0, at - now)`，並 clamp 上限（避免超長 timer 精度問題）。
- fail-closed：`holidaysLoaded('TW') === false` → 回傳 `null`（不排程、不推進 expected）。**不逐 code 查 holiday**，整個 hook 只算一次。

**新增 `src/checkup/hooks/useExpectedTradeDate.ts`**
- 回傳 `{ expectedTradeDate, calendarReady }`。
- 掛載時（若 `!holidaysLoaded`）呼叫 `loadMarketHolidays()`，成功才 setState 並排程；失敗維持 `calendarReady=false`、**不推進** expected。
- 單一 `timerRef` one-shot：`setTimeout(msUntilNextExpectedChange(now))` → callback **以 `new Date()` 重算** `latestCompletedTradeDate()`；只有值真的改變才 `setState`，然後排下一顆。
- 額外掛 `visibilitychange`（tab 回前景時重算一次，值不變 → 0 request）處理 background throttling／睡眠喚醒。
- cleanup 清 timer + 移除 listener + `aliveRef=false`；StrictMode double-invoke 只會存在一顆 timer。

**修改 `src/checkup/hooks/useSparklines.ts`**
- hook 內呼叫 `useExpectedTradeDate()`，把 `expectedTradeDate` 加進 fetch effect 的 deps（`[codesKey, enabled, pricesKey, expectedTradeDate]`）。
- `pricesKey` 保持不變 → 只改 qty/price 不會重打（attemptedRef key 已含日期，effect 重跑也會被擋）。
- 同日新增 code：`planSparklineFetch` + attemptedRef 只會補新增集合。
- `sparklineInFlight` key 由 `code` 改為 `sparklineCacheKey(code)`，與 hook 共用 expected 維度。
- 不動 TTL、不動 fail/partial 語意 → 落後樣本（039108 / 053848 / 702157）仍維持 pending/stale，不會被 current price 或舊 cache 冒充 2026/08/28。

不碰：BSR、quote banner、drawer lazy fetch、Stage 1 close-authority lane、`forceAuthority` 文件漂移、`useConfirmedCloses`。

## C. Allowlist（exact，6 檔）

| 檔案 | 理由 |
|---|---|
| `src/checkup/lib/tradeDateBoundary.ts` (new) | 邊界時刻純函式，唯一資料源，可單獨 fixed-clock 測試 |
| `src/checkup/hooks/useExpectedTradeDate.ts` (new) | 單一 one-shot scheduler + fail-closed calendar gate |
| `src/checkup/hooks/useSparklines.ts` | 唯一需要接上 expected 維度的取數入口；inflight key 對齊 |
| `src/test/unit/sparkline-expected-boundary.test.tsx` (new) | A–I 全部 executable fake-timer 覆蓋 |
| `src/pages/HoldingsDetailPanelVolumeHarnessEntry.tsx` | 只加 harness-only 可觀測 seam（`data-expected-trade-date`、invoke 計數、`fixedNow` 透過既有 `harnessClock`），prod 路由不可達 |
| `e2e/holdings-sparkline-boundary.spec.ts` (new) | Hosted gate：同一 mount 以受控時鐘跨界 |

Rollback scope：兩個新 lib/hook 檔刪除 + `useSparklines.ts` 還原 deps 與 inflight key（單一 revert，無 DB／Edge／cron／secret 面）。

## D. 測試

Unit（fake timers + fixed clock，`src/test/unit/sparkline-expected-boundary.test.tsx`）：
- A 交易日 14:04:59 mount → 邊界前 0 次；跨 14:05:00 後 expected 改變且**恰 1 次**。
- B `+5min` / `+30min` 同 expected → 累計仍 1。
- C 13:00 盤中不提前抓 settled sparkline。
- D 週五 14:05 後 expected 不推到週六／假日；holiday loader reject → **0 次**新的 expected attempt（fail-closed）。
- E 14:04 mount，系統時間直接跳到 14:20（timer 延遲觸發）→ callback 以「現在」重算，仍恰 1 次。
- F `React.StrictMode` double effect → 單一 timer、單一 request；unmount 後無 state 更新（no act warning / no setState-after-unmount）。
- G 同日新增 code → 只抓新增集合；純 qty/price 變更 → 0 次。
- H `prefetchSparkline` 與 hook 共用 expected/cache/inflight → 不雙打。
- I 三個 factual lagging 樣本仍 pending/stale，不被 cache 或 current price 覆蓋。

其他 gate：`tsgo --noEmit`、targeted vitest、full regression（現況 3168 tests 全綠為基準）、`bunx playwright test e2e/holdings-sparkline-boundary.spec.ts`。

Hosted gate：以 harness 路由 + `installHarnessClock({ fixedNow })` 在**同一個 mount** 內把時鐘從 14:04:5x 推過 14:05，觀察 `data-expected-trade-date` 改變且 `checkup-sparkline` 請求數 +1（route counter 加 positive control）。**不需要真的等到下一個 14:05**，也不以 unit PASS 充當前端證據。

HOLDINGS_SPARKLINE_STAGE2_PLAN_V1_READY
