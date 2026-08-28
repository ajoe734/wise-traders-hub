# HOLDINGS_SPARKLINE_STAGE2_PLAN_V3

根因不變：same-mount 跨 14:05，`useSparklines` fetch effect deps `[codesKey, enabled, pricesKey]`（`useSparklines.ts:216`）不含 expected date，故不重抓；`sparklineCacheKey → datasetCacheKey`（`confirmedClose.ts:112`）已含 tradeDate，排除 reload cache collision 與 12h TTL 誤診。

V2 保留：module-level singleton scheduler、單一 clock seam、calendar fail-closed + visibility 恢復。以下修正 REVIEW_2 四點。

---

## 1. Module-owned fetch task（與 React lifecycle 完全分離）

**問題成立**：現行 batch effect 的 `cancelled`（`useSparklines.ts:176/181/215`）會在 unmount 後阻止 cache write。若 prefetch 只是 await 同一 promise 就 return，會出現「reserve → unmount → 回應不寫 cache → prefetch 也不重打」的永久缺資料。

**設計 ownership**：新增 `src/checkup/lib/sparklineFetchTask.ts`（module-owned，不含任何 React）。

- `reservations: Map<cacheKey, Promise<void>>`（module-level singleton）。
- `runSparklineTask(codesWithKeys, gateway)`：
  1. **同步** reserve：對每個 key `reservations.set(key, taskPromise)`（同一 tick 原子，prefetch 無法插隊）。
  2. gateway `invoke('checkup-sparkline', { codes })` → validate（`isCompleteSparkline`）→ commit：good → `sparklineCache.setMany` + 刪 partial/fail；partial → `sparklinePartialCache`；缺漏／整批失敗／throw → `sparklineFailCache`。
  3. `finally`：逐 key `reservations.delete(key)`。
- **cache commit 由 task 自己做**，React 完全不參與；任何 consumer unmount 都不影響。
- `useSparklines` effect 只呼叫 `runSparklineTask(...)`，其 cleanup **只**取消 component-local side effect（本 hook 目前沒有 local state 要寫，故 cleanup 僅釋放 subscription），**不再用 `cancelled` 擋 cache write**。
- `prefetchSparkline(code)`：算出 key → 若 `reservations.has(key)` 則 `await reservations.get(key)` 後 return（**0 第二次 invoke**）；否則自行走 `runSparklineTask([code])`（共用同一 reserve/commit/release 路徑）。
- Abort：`GatewayPort.invoke(name, body)`（`gateway/types.ts:75`、`supabaseGateway.ts:131`）**不接受 AbortSignal**，無法在不改 gateway 契約下安全 abort → 本案**不加 Abort**（符合「否則先不要加」）。

**Executable tests**
- reserve 後立即 unmount，同 tick `prefetchSparkline` await 同 task → gateway resolve 後 cache 有值、`total invoke === 1`、`reservations.size === 0`。
- 逐一證 throw / partial / fail(缺漏 code) 三種收尾：`reservations.size === 0` 且下一次呼叫可 retry（fail 走負快取 TTL，partial 不阻擋）。

---

## 2. 不新增任何 HTTP header

撤回 V2 的 `x-lf-harness-path`。**不改 Edge/CORS 契約、不新增 production/custom header**。
- H test：只用 fake gateway spy（`gateway/fakeGateway.ts:227` 已記錄 `calls.invoke`）斷言 `total invoke === 1`。
- 若需區分 batch / prefetch：用 DEV harness **內部計數器**或測試注入 callback（`runSparklineTask` 接受 optional `onDispatch?: (origin) => void`，production 不傳），**不出現在任何 network request**。
- Hosted boundary gate：先記錄 baseline total request 數，跨界後斷言 **total 恰 +1**。

---

## 3. 測試計數基準修正（不再寫「絕對 0」）

採**方案二（baseline / seed 併用）**，明示如下：

- **A**：14:04:59 mount。先 seed 前一 expected date 的 cache（合法命中），並記錄 baseline total。斷言：邊界前**沒有任何以「今日 expected」為 fingerprint 的 attempt**；跨 14:05:00 後 total **恰 +1**，且該 request 對應新 fingerprint。
- **C**：13:00 盤中。斷言 `latestCompletedTradeDate(13:00)` **仍是前一交易日**、絕不以當日為 completed；允許為前一日歷史 sparkline 發出合法 request（不斷言 0），只斷言**沒有以當日為 expected 的 attempt**。
- **B / E / G / J** 同樣以 baseline delta 斷言（+0 或恰 +1），不使用絕對 0。
- **D**：holiday loader reject → 斷言**新 expected fingerprint 的 attempt = 0**（此處 0 是相對於「新 expected」，非 total）。
- **E2E**：同樣先記 baseline / seed，初次 mount 的合法 request **不得**被判為 storm。

