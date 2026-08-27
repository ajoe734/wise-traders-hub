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
- **R2 in-flight manual → unmount**：deferred promise，`prefetch()` 起飛後 `unmount()`，再 resolve 成功 payload；斷言 payload key `toBeUndefined()`、status key `toBeUndefined()`、`prefetched` 快照不變。
- **R3 in-flight manual → enabled true→false**：在**同一個 `act()` 內** `rerender({ enabled:false })`，之後才 resolve；斷言同 R2 的 0 寫入，且既有 `'2330'` batch 結果（若已存在）不被改寫。同案再追加「切 false 後呼叫 `prefetch()`」→ `prefetchChipsPayload` 增量 0、`prefetchSparkline` 增量 0（network=0）。
- **R4 reject 路徑**：R2 / R3 的 deferred 改為 reject。斷言：不寫 payload、不寫任何 status（尤其不得出現 `kind:'error'`）、`prefetched` 不變。

**R4 的對外 contract 處理**：現行 `prefetch` 是 `await Promise.all([...])` 且**沒有 try/catch**，因此 upstream reject 會原樣往外傳（現行 contract 不 swallow）。本輪**不改變**此 resolve/reject 對外契約；測試端以 `await expect(p).rejects.toThrow()`（或 `p.catch(() => {})` 並在 assert 前 await）自行吸收，避免 unhandled rejection。修補只加 early-return gate，不新增 catch。

修前預期失敗：R1（fetch 1≠0、payload 被寫入）、R2/R3（payload 被寫入）、R3 追加案（network≠0）。R4 目前不會寫 error status，預期 GREEN — 保留為 regression guard，並在報告中標明「非紅測」。

### 產品修補
`useChipsBatch.ts` 內：
- 新增 `enabledRef`，採 **render-time assignment**：在 hook 函式本體（任何 `useEffect` 之前）直接 `enabledRef.current = enabled;`。
  理由：`enabled` 由 props 傳入，effect 內同步會晚一個 commit —— `rerender({enabled:false})` 之後、effect 尚未跑完的空窗期內若觸發 `prefetch` 或有 in-flight 結果回來，effect 版 ref 仍是 `true`，閘會漏。render-time 寫入在 rerender 回傳當下即為最新值，能覆蓋「同一個 act 內切 false」這條 race。此處只寫入純量、不讀取跨 render 狀態，對 StrictMode double-render 冪等（兩次都寫同一值），不觸發 tearing。R3 是此決策的驗收證據。
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
- **只 mock 最低層 gateway**：`vi.mock('@/checkup/lib/gateway')` 讓 `getCheckupGateway()` 回傳 `{ invoke: invokeSpy, rpc: rpcSpy }`。**明令不得** mock `useChipsBackfill`、`requestBackfill`、`useChipsAutoBackfill` 或 `canRequestBackfill` —— 真實碼必須跑到 `Promise.allSettled([invoke(...), rpc(...)])` 這一行，否則測試無效。
- Mock `@/checkup/lib/chipsRepository` 的 `fetchChipsPayload` / `fetchChipsStamp`，讓 `useTwChipsDetail` 拿到真實形狀的 payload；`deriveChipsFacts` 走真碼（不 stub facts）。
  - terminal fixture：`bsr_provider_state:'terminal_provider_rejected'`、`bsr_provider_code:'bsr_provider_unsupported'`、`series.institutional_daily` 長度 3、`bsr_concentration` 長度 0（sparse 且 eligible，確保若無 gate 一定會回補）。
- Mock `sonner` toast、`@/lib/trafficTracker`。`beforeEach` 呼叫 `__resetChipsBackfillBudget()`。
- 步驟：`renderHook(() => useChipsLifecycle('2330', true))` → `waitFor(facts.terminalUnavailable === true)` → `act(() => result.current.requestBackfill())` → 再等 500ms fake timer 讓 auto-backfill 有機會觸發。
- 斷言：`invokeSpy` **exact** `toHaveBeenCalledTimes(0)`、`rpcSpy` **exact** `toHaveBeenCalledTimes(0)`。

