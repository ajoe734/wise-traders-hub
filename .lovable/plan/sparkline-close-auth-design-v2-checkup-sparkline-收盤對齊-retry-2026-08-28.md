# SPARKLINE_CLOSE_AUTH_DESIGN_V2 — checkup-sparkline 收盤對齊 + retry cooldown（只讀設計）

只處理 root cause B：`checkup-sparkline` 的「台北日鍵 + complete=true」快取盤中寫入後長效命中，收盤後 last_bar 仍是前一交易日 → Hosted 20/20 待確認。不碰 BSR/provider 方案/current_prices/週記。

V2 修訂重點：加入**全域 retry cooldown**，消除 V1 的 request-storm 缺口。

## 0. Live 證據（唯讀，已取得）

`checkup_storage` / `user_id=0000…0000` / `key like 'sparkline_v3_%_20260828'`：

| last_bar | 檔數 | fetched_at (UTC) | 判讀 |
|---|---|---|---|
| 2026-08-27 | 17 | 04:46:11–04:46:51Z（台北 12:46 盤中） | 盤中寫入、complete=true、當日鍵永久命中 → pending |
| 2026-08-28 | 1（2330） | 11:03:33Z（19:03 收盤後） | 唯一對齊者 |
| 2026-07-02 / 07-28 / 08-25 | 各 1（039108 / 702157 / 053848） | 04:46Z | 上游本身落後，屬誠實 stale |

20/20 待確認＝ 17 檔盤中快取 + 3 檔上游落後。**這 3 檔正是 V1 storm 的來源**：無論重抓幾次 last_bar 都不會前進。

## 1. 現行 cache hit predicate（exact，`supabase/functions/checkup-sparkline/index.ts`）

- L19–22 `todayKey()`：用本機（Edge = UTC）`getFullYear/Month/Date` 造日鍵，非 Asia/Taipei。
- L60：`sparkline_v3_${c}_${day}`。
- L72：`if (ohlc.length < 2) return;`
- L73：`const complete = d.complete === true || ohlc.length >= MIN_COMPLETE_BARS;`
- L75–78：`if (!complete) { age = now - Date.parse(d.fetched_at); if (!(age>=0 && age<PARTIAL_TTL_MS)) return; }`
- L88–92：`map.has(k)` → hit，否則進 `toFetch`。

為何 `complete=true ≠ 對齊 latestCompletedTradeDate`：L73 的 complete 只表達**歷史深度**（≥20 根），與**最後一根是否為最後完整交易日**正交。盤中 12:46 抓到 20 根（最後一根 08-27）即 complete=true，此後同一日鍵所有請求命中到台北隔日換鍵為止 → 收盤後 14:05–24:00 永遠拿不到當日 K。

## 2. canonical latestCompletedTradeDate（禁自寫 Mon-Fri）

Edge 端既有唯一來源：
- `_shared/twTradingCalendar.ts`：`taipeiTodayIso(nowMs)`、`isTwTradingDay`、`prevTwTradingDay`、`getTwHolidaysCached(supa)`（6h TTL，讀 `tw_market_holidays` 臨時休市）。
- `_shared/tradingDate.ts`：`expectedLatestBsrDate(nowMs, extraHolidays)` — 台北 `isAfterCloseAt`（≥14:00）→ `prevTwTradingDay(今天)`；否則 `prevTwTradingDay(昨天)`。週末/假日由 calendar roll-back 處理。

前端 authority `src/checkup/lib/marketCalendar.ts` 用 13:30 + settleDelay 35 = **14:05**。Edge 是 14:00，早 5 分鐘會在 14:00–14:05 造成無謂 miss。修法不新增共用 helper：在 index.ts 宣告 `const SETTLE_ALIGN_MS = 5 * 60_000;`，呼叫 `expectedLatestBsrDate(nowMs - SETTLE_ALIGN_MS, holidays)`，門檻精確等於台北 14:05。日鍵改用 `taipeiTodayIso(nowMs)` 取代 L19–22。

extraHolidays 由 `getTwHolidaysCached(sb)` 取得（已有 6h 記憶體 TTL，不增 DB 負擔）；載入失敗回空陣列 → 退回內建 BASE_HOLIDAYS，行為與其他 job 一致。

## 3. 修正契約（V2）

命名：`expected = expectedLatestBsrDate(nowMs - SETTLE_ALIGN_MS, holidays)`；`lastBar = ohlc.at(-1).date`；`attemptedAt = d.last_attempted_at ?? d.fetched_at`。

決策表（單一 predicate `classifyCacheEntry(entry, expected, nowMs)` → `'miss' | 'hit_fresh' | 'hit_stale_cooldown' | 'refetch'`）：

| 條件 | 結果 | provider fetch |
|---|---|---|
| `ohlc.length < 2` | `miss` | 是 |
| `!complete` 且 `now - fetched_at >= PARTIAL_TTL_MS` | `miss` | 是（原契約不變） |
| `!complete` 且在 TTL 內 且 `lastBar >= expected` | `hit_fresh` | 否（原契約不變） |
| `lastBar >= expected`（含 complete） | `hit_fresh` | 否 |
| `lastBar < expected` 且 `now - attemptedAt < PARTIAL_TTL_MS` | `hit_stale_cooldown` → **serve stale** | **否（0 fetch）** |
| `lastBar < expected` 且 cooldown 到期 | `refetch`（只該 code） | 是 |

