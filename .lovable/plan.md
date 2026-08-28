# HOLDINGS_SPARKLINE_STAGE2_PLAN_V5

根因不變（`useSparklines.ts:216` fetch effect deps `[codesKey, enabled, pricesKey]` 不含 expected trade date → same-mount 不重抓）。V4 的 source evidence 全數保留；本版修正 V4 的兩處自相矛盾與一處 reset race。

---

## 0. Mixed-market source evidence（唯讀，V4 保留）

1. **codes 來源**：`HoldingsWorkbench.tsx:89-91` `sparklineCodes = orderedDisplayed.map(...)`，無 market 過濾 → **可能混市場**。持倉市場判定 `marketClock.ts:70-86 detectHoldingMarket`；只憑 symbol 的單一資料源 `chipsRepository.ts:273 isTaiwanStockCode()` + `:451 normalizeStockCode()`（大小寫敏感，先大寫化；`00878`、`911616` 屬 TW，`AMD/SOXL` 非 TW）。
2. **cache identity**：`sparklineCacheKey(code, now, market='TW')`（`marketDataStatus.ts:141-146`）→ `datasetCacheKey`（`confirmedClose.ts:102-113`）→ `latestCompletedTradeDate(now,{market:'TW'})`；`identityOf` 固定 `TW:` 前綴（`confirmedClose.ts:89`）。**TW/US 一律套 TW tradeDate**。
3. **Edge**：`checkup-sparkline/index.ts:168-172` 以 `/^\d{4,6}[A-Z]?$/i` 過濾後 `slice(0,30)`，**US 代號 server 端被丟棄**，response 不含 market → hook 落 `sparklineFailCache`（既有負快取行為，本案不修）。US 假日永無載入：`marketHolidaysLoader.ts:26-31` 只查 `tw_market_holidays`。

**裁定維持 B（只安全支援 TW）**：US lane 無 production-ready 假日來源、Edge 亦 TW-only。

---

## 1. 【修正 A】雙 effect / 雙候選來源，共用 planner + attemptedRef + reservation

V4 錯誤宣稱「非 TW attempted key 不會變」。事實：legacy `sparklineCacheKey(US code)` 也用 TW tradeDate，**台北 14:05 後 legacy US key 確實會變**。因此不靠文字宣稱，改用結構隔離：

**(a) Legacy effect（保留，byte-compatible）**
- deps 維持 `[codesKey, enabled, pricesKey]`，candidate 維持 `planSparklineFetch(wanted, pricesByCode)`，attempt key 維持 `` `${code}:${sparklineCacheKey(code)}` ``，body 維持**單一 mixed** `{ codes: missing }`。
- 唯一改動：把 async IIFE 委派給 module task（第 2 節），good/partial/fail 三路 cache 寫入邏輯逐行搬移、**不改語意**；`cancelled` 不再阻擋 cache commit。
- **不做 market grouping**：mixed portfolio 一般載入仍是 **1 個 Edge call**。

**(b) TW-boundary effect（新增，獨立）**
- deps：`[enabled, calendarReady, twExpectedTradeDate, twCodesKey]`；`twCodesKey = normalizeStockCode 後 filter(isTaiwanStockCode) 排序 join`。
- candidate **永遠只有明確 TW subset**；key 一律 `sparklineCacheKeyForTradeDate(code, snapshot.expectedTradeDate)`，不在 effect 內問「現在幾點」。
- **US / unknown code 完全不進這條 planner** → 台北 14:05 只有這條 effect 重跑，**US request delta = 0**（即使 legacy wrapper 此刻重算會換 key 也無關，因為 legacy effect 的 deps 未變、不會 rerun）。
- 共用同一顆 `attemptedRef`（同一組 `code:key` 命名空間）與同一個 module reservation。

**(c) 併發次序**
- 兩條 effect 皆：**先同步 `attemptedRef.current.add(key)`，再 dispatch**；module reservation 做跨 consumer（含 `prefetchSparkline`）保險。**同 key 最多 1 invoke**。

**(d) Boot state（明確測試）**
- 首次 `calendarReady` 轉 true 時 TW-boundary effect 允許執行：
  - 若 legacy effect 已對同一 key attempt / 已有 cache → **新增 0**；
  - 若假日表載入後算出的正確 expected 與 legacy 初值**不同** → 才補打正確 TW key（此即 fail-closed 後的正確補正）。
- 這個 boot 分歧寫成 executable test（矩陣 O）。

**(e) 非 TW**：維持既有 legacy 負快取行為，不擴修。

---

## 2. 【修正 B】撤回 market grouping；module-owned task（identity-safe）

`src/checkup/lib/sparklineFetchTask.ts`（無 React）：

