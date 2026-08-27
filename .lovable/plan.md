# PLAN_V4.3 — 修補 F1 / F2 / F3 / F4 / F7

只修 SOURCE_REVIEW_REJECTED 的五項。不 deploy / Publish / DB / cron / provider；不碰 B10 平台證據，不按 Fix build。完成後停在 SOURCE_REVIEW_READY。

## 0. Changed paths（4 actual，全在原核准 11-path allowlist 內）

| # | path | 類型 |
|---|---|---|
|1|`src/checkup/hooks/useChipsBatch.ts`|產品（F3）|
|2|`src/test/unit/holdings-chips-batch-race.test.ts`|測試（F3 + F4）|
|3|`src/test/unit/bsr-terminal-no-backfill.test.tsx`|測試（F1 + F2）|
|4|`e2e/holdings-bsr-unavailable.spec.ts`|測試（F7）|

**不需要第 5 個 path。** 其餘 7 個 allowlist 檔案（HoldingCard.tsx、HoldingCardBsr.tsx、bsrCanonicalCodes.ts、useChipsLifecycle.ts、tw-chips-detail-v2/index.ts、holdings-chips-chunking.test.ts、holdings-nodrawer-chips-consumer.test.tsx）本輪 0 修改。`src/integrations/supabase/*` 與 `db/r1/p/acl-25.*` OUT_OF_SCOPE_PRESERVE。

## 1. F3 — manual prefetch 缺 enabled / mounted / runId gate

### 現況（已讀 `useChipsBatch.ts` L247-273）
`prefetch` 只有 `claim/owns` per-code token；request 前不看 `enabled`、`mountedRef`，await 後也只看 token。`enabled=false` 時 hover 仍實際呼叫 `prefetchChipsPayload` 並 `setQueryData`；unmount 後仍寫 payload（`addPrefetched` 內部才擋 mounted，payload 不擋）。

### 先紅測（寫在 `holdings-chips-batch-race.test.ts`）
- **R1 enabled=false**：`renderHook(useChipsBatch({ codes, enabled:false }))` → `act(prefetch('2330'))`；斷言 `prefetchChipsPayload` 呼叫次數 `toBe(0)`、`prefetchSparkline` `toBe(0)`、`qc.getQueryData(chipsQueryKey('2330'))` `toBeUndefined()`、`chipsBatchStatusKey('2330')` `toBeUndefined()`、`result.current.prefetched.size` `toBe(0)`。
- **R2 in-flight manual → unmount**：deferred promise，`prefetch()` 起飛後 `unmount()`，再 resolve 成功 payload；斷言 payload key `toBeUndefined()`、status key `toBeUndefined()`、無 unhandled rejection、`prefetch()` 的 promise 不 reject。
- **R3 in-flight manual → enabled true→false**：`rerender({ enabled:false })` 後才 resolve；斷言同 R2 的 0 寫入，且既有 `'2330'` batch 結果（若已存在）不被改寫。
- **R4 reject 路徑**：R2 / R3 的 promise 改 reject，斷言不寫入任何 `kind:'error'` status，且 `prefetch()` 不向外拋。

修前預期失敗：R1（fetch 1≠0、payload 被寫入）、R2/R3（payload 被寫入）。R4 目前不會寫 error（manual 無 catch 寫入），預期 GREEN — 保留為 guard。

### 產品修補
`useChipsBatch.ts` 內：
- 新增 `enabledRef`，於 `useEffect` 同步 `enabledRef.current = enabled`。
- `prefetch` 開頭 request **之前**：`if (!enabledRef.current || !mountedRef.current) return;`，並捕捉 `const myRun = runIdRef.current;`。
- `await` **之後**（payload 分支與 `addPrefetched` 之前）加上四重閘：`if (!mountedRef.current || !enabledRef.current || myRun !== runIdRef.current || !owns(code, myTok)) return;`。
- `prefetchSparkline` 一併移到同一個 pre-gate 之後。

**winner 語意不變**：token 仍是唯一 ownership 來源，`myRun` 只在 manual 自身路徑檢查，不改變 batch↔manual 的先後判定；batch 端 L195/L199/L209/L221/L234 一行未動。既有三案（run1→run2、batch→newer manual、manual1→manual2）必須續綠。