- **盤中**：`expected` = 上一完整交易日 → 盤中寫入的 entry `lastBar >= expected` → `hit_fresh`，盤中反覆請求 0 次額外 fetch，無 storm。
- **收盤後 stale**：第一個請求觸發 refetch；**成功**才更新 factual `ohlc / closes / source / fetched_at / complete / bar_count`，並同時寫 `last_attempted_at = now`。**失敗（bars<2）**：保留舊 `ohlc / closes / source / fetched_at / complete`，**只 upsert `last_attempted_at`** 當 retry marker，response 仍帶舊 `tradeDate` → 前端 `buildConfirmedClose` 判 `stale_trade_date` → 顯示待確認。禁止把 complete 改成當日、禁止偽造 source/fetchedAt。
- **provider 成功但回舊日**（如 039108 last_bar 仍 07-02）：`last_attempted_at = now` 一樣寫入 → **也進 cooldown**，30 分鐘內不再打 provider。這是 V1 缺口的直接封堵。
- **cooldown 常數重用**：直接用既有 `PARTIAL_TTL_MS = 30 * 60 * 1000`，**不新增、不修改任何 TTL 常數**。
- **cache JSON 新欄位**：`last_attempted_at`（ISO 字串）僅存在 `checkup_storage.data` JSON 內，**internal-only**：不改 table schema、不進 response、不回前端。`fetched_at` 語意完全不變（＝最後一次「成功取得 bars」的時間），fresh/partial 判定沿用 `fetched_at`。舊 entry 無此欄位時 fallback 至 `fetched_at`（見上表 `attemptedAt` 定義），因此不需要資料遷移。

不改：response schema、cache key 前綴 `sparkline_v3_`、`PARTIAL_TTL_MS`、`MIN_COMPLETE_BARS`、batchSize、前端任何檔案、US/其他市場。

## 4. 併發穿透（第 5 點）— 現況證據與殘餘風險

唯讀盤點：
- `_shared/requestCoalescer.ts`：**存在** per-key single-flight（`inflight` Map + 30s STALE_MS），但檔頭自述「只在單一 edge function isolate 有效；跨 isolate 去重需 DB advisory lock」。
- 使用者：`tw-chips-detail/index.ts` L12、`tw-chips-detail-v2/index.ts` L15。**`checkup-sparkline` 目前未使用**。
- `_shared/coalesceDbHook.ts`：只寫 `finmind_inflight_requests` 作**觀測**（`makeInflightHook` 全部 `catch {}`），**不是** atomic guard，不能當跨 isolate 鎖。
- `checkup_storage` upsert（index.ts L133）為 `onConflict: user_id,key`，last-write-wins，**無 atomic compare-and-set**。
- 下游仍有 `_shared/circuitBreaker.ts`（`data_source_health` + `disabled_until`）與 `_shared/retryFetch.ts`，`twPriceWaterfall` L125 已接 `recordCircuit` — 對 provider 端 storm 有第二層阻尼，但**不是**去重。

採用方案（不擴 schema）：
1. **同一 request 內去重**（必做）：`toFetch` 以 `Set` 去重，且同一 code 只 fetch 一次。
2. **同一 isolate 內去重**（必做，重用既有模組）：refetch 包一層 `coalesce(\`sparkline:${code}:${expected}\`, () => fetchTwDailyOhlc(...))`，直接 import `_shared/requestCoalescer.ts`，不新增檔案。
3. **跨 isolate**：誠實標記為 **residual risk** — cooldown 到期瞬間，多個 isolate 可能各打一次 provider。上界：每 code 每 30 分鐘 × 併發 isolate 數，遠低於 V1 的「每次頁面載入」，且受 circuitBreaker 保護。**不加 DB lock、不擴 schema**。

## 5. 最小 allowlist（3 檔，逐項證明）

1. `supabase/functions/checkup-sparkline/index.ts` — 唯一 source 變更。
2. `src/test/unit/sparkline-close-authority.test.ts`（新）— predicate + cooldown 的可執行測試。
   - 為何不改既有 test：`supabase/functions/checkup-sparkline/contract_test.ts` 是打 `fnUrl` 的 Deno 網路整合測試，無法固定時間、無法斷言快取判定，改它必然 flaky；`src/test/unit/useSparklines-cache-migration.test.tsx` 測前端 localStorage 遷移，與 Edge predicate 無關。
   - 執行方式沿用專案既有 pattern（`src/test/unit/holdings-chips-chunking.test.ts` L373 / L441）：`readFileSync` 讀 edge `index.ts`、切出純函式片段、`new Function` 執行 —— 不需 Deno runtime、可在 vitest 跑。
