# HOLDINGS_SPARKLINE_STAGE2_PLAN_V2

回應 REVIEW_1 六項阻塞。V1 根因判讀保留（same-mount effect deps `[codesKey, enabled, pricesKey]`（`useSparklines.ts:216`）不含 expected date；`sparklineCacheKey → datasetCacheKey → latestCompletedTradeDate`（`confirmedClose.ts:112`）已含 tradeDate，故排除 reload cache collision 與 12h TTL 誤診）。

---

## 1. Scheduler 作用域 → 改為 module-level singleton

**Exact production callers / cardinality（唯讀確認）**
- `src/checkup/components/freecheckup/HoldingsWorkbench.tsx:98` — 唯一 production `useSparklines()`。
- 上游鏈：`FreeCheckup.jsx:3246 <HoldingsTab>` → `HoldingsTab.tsx:397 <HoldingsWorkbench>`（皆 `memo`，各一處 render）。
- 另一處 `src/pages/HoldingsDetailPanelVolumeHarnessEntry.tsx:279`，路由 `/e2e/holdings-detail-panel-volume`，由 `src/routes/harnessRoutes.tsx:33` 的 `const DEV = import.meta.env.DEV` **build-time** 剝除 → production 不可達。

即：**目前** production 同時 mounted instance = 1。但這是元件樹巧合，不是契約（tab 切換／未來多面板可破壞），因此**不把 timer 放進 hook**。

**設計**：`expectedTradeDateStore` — module-level external store（`subscribe/getSnapshot` + `useSyncExternalStore`）。
- 全域最多一顆 timer、一個 `visibilitychange` listener。
- refCount `0→1` 才 start（load calendar + schedule），`1→0` 才 stop（clear timer / remove listener / reset generation）。
- consumer（hook）只讀 snapshot 字串，不擁有排程。

**測試**：StrictMode + 多 consumer mount/unmount 下斷言 `__debugActiveTimers() === 1`、`__debugListenerCount() === 1`；最後一個 subscriber 離開後兩者為 0。

---

## 2. Inflight 矛盾 → 採 A（真正共用 reservation）

**逐行證據**：`sparklineInFlight` 只出現在 `useSparklines.ts:237`（宣告）、`:243`（prefetch gate）、`:244`（add）、`:262`（finally delete）。batch effect（L162-217）**完全沒有讀寫這個 set**。V1 的 H claim 不成立，撤回。

**方案 A**：把 inflight 升級為 `Map<key, Promise<void>>`，key = `sparklineCacheKey(code, now)`（expected-aware）。
- batch effect 在 `missing` 決定後、invoke 之前，對每個 key **原子 reserve**（同步 `set`，同一 tick 不可能被 prefetch 插隊）；把整批的 promise 存入每個 key。
- `finally` 逐 key release（good / partial / fail / throw / cancelled 全部釋放）。
- `prefetchSparkline` 看到 reservation → `await` 同一 promise 後 return，**不發第二次 invoke**。
- 反向亦成立：batch 若看到某 key 已被 prefetch reserve，該 code 從 `missing` 移除並 await。

**測試**：同一 tick 內同時啟動 hook batch 與 `prefetchSparkline(code)`，用 gateway route counter 斷言 `invoke total === 1`（不是只看 cache 最終值）。

---

## 3. 單一 clock seam

**關鍵發現**：`installHarnessClock`（`harnessClock.ts:120`）覆寫的是 `Date.now`，**不是 `new Date()` 建構子**。V1 寫「callback 用 `new Date()`」會逃出 harness clock —— 這正是 review 指出的破口。

**定義**：`src/checkup/lib/nowProvider.ts`
```ts
export function nowMs(): number { return Date.now(); }      // 唯一 clock seam
export function nowDate(): Date { return new Date(nowMs()); }
```
全鏈一律以**同一個 `now: Date` 參數**貫穿，禁止在下游各自取時間：

| 函式 | signature | now 來源 |
|---|---|---|
| `expectedTradeDateStore.recompute()` | `(now = nowDate())` | 唯一入口 |
| `latestCompletedTradeDate(now, opts)` | 既有 `marketCalendar.ts:160` | 由 store 傳入 |
| `nextExpectedChangeAt(now, opts)` (new) | `(now: Date, opts?) => number \| null` | 由 store 傳入 |
| `sparklineCacheKey(code, now, market)` | 既有 `marketDataStatus.ts:141`（已有 now 參數） | **useSparklines 改為顯式傳入 store snapshot 對應的 now** |
| attempt fingerprint | `${code}:${expectedTradeDate}` | 直接用 store snapshot 字串，不再重算 |

