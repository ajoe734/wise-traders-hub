# SPARKLINE_CLOSE_AUTH_DESIGN — checkup-sparkline 收盤對齊修正（只讀設計）

只處理 root cause B：`checkup-sparkline` 的「台北日鍵 + complete=true」快取在盤中寫入後，收盤後仍長效命中，last_bar 停在前一交易日 → Hosted 顯示 20/20 待確認。不碰 BSR/provider/current_prices/週記。

## 0. Live 證據（唯讀查詢，已取得）

`checkup_storage` / `user_id=0000...0000` / `key like 'sparkline_v3_%_20260828'`：

| last_bar | 檔數 | fetched_at (UTC) | 判讀 |
|---|---|---|---|
| 2026-08-27 | 17 | 04:46:11Z–04:46:51Z（台北 12:46，盤中） | 盤中寫入、complete=true、當日鍵永久命中 → 全部 pending |
| 2026-08-28 | 1（2330） | 11:03:33Z（台北 19:03，收盤後） | 唯一對齊者 |
| 2026-07-02 / 07-28 / 08-25 | 各 1 | 04:46Z | 上游本來就落後，屬誠實 stale，非本案 |

即「20/20 待確認」＝ 17 檔盤中快取 + 3 檔上游落後，與設計推論完全一致。

## 1. 現行 cache hit predicate（exact）

`supabase/functions/checkup-sparkline/index.ts`

- L19–22 `todayKey()`：用 **本機 `new Date()` 的 getFullYear/Month/Date** 產生日鍵（Edge 為 UTC，不是 Asia/Taipei，已是第二個隱性缺陷）。
- L60 cacheKey：`sparkline_v3_${c}_${day}`。
- L72 `if (ohlc.length < 2) return;`
- L73 `const complete = d.complete === true || ohlc.length >= MIN_COMPLETE_BARS;`
- L75–78：`if (!complete) { age < PARTIAL_TTL_MS 才留 }` → **complete=true 完全不檢查時間、也不檢查 last_bar**。
- L88–92：`map.has(k)` 即命中，否則 push 到 `toFetch`。

為何 `complete=true ≠ 對齊 latestCompletedTradeDate`：L73 的 complete 只表示「根數 ≥ 20（歷史夠長）」，是**歷史深度**語意，與**最後一根是不是最後完整交易日**完全正交。盤中 12:46 抓到 20 根（最後一根 08-27）即滿足 complete，之後同一天所有請求都命中，直到台北隔日 00:00（實際是 UTC 隔日 08:00 台北）才換鍵 → 收盤後 14:05–24:00 這段永遠拿不到當日 K。

## 2. canonical latestCompletedTradeDate（禁止自寫 Mon-Fri）

Edge 端既有唯一來源：
- `_shared/twTradingCalendar.ts`：`isTwTradingDay` / `prevTwTradingDay` / `taipeiTodayIso` / `getTwHolidaysCached(supa)`（6h TTL，從 `tw_market_holidays` 取臨時休市）。
- `_shared/tradingDate.ts`：`expectedLatestBsrDate(nowMs, extraHolidays)` = 台北 now；`isAfterCloseAt`（台北 ≥14:00）成立 → `prevTwTradingDay(今天)`；否則 → `prevTwTradingDay(昨天)`。週末/假日由 calendar roll-back 處理。

前端 `src/checkup/lib/marketCalendar.ts` 的 `latestCompletedTradeDate` 用 13:30 + 35 分 settle = **14:05**。Edge 門檻是 14:00，差 5 分鐘：若 Edge 比前端早 5 分鐘期待當日 K，14:00–14:05 之間會逐請求 miss → refetch。修法不新增 helper、不改共用檔：Edge 呼叫時傳 `nowMs - SETTLE_DELAY_MS`（`SETTLE_DELAY_MS = 5*60_000`，宣告在 index.ts），使 Edge 門檻精確等於台北 14:05，與前端 authority 對齊。

日鍵同時改用 `taipeiTodayIso(nowMs)`（取代 L19–22 的 UTC 自製字串），與 canonical 時區一致。

## 3. 最小 allowlist（2 檔）

1. `supabase/functions/checkup-sparkline/index.ts`（唯一 source 變更）
2. `src/test/unit/sparkline-close-authority.test.ts`（新測試檔）

為何第 2 檔必須是新檔而非「既有 test」：
- `supabase/functions/checkup-sparkline/contract_test.ts` 是 Deno 網路整合測試（打 `fnUrl`），CI 內無法固定時間、無法斷言快取判定，改它會產生 flaky。
- `src/test/unit/useSparklines-cache-migration.test.tsx` 測前端 localStorage 遷移，與 Edge predicate 無關。
- 專案既有可執行 pattern（`src/test/unit/holdings-chips-chunking.test.ts` L373/L441）：`readFileSync` 讀 edge `index.ts` 切出純函式片段，用 `new Function` 執行。新測試沿用同一 pattern，零 runtime 依賴、可在 vitest 執行。