3. `src/test/unit/sparkline-retry-cooldown.test.ts`（新，第 3 檔）— **必要性證明**：第 2 檔測的是純 predicate（`classifyCacheEntry`），第 3 檔測的是 **upsert 決策 + provider 呼叫次數**（`buildUpsertRow(entry, fetchResult, nowMs)` 與 batch 迴圈的 fetch 計數），需要 fake provider 與 fake storage 兩個 double，與純 predicate 測試的 setup 完全不同；混在同一檔會讓 `new Function` 切片與 double 交叉污染、且違反「一個測試檔一個 seam」。若 review 要求嚴格 2 檔，可將其併入第 2 檔並接受檔案膨脹至約 2 倍，但不建議。

不改 `_shared/*`、不改前端、不改 schema/cron/secret。

## 6. Executable tests（時間全部固定，禁未固定 `Date.now()`）

檔 2 —— `classifyCacheEntry(entry, expected, nowMs)` / `expectedTradeDateFor(nowMs, holidays)`：

1. 盤中命中：now = 2026-08-28T04:46Z（台北 12:46），lastBar 08-27 → expected 08-27 → `hit_fresh`。
2. 收盤後前一日 → `refetch`：now = 2026-08-28T11:03Z（19:03），lastBar 08-27，attemptedAt 04:46Z（>30 min）→ `refetch`。
3. 收盤後當日 → `hit_fresh`：同 now，lastBar 08-28。
4. settle 邊界：台北 14:04 → expected 08-27（hit）；14:05 → expected 08-28（refetch）。
5. 週末：now 2026-08-30（日）10:00 台北，lastBar 08-28 → `hit_fresh`。
6. 假日：now 2026-10-09（BASE_HOLIDAYS）15:00 台北 → expected roll-back 10-08；lastBar 10-08 → hit；10-07 → refetch。
7. 臨時休市注入：holidays 注入 2026-08-28 → 收盤後 expected = 08-27（證明走 calendar 而非 Mon-Fri）。
8. partial 舊語意回歸：complete=false + `fetched_at` 超過 30 分 → `miss`（原契約不變）。
9. 舊 entry 無 `last_attempted_at`：fallback 用 `fetched_at` 計 cooldown，不 crash。

檔 3 —— cooldown / upsert 行為（fake provider 計數 + fake storage）：

10. **失敗後 30 分內 provider count = 0**：t0 refetch 失敗（bars=0）→ 寫 `last_attempted_at=t0`；t0+29min 第二請求 → `hit_stale_cooldown`，provider 呼叫次數 **0**。
11. **30 分後恰 1**：t0+31min → 第三請求 provider 呼叫次數 **恰 1**（非 0、非 2）。
12. **provider 成功但回舊日也進 cooldown**：refetch 回 lastBar 07-02（< expected）→ `last_attempted_at` 更新；+10min 再請求 provider count 仍為 0。
13. **factual metadata 不被 failure marker 改寫**：全 provider fail 後，upsert row 的 `ohlc` / `closes` / `tradeDate` / `fetched_at` / `source` / `complete` / `bar_count` 與舊值**逐欄相等**，只有 `last_attempted_at` 改變。
14. **response 誠實**：同上情境回傳 entry 的 `tradeDate` 仍為舊日、`complete` 未被改成當日 → 前端 `buildConfirmedClose` 判 `stale_trade_date`（以真 import 驗一次）。
15. **同 request 內去重**：codes 傳入重複代號 → provider 呼叫次數 = distinct 數。
16. **同 isolate coalesce**：同 code 兩次併發 refetch → provider 呼叫 1 次（用既有 `coalesce`）。

跑：`bunx vitest run src/test/unit/sparkline-close-authority.test.ts src/test/unit/sparkline-retry-cooldown.test.ts`，再跑全量 vitest 兩次確認 0 回歸。

## 7. Deploy / rollback / Hosted gate

- 部署範圍：只 `checkup-sparkline`。部署前記錄 `index.ts` SHA256 與 HEAD 作 rollback artifact（回滾＝以 baseline 檔重新 deploy 同一函式）。
- Hosted gate（台北 ≥14:05 執行）：開 `/holding-checkup`，**不開任何抽屜**：
  - 第 1 次載入：17 檔盤中快取者觸發 refetch → 預期轉 confirmed；3 檔上游落後者仍待確認並寫入 `last_attempted_at`。
  - 第 2 次載入（30 分鐘內）：edge log `cache_lookup` 的 `toFetch` 應為 **0**，證明 cooldown 生效、無 storm。
- 誠實界線：本函式事實來源是 `twPriceWaterfall`（TWSE→TPEx→FinMind）。若 provider 全數失敗，**即使 DB 有當日 `daily_price_snapshots` / `current_prices` 也不得收斂**——那是 14:00 盤中鏡像，closeAuthority 文件明列禁止的偽收盤來源。驗收判定：**provider 可用 → 收斂至 ≤3/20 待確認（剩上游本來就落後者）；provider 失敗 → 維持待確認且第二次載入 toFetch=0，即為 PASS（fail-closed 正確）**。回報須標明實際 provider 結果與兩次載入的 `toFetch` 數字。

SPARKLINE_CLOSE_AUTH_DESIGN_V2_READY