production 預設就是實時 `nowMs()`；`fixedNow` 只能經 harness 路由的 `installHarnessClock` 注入（build-time DEV-only，**不新增任何 production query param**）。

Caller flow：`harnessClock` 覆寫 `Date.now` → `nowMs()` → `nowDate()` → store → `latestCompletedTradeDate` / `nextExpectedChangeAt` / `sparklineCacheKey` / fingerprint。單一來源，三者證明同源。

---

## 4. Scheduler lifecycle（唯一 schedule owner，可執行 pseudocode）

```ts
let refCount = 0, timer: Timeout | null = null, generation = 0;
let snapshot = '';            // expected trade date; '' = 尚未可信
let calendarReady = false;

// 唯一的 schedule owner；timer callback 與 visibility callback 都只呼叫它
function recomputeAndSchedule(reason: 'start'|'timer'|'visibility'|'calendar') {
  if (refCount === 0) return;                 // disposed guard
  const gen = ++generation;                   // 讓所有舊 callback 失效
  if (timer !== null) { clearTimeout(timer); timer = null; }  // 先 cancel stale
  const now = nowDate();

  if (!holidaysLoaded('TW')) {                // fail-closed：不推進、不排程
    calendarReady = false;
    ensureCalendar(gen);                      // loader daily cache + inflight dedupe
    return;
  }
  calendarReady = true;

  const next = latestCompletedTradeDate(now, { market: 'TW' });
  if (next !== snapshot) { snapshot = next; emit(); }   // 只有真的變才通知

  const at = nextExpectedChangeAt(now, { market: 'TW' });
  if (at == null) return;
  timer = setTimeout(() => {
    if (gen !== generation || refCount === 0) return;   // generation guard
    timer = null;
    recomputeAndSchedule('timer');            // 醒來一律以「現在」重算
  }, Math.max(0, at - nowMs()));
}
```
- **雙排程防護**：schedule 只發生在 `recomputeAndSchedule` 內；進入時先 `clearTimeout` 再 `++generation`，任何遲到的舊 callback 因 `gen !== generation` 直接 return。React state/effect 不排程（consumer 只 subscribe）。
- **subscriber transitions**：`subscribe()` 時 `refCount++`，`0→1` 呼叫 `recomputeAndSchedule('start')` 並 `addEventListener('visibilitychange', onVisible)`；unsubscribe `refCount--`，`1→0` 清 timer、移 listener、`++generation`。
- **onVisible**：`document.visibilityState === 'visible'` → `recomputeAndSchedule('visibility')`。同 expected → 不 emit、不觸發 request。
- **睡眠跳到 14:20**：timer 遲到觸發 → cancel stale ref → 以真實 now 重算 → expected 改變 emit 一次 → 只排下一顆。

---

## 5. Calendar fail-closed 但可恢復（不 polling）

- 首次 `loadMarketHolidays()` reject → `calendarReady=false`、snapshot 維持 `''`、**不推進 expected、0 次 sparkline**（保留 V1 契約）。
- 恢復點：`ensureCalendar(gen)` 在 `visibilitychange` 回前景時再試一次，走 loader 既有的 daily cache + inflight dedupe（`marketHolidaysLoader.ts:17-40`），成功即 `recomputeAndSchedule('calendar')`。**無 polling、無定時重試**。
- 不逐 code 查 holiday：整個 app 只有 store 這一處查。
- 不採「永久鎖住」：那會讓使用者不 reload 就永遠看不到收盤，不可接受。

**測試**：首次 reject → 0 sparkline；visibility regain 後 loader success → 依真實 now **恰 1 次** expected attempt；反覆 visibility 且同 expected → 0 新增 request。

---

## 6. Hosted harness