不改前端、不改 `_shared/*`、不改 schema/TTL/response。

## 4. 修正契約

- **hit predicate**：`hasBars(>=2)` ∧ 原 partial TTL 規則 ∧ `lastBar.date >= expectedTradeDate`（ISO 字典序＝時間序）。三者缺一即 miss。
- **盤中**：`expectedTradeDate` = 上一完整交易日 → 盤中寫入的快取仍然命中，**不造成重抓 storm**（盤中反覆請求 0 次額外 fetch）。
- **收盤後（≥14:05 台北）**：`expectedTradeDate` = 當日；last_bar 為前一交易日 → 該 code 判 miss，只把該 code 放進 `toFetch` 重抓，**不 delete、不清其他 code、不動 schema**。重抓成功即 upsert 覆蓋同一 key。
- **fail-closed**：refetch 失敗（`ohlc.length < 2`）維持現行行為——不 upsert、不回退寫入舊資料；回傳 entry 仍帶真實 `tradeDate`（可能是舊日）與 `complete/source/fetchedAt`，讓前端 `buildConfirmedClose` 判 `stale_trade_date` → 顯示待確認。**絕不把舊 bar 標成當日 confirmed**。
- **上游本來就落後**（如 039108 last_bar 07-02）：每次收盤後會嘗試一次重抓，抓回仍舊 → 誠實 pending，不假裝。額外抓取上限受 codes ≤30 與既有 batchSize 6 保護。
- **不改**：response schema、cache key 前綴（`sparkline_v3_`）、PARTIAL_TTL_MS、MIN_COMPLETE_BARS、US/其他市場。

## 5. Executable tests（全部固定時間，禁 `Date.now()` 浮動）

新測試以 `new Function` 取出 index.ts 中抽出的純函式 `isCacheFresh(entry, expectedTradeDate, nowMs)` 與 `expectedTradeDateFor(nowMs, holidays)`，固定 `nowMs`：

1. **盤中命中**：now = 2026-08-28T04:46Z（台北 12:46），cached last_bar 2026-08-27 → expected = 08-27 → **hit**（0 refetch）。
2. **收盤後前一日 → miss**：now = 2026-08-28T11:03Z（19:03），last_bar 2026-08-27 → expected 08-28 → **miss**。
3. **收盤後當日 → hit**：同 now，last_bar 2026-08-28 → **hit**。
4. **settle 邊界**：now = 台北 14:04 → expected 仍 08-27（hit）；14:05 → expected 08-28（miss）。
5. **週末**：now = 2026-08-30（日）10:00 台北，last_bar 08-28 → expected 08-28 → hit。
6. **假日**：now = 2026-10-09（內建 BASE_HOLIDAYS）15:00 台北 → expected roll-back 至 10-08，last_bar 10-08 → hit；last_bar 10-07 → miss。
7. **臨時休市注入**：holidays 注入 2026-08-28 → 收盤後 expected = 08-27，盤中快取仍 hit（證明用 calendar 而非 Mon-Fri）。
8. **fail-closed**：模擬 fetch 回 0 bars → 不 upsert、entry.tradeDate 維持舊日、complete 不被偽造成當日。
9. **partial 舊行為回歸**：complete=false + fetched_at 超過 30 分 → 仍 miss（原契約不變）。

跑：`bunx vitest run src/test/unit/sparkline-close-authority.test.ts`，再跑全量 vitest 兩次確認 0 回歸。

## 6. Deploy / rollback / Hosted gate

- Deploy 範圍：只 `checkup-sparkline` 單一函式；部署前記錄 `index.ts` SHA256 與 HEAD，作為 rollback artifact（回滾＝以 baseline 檔重新 deploy 同一函式）。
- Hosted gate（收盤後執行，台北 ≥14:05）：開 `/holding-checkup`，**不開任何抽屜**，觀察 closeAuthority 由 20/20 待確認收斂；預期 17 檔（盤中快取者）於首次請求 refetch 後轉 confirmed。
- 誠實界線：`checkup-sparkline` 的事實來源是 `twPriceWaterfall`（TWSE→TPEx→FinMind）。若 provider 全數失敗，**即使 DB 有當日 `daily_price_snapshots`/`current_prices` 快照也不得收斂**——那是 14:00 盤中鏡像，正是 closeAuthority 文件明列禁止的偽收盤來源。該情況正確結果是維持「待確認」，並在 log 記 `sparkline_all_sources_failed`。因此驗收判定為：**provider 可用 → 應收斂至 ≤3/20 待確認（剩上游本來就落後者）；provider 失敗 → 仍待確認即為 PASS（fail-closed 正確）**，兩者都不算紅燈，需在回報中標明實際 provider 結果。

SPARKLINE_CLOSE_AUTH_DESIGN_READY