```ts
const reservations = new Map<string, Promise<void>>();
let currentGeneration = 0;

export function runSparklineTask(entries: Array<{ code: string; key: string }>, gateway) {
  const fresh = entries.filter(e => !reservations.has(e.key));
  const waiting = entries.filter(e => reservations.has(e.key)).map(e => reservations.get(e.key)!);
  if (!fresh.length) return Promise.all(waiting).then(() => {});

  let resolve!: () => void;
  const deferred = new Promise<void>(r => { resolve = r; });  // 1) 先建 deferred
  fresh.forEach(e => reservations.set(e.key, deferred));      // 2) 同步填 Map（第一個 await 之前）
  const gen = currentGeneration;

  const task = (async () => {                                  // 3) 此後才 await
    try {
      // 單一既有 body，caller 交來什麼就送什麼 —— 不做 market grouping
      const data = await gateway.invoke('checkup-sparkline', { codes: fresh.map(e => e.code) });
      if (gen !== currentGeneration) return;                   // stale → 不 commit
      commitToCaches(fresh, data);                             // good / partial / fail 全在此
    } catch {
      if (gen !== currentGeneration) return;                   // 【修正 C-1】catch 也要檢查 gen
      commitAllFail(fresh);
    } finally {
      // 【修正 C-2】identity-safe release：只刪自己那一筆
      fresh.forEach(e => { if (reservations.get(e.key) === deferred) reservations.delete(e.key); });
      resolve();                                               // 舊 deferred 仍 resolve，不碰新 entry
    }
  })();

  return Promise.all([task, ...waiting]).then(() => {});
}
```

- **無 market grouping**：normal legacy caller 仍 mixed 一批；TW-boundary caller 天然只有 TW 一批。body schema 仍 `{ codes }`，**不新增欄位、不新增 header**。
- cache commit 屬 task，任何 consumer unmount 都不取消。
- `prefetchSparkline(code)`：算同一 key → 命中 reservation 就 await 同一 promise（0 第二次 invoke），否則走同一支 task。
- 移除 V3 的 `origin/onDispatch` 測試參數；用 `fakeGateway` 的 `calls.invoke` spy。
- Abort：`GatewayPort.invoke(name, body)`（`gateway/types.ts:75`）不收 signal → **不加 Abort**。

`__resetForTests()`（DEV/test only）順序：`++currentGeneration` → `clearTimeout` + `removeEventListener` → `refCount=0` → `reservations.clear()` → reset snapshot。在途 task 因 gen stale **不寫 cache、不刪新 reservation**。

---

## 3. Stable snapshot + singleton scheduler（V4 保留）

```ts
interface ExpectedSnapshot { expectedTradeDate: string; computedAtMs: number; calendarReady: boolean }
function setSnapshot(next) {
  if (snapshot.expectedTradeDate === next.expectedTradeDate
   && snapshot.calendarReady === next.calendarReady) return;   // 不換 reference、不 emit
  snapshot = next; emit();
}
```
- `calendarReady=false` 重複發生不得 spread 新 reference（反覆 visibility + loader reject → 0 emit / 0 request）；`computedAtMs` 不參與相等判定。
- module-level **TW 單一 timer**（一顆）＋**全域 1 個 visibility listener**；唯一 `recomputeAndSchedule` owner；`++generation` 後先 `clearTimeout` 再重排；refCount `0↔1` 才 start/stop；睡醒以「現在」重算；calendar fail-closed，只在回前景經 `marketHolidaysLoader.ts:17-40` 的 daily cache + inflight dedupe 重試（無 polling、不逐 code 查假日）。
- clock seam：新增 `nowProvider.ts`（`Date.now()` 基底，與 `installHarnessClock` 同源；`new Date()` 會逃出覆寫）；snapshot / cache key / fingerprint 同源。
- 新增 `marketDataStatus.sparklineCacheKeyForTradeDate(code, tradeDate, market='TW')`；舊 `sparklineCacheKey` 降薄 wrapper，輸出字串不變（相容 caller：`src/test/unit/useSparklines-cache-migration.test.tsx:33`、`src/checkup/lib/__tests__/marketDataStatus.test.ts:95-102`；`datasetCacheKey` caller `src/test/unit/close-alignment.test.ts:119` 不受影響）。

---

## 4. Allowlist（exact，10 檔）

