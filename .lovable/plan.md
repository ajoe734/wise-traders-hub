# HOLDINGS_SPARKLINE_STAGE2_PLAN_V4

根因不變（`useSparklines.ts:216` effect deps 不含 expected date）。V3 保留：module-owned fetch task、stable expected snapshot、無 custom header、baseline-based tests。本版新增 mixed-market 稽核與結論。

---

## 0. Mixed-market source evidence（唯讀）

**1. codes 來源與市場分類**
- `HoldingsWorkbench.tsx:89-91`：`sparklineCodes = orderedDisplayed.map(h => String(h.code).trim()).filter(Boolean)` — **沒有任何 market 過濾**，持倉是什麼就送什麼。
- 持倉可含美股：`src/checkup/lib/marketClock.ts:70-86 detectHoldingMarket(row)`（`asset_class==='us_stock'` → US；否則 `/^\d{4,6}[A-Z]?$/i` → TW，其餘 → US），且 `Market = 'TW'|'US'|'CRYPTO'|'US_OPTION'`（`marketClock.ts:11`）。
- 只憑 symbol 的判定單一資料源：`chipsRepository.ts:273 isTaiwanStockCode()` + `:451 normalizeStockCode()`（trim + 大寫；註解已記錄過 `/i` 造成 `00637L` 靜默漏檔的事故）。ETF `00878`、6 碼權證 `911616` 皆為純數字 → **屬 TW**。`AMD/SOXL/ORCL/QCOM` → 非 TW。
- **結論**：`useSparklines` 收到的 codes **確實可能混市場**。V4 必須處理。

**2. 現行 cache identity / plan / gateway body 對 TW/US 各用什麼**
- `sparklineCacheKey(code, now, market = 'TW')`（`marketDataStatus.ts:141-146`）→ `datasetCacheKey`（`confirmedClose.ts:102-113`）→ `latestCompletedTradeDate(now, { market:'TW' })`。**目前 TW/US 一律套 TW tradeDate 與 `TW:` 前綴**（`identityOf`，`confirmedClose.ts:89`）。`MarketCode` 在 `marketDataStatus.ts:16` 硬寫成 `'TW'`。
- `planSparklineFetch`（`useSparklines.ts:130-141`）同樣走這支 key，無 market 分支。
- gateway body：`invoke('checkup-sparkline', { codes: missing })`（`useSparklines.ts:180`）— 混市場一起送。

**3. checkup-sparkline 是否吃混市場**
- `supabase/functions/checkup-sparkline/index.ts:168-172`：`codes` 先 `/^\d{4,6}[A-Z]?$/i` **過濾**再 `slice(0,30)`；抓取走 `fetchTwDailyOhlc`（`_shared/twPriceWaterfall.ts`，TWSE→TPEx→FinMind），expected 用 `expectedLatestBsrDate`（台北）。cache key `sparkline_v3_${code}_${day}`（`:192`）**不含 market**。
- 即：**US 代號被 server 直接丟棄**，response 不含它們 → hook 走 `bad` 分支寫入 `sparklineFailCache`（`:196`）。response **不帶 market 欄位**。
- 結論：**這是一支 TW-only 端點**；US 目前是「每 30 分鐘負快取重試一次」的既有行為（不是本案造成，本案也不修）。

---

## 1. 裁定：採 **B（只安全支援 TW）**

理由（證據）：`marketCalendar` 雖有 `US` rule（`:41`）與 `holidaySets.US`（`:82`），但 **US 假日表永遠沒人載入** — `marketHolidaysLoader.ts:26-31` 只查 `tw_market_holidays` 並 `setMarketHolidays(..., 'TW')`。故 `holidaysLoaded('US') === false` 恆成立，US lane 一律 `unknown`，不具 production readiness。加上 edge 本身 TW-only（第 3 點），A 方案沒有可證的落地面。

**Scope 契約**
- `twCodes = codes.filter(c => isTaiwanStockCode(normalizeStockCode(c)))` → 走新的 TW snapshot / key / boundary。
- **所有非 TW codes 完整保留 legacy 語意**：沿用現行 `sparklineCacheKey(code)`（wrapper，行為字節不變）、現行 attempt key、現行 fetch 分組行為 —— 一個位元都不改。
- 台北 14:05 effect 雖會 rerun，但**非 TW 的 attempted key 不得變**（其 key 由 legacy wrapper 產生，且新 fingerprint 只對 TW subset 重算）→ **US gateway 增量 = 0**。
- **unknown code 一律不當 TW**：分類只用 `isTaiwanStockCode`（大小寫敏感，先 `normalizeStockCode` 大寫化），非數字型一律歸非 TW。
- dispatch grouping 明確：`runSparklineTask` 以 market 分組，TW group 與 legacy group **各自成批**呼叫 `invoke('checkup-sparkline', { codes })`，body 仍是既有 `{ codes }`，**不新增欄位、不新增 header**。非 TW group 的行為與現行完全一致（送出、被 server 過濾、落 fail cache）。