- harness 掛的是 **production 元件與 production hook**：`HoldingsDetailPanelVolumeHarnessEntry.tsx:279` 既有的 `useSparklines`，其內部訂閱同一個 `expectedTradeDateStore`。**不複製 boundary logic**（以 source-contract 測試鎖 harness 檔不得 import `nextExpectedChangeAt`）。
- clock 驅動證明：harness `installHarnessClock({ fixedNow })` 覆寫 `Date.now` → 第 3 點 `nowMs()` 是唯一 seam → store / cacheKey / fingerprint 全部跟著走。E2E 以 `fixedNow` 起於 14:04:5x，再由 harness 暴露的 `advanceTo(...)` 控制鈕推過 14:05（同一 mount，不等真實時間）。
- route counter 區分兩條路徑：harness 對 `checkup-sparkline` 的請求以 body `codes.length > 1` / 自帶 `x-lf-harness-path: batch|prefetch` 標記分流計數，斷言 batch=1、prefetch=0。
- 汙染防治：harness unmount 時 `clock.uninstall()` + 呼叫 store 的 `__resetForTests()`（清 timer/listener/generation/snapshot），且 sparkline 三個 cache namespace 於 spec `afterEach` 清空。

---

## 允許修改清單（exact，8 檔）

| 檔案 | 理由 |
|---|---|
| `src/checkup/lib/nowProvider.ts` (new) | 唯一 clock seam（`Date.now` 基底），閉合 harness 注入 |
| `src/checkup/lib/tradeDateBoundary.ts` (new) | `nextExpectedChangeAt(now, opts)` 純函式 |
| `src/checkup/lib/expectedTradeDateStore.ts` (new) | module-level singleton scheduler（timer=1 / listener=1 / refCount） |
| `src/checkup/hooks/useExpectedTradeDate.ts` (new) | `useSyncExternalStore` 薄封裝，consumer 只讀 snapshot |
| `src/checkup/hooks/useSparklines.ts` | effect deps 加 expected；cacheKey/fingerprint 顯式帶 now；inflight 升級為共用 reservation Map |
| `src/test/unit/sparkline-expected-boundary.test.tsx` (new) | A–I + singleton/lifecycle/clock 契約 |
| `src/pages/HoldingsDetailPanelVolumeHarnessEntry.tsx` | 只加 DEV-only 可觀測 seam（`data-expected-trade-date`、`advanceTo` 控制、路徑標記），不複製邏輯 |
| `e2e/holdings-sparkline-boundary.spec.ts` (new) | Hosted gate：同一 mount 受控跨界 |

**Rollback scope**：刪除 4 個新 lib/hook 檔 + 2 個新測試檔，還原 `useSparklines.ts`（deps / inflight）與 harness entry 的 seam。無 DB／Edge／cron／secret／Publish 面，單一 revert。

不動：TTL、`useConfirmedCloses`（確認 dead code，不喚醒）、factual laggers 誠實標示、BSR、quote banner、drawer lazy fetch、Stage 1 close-authority lane、`forceAuthority` 文件漂移。

---

## 測試矩陣（全部 executable，fake timers + fixed clock）

- **A** 14:04:59 mount → 邊界前 0；跨 14:05:00 expected 改變且恰 1 次。
- **B** +5min / +30min 同 expected → 累計仍 1。
- **C** 13:00 盤中不提前抓 settled sparkline。
- **D** 週五 14:05 後不推到週末／假日；loader reject → 0 次新 expected attempt。
- **E** 14:04 mount，時鐘跳到 14:20 → 遲到 callback 以「現在」重算，恰 1 次。
- **F** StrictMode double effect → 全域 timer=1、listener=1、request=1；unmount 後無 setState。
- **G** 同日新增 code 只抓新增集合；純 qty/price 變更 0 次。
- **H** 同一 tick 併發 batch + prefetch → route total invoke=1（reservation 生效）。
- **I** 039108 / 053848 / 702157 仍 pending/stale，不被 cache 或 current price 覆蓋。
- **J**（新增）多 consumer mount/unmount：refCount 0↔1 只在邊界 start/stop；最後一個離開後 timer=0、listener=0。
- **K**（新增）clock 契約：`installHarnessClock({fixedNow})` 後 store snapshot、`sparklineCacheKey`、fingerprint 三者同時反映注入時間。

其他 gate：`tsgo --noEmit`、targeted vitest、full regression（基準 3168 tests 全綠）、`bunx playwright test e2e/holdings-sparkline-boundary.spec.ts`。Hosted gate 於同一 mount 用受控時鐘證明，不等真實 14:05，不以 unit PASS 充當前端證據。

HOLDINGS_SPARKLINE_STAGE2_PLAN_V2_READY