---

## 4. 單一 expected snapshot（關閉 clock 窄縫）

**問題成立**：store 只 emit 字串、effect 事後再 `nowDate()` 重算 key，不是同一 snapshot。

**修正**
- `expectedTradeDateStore` 的 snapshot 改為穩定物件：
  ```ts
  interface ExpectedSnapshot { expectedTradeDate: string; computedAtMs: number; calendarReady: boolean }
  ```
  **只有欄位值真的改變時才換 reference**（`useSyncExternalStore` 安全）。
- 新增 `marketDataStatus.sparklineCacheKeyForTradeDate(code, tradeDate, market = 'TW')`，直接組 `datasetCacheKey` 的 identity（`identityOf`，`confirmedClose.ts:89`），**不再問時間**。
- `useSparklines` 內 cache key / attempt fingerprint / reservation key **一律**由 `snapshot.expectedTradeDate` 導出，effect 內不再呼叫 `nowDate()`。

**舊 API 相容性**：`sparklineCacheKey(code, now, market)` 保留為薄 wrapper（`sparklineCacheKeyForTradeDate(code, latestCompletedTradeDate(now, {market}), market)`），行為與輸出字串不變。現有 caller 相容性逐一確認：
- `src/checkup/hooks/useSparklines.ts:133/172/174/187/196-198/226/242` — 本案改為新 API。
- `src/test/unit/useSparklines-cache-migration.test.tsx:33` — 舊 API，保持通過。
- `src/checkup/lib/__tests__/marketDataStatus.test.ts:95-102` — 舊 API 字串斷言，wrapper 保證不變。
- `datasetCacheKey` 其他 caller（`src/test/unit/close-alignment.test.ts:119`）不受影響。
- `marketDataStatus.ts` 因此加入 allowlist。

---

## `__resetForTests()` 契約

放在 `expectedTradeDateStore.ts` 與 `sparklineFetchTask.ts` 各一支，僅 DEV/test 可用（`import.meta.env.DEV || import.meta.env.MODE === 'test'` 守門，production build 中為 no-op）：
1. **先** `++generation`（讓所有在途 callback / task 失效，未完成 task 不得寫 cache 到下一支 spec）；
2. `clearTimeout(timer)`、`removeEventListener('visibilitychange')`、`refCount = 0`；
3. `reservations.clear()`；
4. reset snapshot / calendarReady。

Task 內 commit 前檢查自身 `gen === generation`，不符則只 release、不寫 cache。

---

## 允許修改清單（exact，10 檔）

| 檔案 | 理由 |
|---|---|
| `src/checkup/lib/nowProvider.ts` (new) | 唯一 clock seam（`Date.now` 基底，與 `installHarnessClock` 同源；`new Date()` 會逃出覆寫） |
| `src/checkup/lib/tradeDateBoundary.ts` (new) | `nextExpectedChangeAt(now, opts)` 純函式 |
| `src/checkup/lib/expectedTradeDateStore.ts` (new) | singleton scheduler：timer=1 / listener=1 / refCount / 穩定 snapshot / `__resetForTests` |
| `src/checkup/lib/sparklineFetchTask.ts` (new) | module-owned task + reservation Map + cache commit + release |
| `src/checkup/hooks/useExpectedTradeDate.ts` (new) | `useSyncExternalStore` 薄封裝 |
| `src/checkup/lib/marketDataStatus.ts` | 新增 `sparklineCacheKeyForTradeDate`；舊 `sparklineCacheKey` 降為薄 wrapper |
| `src/checkup/hooks/useSparklines.ts` | deps 加 expected；key 全部由 snapshot 導出；改呼叫 module task；移除 `cancelled` 擋 cache write |
| `src/test/unit/sparkline-expected-boundary.test.tsx` (new) | A–K 全覆蓋 |
| `src/pages/HoldingsDetailPanelVolumeHarnessEntry.tsx` | DEV-only seam：`data-expected-trade-date`、`advanceTo` 控制、內部計數器（無 header、無 network 變更） |
| `e2e/holdings-sparkline-boundary.spec.ts` (new) | Hosted gate：同一 mount 受控跨界，baseline +1 |