風險註記：`myRun !== runIdRef.current` 會讓「manual 進行中，可見卡片變動觸發新 batch run」的 manual 結果被丟棄。這符合 v4.2「較新者勝」語意（新 batch 已 `claim` 新 token，manual 本來就會被 token gate 擋掉），因此不改變任何既有斷言；R5（F4）會明確固定此行為。

## 2. F4 — 補三組真 deferred cross-race（同檔）

保留既有三案原樣，不弱化。新增：

- **R5 manual → newer batch**：manual deferred 起飛（未 resolve）→ 觸發新 run（codes 變更）→ batch 先 resolve `_from:'batch2'` → 再 resolve 舊 manual `_from:'manual'`。
  斷言：`chipsQueryKey('2330').payload._from === 'batch2'`；status `kind==='ok'` 且 `runId === 目前 runIdRef`（以 status.runId 遞增比對）；`prefetched.has('2330') === true`。
- **R6 unmount**：batch in-flight + manual in-flight → `unmount()` → 兩者皆 resolve。
  斷言：payload key `toBeUndefined()`；status 停在 unmount 前的 `kind:'pending'`（不得變成 `'error'`/`'chunk_failed'`）；`prefetched` 不再新增（以 unmount 前快照比較）。
- **R7 enabled true→false**：run1 in-flight → `rerender({ enabled:false })` → run1 resolve。
  斷言：payload `toBeUndefined()`、status 仍 `pending`、`prefetched.size` 與切換前相同；接著 `prefetch()` 亦 0 寫入（與 R1 一致）。

## 3. F1 — terminal 必須經 public `useChipsLifecycle.requestBackfill` 驗證

### 已確認的 exact flow（`useChipsBackfill.ts` L?-?，read-only 已核對）
```
requestBackfill()
  → gateway.invoke('tw-institutional-daily-sync', { mode:'backfill_stock', stock_id, days:60 })
  → gateway.rpc<number>('enqueue_bsr_backfill', { p_stock_id, p_days:60 })
  （Promise.allSettled 並行，各 1 次；module-level inFlight + MAX_ATTEMPTS_PER_STOCK=2 去重）
```
`useChipsLifecycle.handleBackfill` = 對外 `requestBackfill`，L86-89 已有 `if (!canRequestBackfill(facts)) return;`。

### 測試（`bsr-terminal-no-backfill.test.tsx`，改為含 renderHook 的真實 runtime 測試）
- Mock `@/checkup/lib/gateway` 的 `getCheckupGateway`，回傳兩個**具名 spy**：`rpcSpy` / `invokeSpy`。
- Mock `@/checkup/lib/chipsRepository` 的 `fetchChipsPayload` / `fetchChipsStamp`，讓 `useTwChipsDetail` 拿到真實形狀的 payload；`deriveChipsFacts` 走真碼（不 stub facts）。
  - terminal fixture：`bsr_provider_state:'terminal_provider_rejected'`、`bsr_provider_code:'bsr_provider_unsupported'`、`series.institutional_daily` 長度 3、`bsr_concentration` 長度 0（sparse 且 eligible，確保若無 gate 一定會回補）。
- Mock `sonner` toast、`@/lib/trafficTracker`。`beforeEach` 呼叫 `__resetChipsBackfillBudget()`。
- 步驟：`renderHook(() => useChipsLifecycle('2330', true))` → `waitFor(facts.terminalUnavailable === true)` → `act(() => result.current.requestBackfill())` → 再等 500ms fake timer 讓 auto-backfill 有機會觸發。
- 斷言：`invokeSpy` **exact** `toHaveBeenCalledTimes(0)`、`rpcSpy` **exact** `toHaveBeenCalledTimes(0)`。

既有 `canRequestBackfill` 單元斷言保留；**移除**目前那兩條以 `readFileSync` + regex 檢查 source 字串的斷言（`useChipsLifecycle` 那條），改由本 runtime 測試取代（`ChipsSection.tsx` 那條 regex 保留，因該檔不在 allowlist 內、無法改為 runtime 測）。

## 4. F2 — transient control（同檔、同一 public contract）