| 檔案 | 理由 |
|---|---|
| `src/checkup/lib/nowProvider.ts` (new) | 唯一 clock seam |
| `src/checkup/lib/tradeDateBoundary.ts` (new) | `nextExpectedChangeAt(now)` 純函式（TW） |
| `src/checkup/lib/expectedTradeDateStore.ts` (new) | TW singleton scheduler + stable snapshot + `__resetForTests` |
| `src/checkup/lib/sparklineFetchTask.ts` (new) | module-owned task、deferred-first reservation、identity-safe release、gen guard（含 catch）、**無 grouping** |
| `src/checkup/hooks/useExpectedTradeDate.ts` (new) | `useSyncExternalStore` 薄封裝 |
| `src/checkup/lib/marketDataStatus.ts` | 新增 `sparklineCacheKeyForTradeDate`；舊 API 薄 wrapper |
| `src/checkup/hooks/useSparklines.ts` | legacy effect 委派 task（byte-compatible）＋新增 TW-boundary effect＋共用 attemptedRef |
| `src/test/unit/sparkline-expected-boundary.test.tsx` (new) | A–O 矩陣 |
| `src/pages/HoldingsDetailPanelVolumeHarnessEntry.tsx` | DEV-only seam：`data-expected-trade-date`、`advanceTo`（無 header、不改 network body） |
| `e2e/holdings-sparkline-boundary.spec.ts` (new) | Hosted gate：同一 mount 受控跨界，baseline +1 |

**Rollback**：刪 5 新 lib/hook + 2 新測試；還原 `useSparklines.ts`、`marketDataStatus.ts`、harness seam。無 DB／Edge／CORS／cron／secret／Publish 面。

不動：TTL、`useConfirmedCloses`（dead code）、factual laggers 誠實、BSR、quote banner、drawer lazy fetch、Stage 1 close-authority lane、`forceAuthority` 文件漂移、US 既有負快取行為。

---

## 5. 測試矩陣（executable、fake timers + fixed clock、baseline/seed 基準）

- **A** 14:04:59 mount（seed 前一 expected）→ 邊界前無「今日 expected」fingerprint attempt；跨 14:05:00 total 恰 +1。
- **B** +5min / +30min 同 expected → +0。
- **C** 13:00：`latestCompletedTradeDate` 仍為前一交易日，絕不以當日為 completed；允許合法歷史 request（不斷言 total 0）。
- **D** 週五 14:05 後不推到週末／假日；loader reject → 新 expected attempt 0；visibility regain + success → 恰 1；反覆 visibility 同 expected → +0 且 setter 不換 reference（`Object.is`）。
- **E** 14:04 mount，時鐘跳 14:20 → 遲到 callback 以「現在」重算，+1。
- **F** StrictMode → 全域 timer=1、listener=1、request +1；unmount 後無 setState。
- **G** 同日新增 code 只抓新增集合；純 qty/price 變更 +0。
- **H** 同一 tick batch + prefetch 併發 → total invoke=1（gateway spy，無 header、無測試參數）。
- **I** 039108 / 053848 / 702157 仍 pending/stale，不被 cache 或 current price 覆蓋。
- **J** 多 consumer mount/unmount：refCount 0↔1 才 start/stop；最後離開 timer=0、listener=0。
- **K** clock 契約：`installHarnessClock({fixedNow})` 後 snapshot、cache key、fingerprint 三者同時反映注入時間。
- **L** task lifecycle：reserve→立即 unmount→同 tick prefetch await 同 task→resolve 後 cache 有值、total=1、`reservations.size===0`；throw / partial / fail 三路徑各證 Map=0 且可 retry。
- **M（修正）mixed-market**：fixture `['2330','00878','911616','AMD','SOXL']`。
  - **初次 mixed 載入的 legacy body 與修改前 exact 一致**（逐字比對 `calls.invoke[0].body.codes` 陣列與順序），**總 invoke 不增加**（仍 1）。
  - 台北 14:05 跨界：**total +1**，且該 call 的 `body.codes` **只有 TW subset**（2330 / 00878 / 911616）。
  - **US（AMD/SOXL）cache key 字串與 attempted key 不因 boundary path 改變**、request delta = 0。
  - qty / current price 變更 → TW 與 US 皆 +0。
- **N（新增）reset replacement race**：task A pending → `__resetForTests()` → 同 key 建立 task B reserve →
  - N-1：A **resolve** → A 不寫任何 cache、`reservations.get(key)` 仍是 B、B commit 後 Map size = 0；
  - N-2：A **throw** → 同上（catch 亦不 `commitAllFail`）。
- **O（新增）boot state**：`calendarReady` 由 false→true。
  - O-1 legacy 已 attempt 同一 key → TW-boundary 新增 0；
  - O-2 假日表使正確 expected ≠ legacy 初值 → TW-boundary 補打，且只含 TW subset、total +1。

其他 gate：`tsgo --noEmit`、targeted vitest、full regression（基準 3168 tests 全綠）、`bunx playwright test e2e/holdings-sparkline-boundary.spec.ts`。Hosted gate 在同一 mount 用受控時鐘（`installHarnessClock` + harness `advanceTo`）證明：記 baseline 後跨界 total 恰 +1；不等真實 14:05、不以 unit PASS 充當前端證據；harness unmount 時 `clock.uninstall()` + 兩支 `__resetForTests()`。

HOLDINGS_SPARKLINE_STAGE2_PLAN_V5_READY