**Rollback scope**：刪 5 個新 lib/hook 檔 + 2 個新測試檔；還原 `useSparklines.ts`、`marketDataStatus.ts`（移除新 helper，wrapper 回原實作）、harness entry seam。無 DB／Edge／CORS／cron／secret／Publish 面。

不動：TTL、`useConfirmedCloses`（dead code，不喚醒）、factual laggers 誠實標示、BSR、quote banner、drawer lazy fetch、Stage 1 close-authority lane、`forceAuthority` 文件漂移。

---

## Scheduler lifecycle（唯一 schedule owner，pseudocode 不變）

```ts
let refCount = 0, timer: Timeout | null = null, generation = 0;
let snapshot: ExpectedSnapshot = { expectedTradeDate: '', computedAtMs: 0, calendarReady: false };

function recomputeAndSchedule(reason: 'start'|'timer'|'visibility'|'calendar') {
  if (refCount === 0) return;
  const gen = ++generation;
  if (timer !== null) { clearTimeout(timer); timer = null; }   // 先 cancel stale
  const now = nowDate();                                        // 唯一 clock seam

  if (!holidaysLoaded('TW')) { setSnapshot({ ...snapshot, calendarReady: false }); ensureCalendar(gen); return; }

  const next = latestCompletedTradeDate(now, { market: 'TW' });
  if (next !== snapshot.expectedTradeDate || !snapshot.calendarReady) {
    setSnapshot({ expectedTradeDate: next, computedAtMs: nowMs(), calendarReady: true }); // 換 reference 才 emit
  }

  const at = nextExpectedChangeAt(now, { market: 'TW' });
  if (at == null) return;
  timer = setTimeout(() => {
    if (gen !== generation || refCount === 0) return;
    timer = null;
    recomputeAndSchedule('timer');        // 睡醒／throttle 遲到一律以「現在」重算
  }, Math.max(0, at - nowMs()));
}
```
subscriber `0→1` start + 掛 `visibilitychange`；`1→0` clear timer / 移 listener / `++generation`。calendar reject 只在下次回前景重試（loader daily cache + inflight dedupe，`marketHolidaysLoader.ts:17-40`），無 polling，且**不逐 code 查 holiday**。

---

## 測試矩陣（executable，fake timers + fixed clock，全部 baseline/seed 基準）

- **A** 14:04:59 mount（seed 前一 expected）→ 邊界前無今日 expected attempt；跨界 total +1。
- **B** +5min / +30min 同 expected → total +0。
- **C** 13:00：expected 仍為前一交易日；無以當日為 expected 的 attempt（允許合法歷史 request）。
- **D** 週五 14:05 後不推到週末／假日；loader reject → 新 expected attempt = 0；visibility regain + loader success → 恰 1 次；反覆 visibility 同 expected → +0。
- **E** 14:04 mount，時鐘跳到 14:20 → 遲到 callback 以「現在」重算，total +1。
- **F** StrictMode → 全域 timer=1、listener=1、request +1；unmount 後無 setState。
- **G** 同日新增 code 只抓新增集合；純 qty/price 變更 +0。
- **H** 同一 tick 併發 batch + prefetch → total invoke=1（reservation 生效，gateway spy 判定，無 header）。
- **I** 039108 / 053848 / 702157 仍 pending/stale，不被 cache 或 current price 覆蓋。
- **J** 多 consumer mount/unmount：refCount 0↔1 只在邊界 start/stop；最後一個離開後 timer=0、listener=0。
- **K** clock 契約：`installHarnessClock({fixedNow})` 後 snapshot、cache key、fingerprint 三者同時反映注入時間。
- **L** task lifecycle：unmount 後 task 仍完成 commit；throw / partial / fail 三路徑 `reservations.size === 0` 且可 retry；`__resetForTests` 後在途 task 不寫 cache。

其他 gate：`tsgo --noEmit`、targeted vitest、full regression（基準 3168 tests 全綠）、`bunx playwright test e2e/holdings-sparkline-boundary.spec.ts`。Hosted gate 於同一 mount 用受控時鐘（`installHarnessClock` + harness `advanceTo`）證明，記 baseline 後跨界 total 恰 +1；不等真實 14:05，不以 unit PASS 充當前端證據；harness unmount 時 `clock.uninstall()` + 兩支 `__resetForTests()`，不污染下一支 spec。

HOLDINGS_SPARKLINE_STAGE2_PLAN_V3_READY