同樣 fixture 但 `bsr_provider_state:'available'`、`bsr_sync_status.status:null`、`eligible:true`、instDays 3 / bsrDays 0（sparse）。

- 呼叫 `result.current.requestBackfill()` 一次。
- 斷言 **exact counts**：`invokeSpy` `toHaveBeenCalledTimes(1)`、`rpcSpy` `toHaveBeenCalledTimes(1)`（不得用 `<=`）。
- 斷言 arguments：
  - `invokeSpy` `toHaveBeenCalledWith('tw-institutional-daily-sync', { mode:'backfill_stock', stock_id:'2330', days:60 })`
  - `rpcSpy` `toHaveBeenCalledWith('enqueue_bsr_backfill', { p_stock_id:'2330', p_days:60 })`
- 為避免 auto-backfill 疊加造成計數漂移：測試中把 `hasData` 之後的自動觸發納入計算 —— 若 runtime 觀察到自動回補也各打 1 次（總數 2/2），以**修前實測數字**為準寫死 exact 值，並在測試註解記錄來源；不接受區間斷言。

## 5. F7 — 390px E2E 補強（`e2e/holdings-bsr-unavailable.spec.ts`）

已 read-only 核對 harness fixture 與實際 DOM：
- fixture：`qty:1000, cost:100, price:110`。
- **`1,000 股` 在卡片 DOM 內不存在** —— `HoldingCardHeader` 註記「Sparkline / 股數 / 策略散文全部移到抽屜（§4）」，`card-qty` 內只有名稱＋代號。因此 qty literal 改為以下兩條等價證據（不新增檔案、不改產品碼）：
  - `card-qty` `toContainText('2330')`（或 fixture 實際代號）
  - 卡片根節點 `aria-label` `toContain('損益 +10,000')` 與 `toContain('報酬率 +10.00%')`
- 價格 literal 依 `PriceTrack.tsx` 實際輸出：`card-price` `toContainText('成本 100')` 與 `toContainText('現價 110')`。
- 新增 `expect(sb!.x).toBeGreaterThanOrEqual(0)`。
- 保留既有：`card-pnl` 含 `10.00%` 與 `10,000`、`sb.y >= rb.y + rb.height - 1`（non-overlap）、`sb.x + sb.width <= 390`、30+1 body 分塊、terminal 0 請求。
- 同時修 F1 在 E2E 面的觀測缺口：terminal control 的 `page.route` 由 `**/functions/v1/**` 擴為同時攔 `**/rest/v1/rpc/**`，並以兩個具名 counter 分別斷言 `tw-institutional-daily-sync` invoke=0、`enqueue_bsr_backfill` rpc=0。

## 6. 執行順序（TDD，紅燈收據）

1. 先只加測試（3 個測試檔），跑 targeted：
   `npx vitest run src/test/unit/holdings-chips-batch-race.test.ts src/test/unit/bsr-terminal-no-backfill.test.tsx`
   `npx playwright test --project=desktop-holdings-bsr-unavailable`
   逐項貼 exact failure 訊息（測試名 + expected/received）。任何「應紅卻綠」的案子視為測試無效，必須改成真的能抓修前 bug 才往下走（禁止以 source-string regex 取代 runtime 行為）。
2. 只改 `useChipsBatch.ts` 一支產品碼。
3. targeted 全綠。
4. 全套 gates（逐項貼 exact command + exit code）：兩次 sequential `npx vitest run` 皆 exit 0、`npm run check:module-boundaries`、`npx tsgo -p tsconfig.app.json --noEmit`、edge undefined-symbol audit（僅允許 `Deno`）、`npx vite build`、4-path lint delta（new errors 必須 0）、holdings/chips 7 projects、journal/signal 7 projects。
5. 列 actual changed paths + A/M + 完整 64-char SHA256 + 對 `03b26f4f7` 的 `--name-status`。
6. 任何紅燈 → REJECTED，不宣稱完成。

## 7. Open questions

無。唯一與原指令不同之處已於 §5 說明並自行決議：`1,000 股` literal 在現行卡片 DOM 不存在，改以 `aria-label` 損益/報酬率 literal ＋ `成本 100`/`現價 110` 取代，不為此新增第 5 個 path、不修改產品碼。

**PLAN_V4.3_READY**