---

## 2. Module-owned fetch task（V3 保留 + reservation 建立順序）

`src/checkup/lib/sparklineFetchTask.ts`（無 React）：

```ts
const reservations = new Map<string, Promise<void>>();

export function runSparklineTask(entries: Array<{ code: string; key: string }>, gateway) {
  const fresh = entries.filter(e => !reservations.has(e.key));
  const waiting = entries.filter(e => reservations.has(e.key))
                         .map(e => reservations.get(e.key)!);
  if (!fresh.length) return Promise.all(waiting).then(() => {});

  let resolve!: () => void;
  const deferred = new Promise<void>(r => { resolve = r; });   // 1) 先建 deferred
  fresh.forEach(e => reservations.set(e.key, deferred));       // 2) 同步填 Map
  const gen = currentGeneration;

  // 3) 這裡才是第一個 await：Map 早已填好，同 tick 的 prefetch 必命中 reservation
  const task = (async () => {
    try {
      const data = await gateway.invoke('checkup-sparkline', { codes: fresh.map(e => e.code) });
      if (gen !== currentGeneration) return;                   // __resetForTests 失效保護
      commitToCaches(fresh, data);                             // good / partial / fail 全在此
    } catch { commitAllFail(fresh); }
    finally { fresh.forEach(e => reservations.delete(e.key)); resolve(); }
  })();

  return Promise.all([task, ...waiting]).then(() => {});
}
```
- **cache commit 屬於 task**，任何 consumer unmount 都不取消；`useSparklines` cleanup 只釋放 subscription，不再用 `cancelled` 擋 cache write（現行 `useSparklines.ts:176/181/215`）。
- `prefetchSparkline(code)`：算 key → 命中 reservation 則 await 同一 promise 後 return（0 第二次 invoke）；否則走同一支 `runSparklineTask`。
- **移除 V3 的 `origin/onDispatch`**：production API 不塞測試參數；`total invoke` spy（`gateway/fakeGateway.ts:227` 的 `calls.invoke`）已足夠。
- Abort：`GatewayPort.invoke(name, body)`（`gateway/types.ts:75`）不收 AbortSignal → **不加 Abort**。

---

## 3. Stable snapshot（含 no-op setter 契約）

```ts
interface ExpectedSnapshot { expectedTradeDate: string; computedAtMs: number; calendarReady: boolean }
function setSnapshot(next: ExpectedSnapshot) {
  const cur = snapshot;
  if (cur.expectedTradeDate === next.expectedTradeDate
    && cur.calendarReady === next.calendarReady) return;   // 值相同 → 不換 reference、不 emit
  snapshot = next; emit();
}
```
- `calendarReady=false` 重複發生時**不得 spread 出新 reference**（反覆 visibility + loader reject → 0 emit、0 effect rerun、0 request）。
- `computedAtMs` 只在真正換值時更新，不參與相等判定（否則每次都換 reference）。
- key 導出：新增 `marketDataStatus.sparklineCacheKeyForTradeDate(code, tradeDate, market='TW')`，TW cache key / attempt fingerprint / reservation key **全部**由 `snapshot.expectedTradeDate` 導出，effect 內不再呼叫 `nowDate()`。舊 `sparklineCacheKey(code, now, market)` 降為薄 wrapper，輸出字串不變（相容 caller：`useSparklines.ts` 之外尚有 `src/test/unit/useSparklines-cache-migration.test.tsx:33`、`src/checkup/lib/__tests__/marketDataStatus.test.ts:95-102`；`datasetCacheKey` caller `src/test/unit/close-alignment.test.ts:119` 不受影響）。

Scheduler（V3 pseudocode 不變）：module-level singleton、唯一 `recomputeAndSchedule` owner、`++generation` + 先 `clearTimeout`、refCount `0↔1` start/stop、`visibilitychange` 共用同一 owner、睡醒以「現在」重算；calendar fail-closed 且只在回前景重試（`marketHolidaysLoader.ts:17-40` 的 daily cache + inflight dedupe），無 polling、不逐 code 查 holiday。**只維護 TW 一個 market 的 timer**（B 方案），故全域 timer=1、listener=1。

---

## 4. `__resetForTests()`（DEV/test only）

順序：`++generation` → `clearTimeout` + `removeEventListener` → `refCount=0` → `reservations.clear()` → reset snapshot/calendarReady。在途 task 因 `gen !== currentGeneration` 只 release、不寫 cache，不污染下一支 spec。

---

## 5. Allowlist（exact，10 檔）