既有 `canRequestBackfill` 單元斷言保留；**移除**目前那兩條以 `readFileSync` + regex 檢查 source 字串的斷言（`useChipsLifecycle` 那條），改由本 runtime 測試取代（`ChipsSection.tsx` 那條 regex 保留，因該檔不在 allowlist 內、無法改為 runtime 測）。

## 4. F2 — transient control（同檔、同一 public contract，auto 必須為 0）

### auto 關閉方式（用既有公開 input，不新增旗標）
`shouldAutoTrigger`（`chipsBackfillMachine.ts` L101-107）在 `!s.sparse` 時回 false；`sparse` 由 `deriveChipsFacts` 算出 `instDays < 20 || bsrDays < 5`。

因此 transient fixture 設計為 **non-terminal 且 non-sparse**：
`bsr_provider_state:'available'`、`bsr_sync_status:{ status:null, eligible:true }`、`series.institutional_daily` 長度 **30**、`series.bsr_concentration` 長度 **10**、`readiness.institutional['60'].state`/`['20'].state` 設為 ready（`satisfied:true`）。
→ `facts.sparse === false`、`terminalUnavailable === false` → auto machine 永不 `requestBackfill`，manual contract 被完全隔離。

### 斷言
- 前置守門：`waitFor(facts.sparse === false && facts.terminalUnavailable === false)`，並在呼叫 manual **之前**先斷言 `invokeSpy`/`rpcSpy` 皆 `toHaveBeenCalledTimes(0)`（證明 auto 真的 0 次，不是被 manual 蓋掉）。
- 呼叫 `await act(() => result.current.requestBackfill())` **恰一次**。
- 斷言 **exact counts**（禁止 `<=`）：`invokeSpy` `toHaveBeenCalledTimes(1)`、`rpcSpy` `toHaveBeenCalledTimes(1)`。
- 斷言 arguments：
  - `invokeSpy` `toHaveBeenCalledWith('tw-institutional-daily-sync', { mode:'backfill_stock', stock_id:'2330', days:60 })`
  - `rpcSpy` `toHaveBeenCalledWith('enqueue_bsr_backfill', { p_stock_id:'2330', p_days:60 })`
- 收尾：再等 500ms（fake timer）後重新斷言仍是 1/1，證明無 auto 尾隨疊加。
- 若實測 auto 仍非 0（例如 poll 路徑意外觸發），視為**紅燈**回報，不得改寫成 2/2 寫死。

## 5. F7 — 390px E2E 補強（`e2e/holdings-bsr-unavailable.spec.ts`）

已 read-only 核對 harness fixture 與實際 DOM：
- fixture：`qty:1000, cost:100, price:110`。
- **明確承認**：`card-qty` 這個 testid 只是「代號/名稱列的版面錨點」，**不含任何數量值**（`HoldingCardHeader` 註記「股數移到抽屜 §4」）。本輪**不把它當作數量不變的證據**，也不新增產品 path 去補渲染股數。
- 因此本輪 390px 精確驗收改為：
  - `card-price` `toContainText('成本 100')`、`toContainText('現價 110')`（依 `PriceTrack.tsx` 實際輸出格式）
  - `card-pnl` `toContainText('10.00%')`、`toContainText('10,000')`
  - 卡片根節點 `aria-label` `toContain('報酬率 +10.00%')`、`toContain('損益 +10,000')`（與上列同值交叉驗證）
  - 四邊界：`sb.x >= 0`、`sb.y >= 0`、`sb.x + sb.width <= 390`、`sb.y + sb.height <= 844`
  - non-overlap：`sb.y >= rb.y + rb.height - 1`
  - 既有 30+1 body 分塊斷言原樣保留
- 同時修 F1 在 E2E 面的觀測缺口：terminal control 的 `page.route` 由 `**/functions/v1/**` 擴為同時攔 `**/rest/v1/rpc/**`，並以兩個具名 counter 分別斷言 `tw-institutional-daily-sync` invoke=0、`enqueue_bsr_backfill` rpc=0。
- **證據位階**：此 E2E endpoint=0 僅為**補充證據**；F1/F2 的權威證據是 §3/§4 的 public-hook runtime test。E2E 綠但 runtime test 未綠，一律視為未通過。

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