| 檔案 | 理由 |
|---|---|
| `src/checkup/lib/nowProvider.ts` (new) | 唯一 clock seam（`Date.now`，與 `installHarnessClock` 同源；`new Date()` 會逃出覆寫） |
| `src/checkup/lib/tradeDateBoundary.ts` (new) | `nextExpectedChangeAt(now, opts)` 純函式（TW） |
| `src/checkup/lib/expectedTradeDateStore.ts` (new) | TW singleton scheduler + stable snapshot + `__resetForTests` |
| `src/checkup/lib/sparklineFetchTask.ts` (new) | module-owned task、deferred-first reservation、market 分組 dispatch、cache commit |
| `src/checkup/hooks/useExpectedTradeDate.ts` (new) | `useSyncExternalStore` 薄封裝 |
| `src/checkup/lib/marketDataStatus.ts` | 新增 `sparklineCacheKeyForTradeDate`；舊 API 降為薄 wrapper |
| `src/checkup/hooks/useSparklines.ts` | deps 加 TW expected；TW subset 由 snapshot 導 key；非 TW 走 legacy；改用 module task |
| `src/test/unit/sparkline-expected-boundary.test.tsx` (new) | A–M 全覆蓋（含 mixed fixture） |
| `src/pages/HoldingsDetailPanelVolumeHarnessEntry.tsx` | DEV-only seam：`data-expected-trade-date`、`advanceTo`（無 header、不改 network body） |
| `e2e/holdings-sparkline-boundary.spec.ts` (new) | Hosted gate：同一 mount 受控跨界，baseline +1 |

**Rollback**：刪 5 新 lib/hook + 2 新測試；還原 `useSparklines.ts`、`marketDataStatus.ts`、harness seam。無 DB／Edge／CORS／cron／secret／Publish 面。

不動：TTL、`useConfirmedCloses`（dead code）、factual laggers 誠實標示、BSR、quote banner、drawer lazy fetch、Stage 1 close-authority lane、`forceAuthority` 文件漂移、US 既有負快取行為。

---

## 6. 測試矩陣（executable、fake timers + fixed clock、baseline/seed 基準）

- **A** 14:04:59 mount（seed 前一 expected）→ 邊界前無「今日 expected」fingerprint attempt；跨 14:05:00 total 恰 +1。
- **B** +5min / +30min 同 expected → +0。
- **C** 13:00：斷言 `latestCompletedTradeDate` 仍為**前一交易日**、絕不以當日為 completed；允許合法歷史 request（不斷言 total 0）。
- **D** 週五 14:05 後不推到週末／假日；loader reject → 新 expected attempt 0；visibility regain + success → 恰 1；反覆 visibility 同 expected → +0，且 setter 不換 reference（`Object.is` 斷言）。
- **E** 14:04 mount，時鐘跳 14:20 → 遲到 callback 以「現在」重算，+1。
- **F** StrictMode → 全域 timer=1、listener=1、request +1；unmount 後無 setState。
- **G** 同日新增 code 只抓新增集合；純 qty/price 變更 +0。
- **H** 同一 tick 併發 batch + prefetch → total invoke=1（gateway spy，無 header、無測試參數）。
- **I** 039108 / 053848 / 702157 仍 pending/stale，不被 cache 或 current price 覆蓋。
- **J** 多 consumer mount/unmount：refCount 0↔1 才 start/stop；最後離開後 timer=0、listener=0。
- **K** clock 契約：`installHarnessClock({fixedNow})` 後 snapshot、cache key、fingerprint 三者同時反映注入時間。
- **L** task lifecycle：reserve→立即 unmount→同 tick prefetch await 同 task→resolve 後 cache 有值、total=1、`reservations.size===0`；throw / partial / fail 三路徑各證 Map=0 且可 retry；`__resetForTests` 後在途 task 不寫 cache。
- **M（新增）mixed-market fixture**：`['2330','00878','911616','AMD','SOXL']`。
  - 台北 14:05 跨界 → 只新增 **TW subset**（2330 / 00878 / 911616）的 request 與 fingerprint；
  - **US（AMD/SOXL）request delta = 0、cache key 字串不變**（與 legacy wrapper 逐字比對）；
  - qty / current price 變更 → TW 與 US 皆 +0；
  - 斷言 dispatch grouping 出現在**真實 body**（`calls.invoke[].body.codes`），非 mock 隱藏：TW group 與 legacy group 分批，body schema 仍為 `{ codes }`。

其他 gate：`tsgo --noEmit`、targeted vitest、full regression（基準 3168 tests 全綠）、`bunx playwright test e2e/holdings-sparkline-boundary.spec.ts`。Hosted gate 在同一 mount 用受控時鐘（`installHarnessClock` + harness `advanceTo`）證明，記 baseline 後跨界 total 恰 +1；不等真實 14:05、不以 unit PASS 充當前端證據；harness unmount 時 `clock.uninstall()` + 兩支 `__resetForTests()`。

HOLDINGS_SPARKLINE_STAGE2_PLAN_V4_READY
