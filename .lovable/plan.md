# HOLDINGS_CLOSE_AUTHORITY_DESIGN_V2_READY

依 PLAN_REVIEW_1 修訂。仍為 Plan mode：未改檔、未 deploy、未 Publish、未寫 DB／cron／secret、未呼叫 provider。Stage 1 memo fix 保留，Stage 2 凍結。

## 0. 修正：exact 20 codes 與 factual 計數

採用你提供的 Hosted profile 清單（**排除 2330**）：

`3443, 3017, 6274, 2308, 039108, 3491, 702157, 053848, 2313, 8227, 1717, 3006, 00637L, 3013, 6862, 4583, 3231, 1503, 6770, 2543`

| 分類 | 檔數 | codes | 預期 source |
| --- | --- | --- | --- |
| sparkline last_bar = 2026-08-28（expected） | 16 | 3443, 3017, 6274, 2308, 3491, 2313, 8227, 1717, 3006, 3013, 6862, 4583, 3231, 1503, 6770, 2543 | confirmed close（`checkup-sparkline`），`priceTradeDate=2026-08-28`, `priceState=confirmed` |
| sparkline last_bar = 2026-08-28、無 daily snapshot | 1 | 00637L | 同上，由 close lane 解決（不需 snapshot） |
| factual lag | 3 | 039108(07-02), 053848(08-25), 702157(07-28) | **pending**；價格 fallback，`priceTradeDate` 維持 factual 舊日期 |

→ **17 aligned / 3 pending**（不是先前寫的 18+3）。3 檔雖有 `daily_price_snapshots` 2026-08-28 列，仍**不得**升格為 confirmed（理由見 §3）。

## 1. Close-authority lane（phase-aware，重用 canonical calendar）

新增純函式（放 `src/checkup/lib/marketCalendar.ts`，與 `sessionPhase`/`settleMinute` 同檔，不新增第二套時鐘）：

```
closeAuthorityLane(now, market='TW'):
  if (!holidaysLoaded(market)) return 'unknown'          // fail-closed
  const { localDate, localMinutes } = sessionPhase(now, market)
  if (!isTradingDay(localDate)) return 'settled'          // 週末 + tw_market_holidays 休市日
  if (localMinutes < RULES.openMin)            return 'settled'   // 平日盤前
  if (localMinutes <= RULES.closeMin)          return 'intraday'  // 09:00–13:30
  if (localMinutes <  settleMinute(market))    return 'settling'  // 13:30–14:05
  return 'settled'                                                // 14:05 後
```

- `intraday` / `settling`：**維持 current/realtime**，不打 `checkup-sparkline`、不查 snapshot；`priceTradeDate=null`、`priceState='pending'` 是刻意語意。
- `settled`：優先 canonical `latestCompletedTradeDate(now)` 的 confirmed close / snapshot。
- `unknown`（`tw_market_holidays` 未載入或載入失敗）：**fail-closed** — 不進 close lane、不打 Edge、一律 current + pending，且 §4 predicate 回 false（不能判定 expected 就不許 storm）。`loadMarketHolidays()` 既有「同一台北日只打一次」快取沿用，不新增輪詢。

不使用 Mon-Fri 猜測：週末與休市日一律由 `isTradingDay`（吃注入的 `tw_market_holidays`）判定。

## 2. `authoritativeQuotes.ts` merge contract（exact）

現況 merge（`authoritativeQuotes.ts:54/75/100`）：`hasSettledSnapshot` → confirmed close → 只補 `!out[s]` 的 snapshot → 再只補 `!out[s]` 的 current。改為：

```
TW:
  lane = closeAuthorityLane(now)
  if lane === 'settled':
      expected = latestCompletedTradeDate(now, {market:'TW'})
      1) cards = fetchConfirmedCloses(list, now)       // 唯一一次 Edge call
         → state==='confirmed' → { price: cc.close, tradeDate: cc.tradeDate, state:'confirmed', source:'close' }
      2) daily_price_snapshots .eq('trade_date', expected) 只補 unresolved
         → { price, tradeDate: expected, state:'confirmed', source:'snapshot' }   // 見 §3 適用範圍
      3) current_prices 只補 unresolved
         → { price, tradeDate: null, state:'pending', source:'current' }
  else (intraday / settling / unknown):
      current_prices only → { tradeDate: null, state:'pending', source:'current' }   // 0 Edge call
非 TW（US / US_OPTION / CRYPTO）：行為完全不變，沿用 marketPhase.hasSettledSnapshot 既有路徑。
```

型別擴充（唯一 shape 變更）：`AuthoritativeQuote` 增 `tradeDate: string | null` 與 `state: 'confirmed' | 'pending'`。`FreeCheckup.jsx:1515-1518` 改為直接讀 `q.tradeDate` / `q.state`，不再用 `source==='snapshot'` 反推（那正是把 snapshot 誤當收盤身分的來源）。`:1537-1538` 改為 `priceState: q.state`，並保留與 `latestCompletedTradeDate()` 的一致性斷言（不一致 → pending）。

## 3. 單一 authority 規則（解決「Edge 說 stale 但 snapshot 有 08-28」）

**規則：TW 的收盤身分（confirmed）只由官方日 K（`checkup-sparkline` → `buildConfirmedClose`）授予；`daily_price_snapshots` 不得授予收盤身分。**

既有 product contract 證據：
- `src/checkup/lib/closeAuthority.ts:5-12` 明文：「`daily_price_snapshots` 是每日 14:00 從 `current_prices` 複寫的鏡像，冷門股（例 6274 連三日都寫 1620）會把上一次成功的盤中 quote 偽裝成當日收盤，且欄位缺 OHLC。官方日 K 才是收盤事實。」
- `src/checkup/lib/confirmedClose.ts:96-101 isCompleteBar()`：confirmed 需要 OHLCV 齊全且 volume>0，snapshot 表無此欄位，結構上無法滿足。
- 本輪 live 佐證：`039108` snapshot close 52.5 = `current_prices` 52.5（updated_at 2026-06-09），正是上述「舊 quote 被鏡像成收盤」情境。

因此：
- **confirmed close 絕對優先**；`00637L` 由 close lane 解決（無 snapshot 也沒關係）。
- **lagging 3 檔（039108/053848/702157）不得被 08-28 snapshot 覆蓋成 confirmed**。它們走 §2 步驟 3：`state='pending'`、`tradeDate` 保留 sparkline 的 factual 日期（由 `fetchDailyCloseCards` 的 pending card 提供，不是 null），`priceReason='stale_trade_date'`。
- §2 步驟 2 的 snapshot 只服務「**close lane 完全沒回應該 code**」（Edge 失敗／逾時／該 code 不在回應中）的情況，且此時 `state` 標 **pending**、`tradeDate=expected` 僅作 price fallback 顯示，不宣稱 confirmed。→ 實務上 20 檔都不會走到，contract 上不留矛盾。

## 4. `needsCloseAuthorityRefresh` 也 phase-aware

```
needsCloseAuthorityRefresh(holdings, now):
  if (closeAuthorityLane(now) !== 'settled') return false     // 盤中/settling/unknown 的 pending 是刻意
  const expected = latestCompletedTradeDate(now, {market:'TW'})
  return holdings.some(h => h.priceState !== 'confirmed'
                         || String(h.priceTradeDate||'').slice(0,10) !== expected)
```

併入 `FreeCheckup.jsx:1587`：`const due = stale || needsCloseAuthorityRefresh(holdings)`。**`refreshing` guard、60 秒 `lastRunAt`、`refreshPrices` 內 30 秒 lastUpdate 冷卻全部保留**。收斂後（17 confirmed、3 檔 factual pending）predicate 仍會為 true → 因此 60s `lastRunAt` 之外**再加一道 per-expected-date one-shot**：`authorityAttemptRef.current[expected]` 已嘗試過就不再觸發，直到跨到新的 expected 交易日。這是防 storm 的關鍵，測試要覆蓋。

## 5. Exact minimal allowlist（5 檔）

| 檔案 | 變更 |
| --- | --- |
| `src/checkup/lib/marketCalendar.ts` | 新增純函式 `closeAuthorityLane(now, market)`（§1）。不改既有 export 行為。 |
| `src/checkup/lib/authoritativeQuotes.ts` | TW 改走 lane + `latestCompletedTradeDate` 的 snapshot 查詢；`AuthoritativeQuote` 加 `tradeDate`/`state`；非 TW 不變。 |
| `src/checkup/lib/closeAlignment.ts` | 新增 `needsCloseAuthorityRefresh(holdings, now)`（§4 前半，phase-aware）。 |
| `src/pages/FreeCheckup.jsx` | 只改 `:1510-1521` merge 讀 `q.tradeDate/q.state`、`:1537-1538`、`:1587-1591` 併入 predicate + per-expected one-shot ref。其餘 guard 一字不動。 |
| `src/test/unit/authoritative-quotes.test.ts`（擴充）+ `src/test/unit/close-authority-lane.test.ts`（新增） | §6 測試。 |

不動 `marketClock.ts`（`useAuthoritativePrices` 仍消費 `hasSettledSnapshot`）、不動 `useSparklines.ts`、`holdingsSort.ts`、Edge、DB、cron。

## 6. Fixed-time red→green tests（全部 assert invocation count）

mock `getCheckupGateway().invoke` 與 supabase `from()`，每案同時斷言 **source / state / tradeDate** 與 **`checkup-sparkline` invoke 次數**：

| # | 固定時間（Asia/Taipei） | 預期 |
| --- | --- | --- |
| 1 | Fri 2026-08-28 10:00 | current wins、`state=pending`、`tradeDate=null`、**sparkline invoke = 0**、snapshot query = 0 |
| 2 | Fri 2026-08-28 13:40（settling） | 同上，**invoke = 0**，不得宣稱當日收盤 |
| 3 | Fri 2026-08-28 14:06 | confirmed wins、`tradeDate=2026-08-28`、invoke = 1 |
| 4 | Sat 2026-08-29 00:05 | expected = 2026-08-28、invoke = 1 |
| 5 | 平日盤前 Fri 2026-08-28 02:00 | expected = 2026-08-27（前一交易日），不得誤判 08-28 |
| 6 | 休市日（注入 `tw_market_holidays` 含當日） | 使用前一交易日 close、invoke = 1 |
| 7 | calendar unavailable（`holidaysLoaded=false`） | 全部 current/pending、**invoke = 0**、不偽稱 confirmed |
| 8 | predicate | lane≠settled → false；settled + 任一 pending/date mismatch → true；同一 expected 第二次呼叫（one-shot ref 已標記）→ 不再觸發 refresh |
| 9 | exact 20 codes fixture（用本輪 live 值：16+00637L 對齊 08-28、039108/053848/702157 factual lag） | `summarizeCloseAlignment` → **confirmed 17 / pending 3**、`otherDates = ['2026-07-02','2026-07-28','2026-08-25']`、`aligned=false`；且 3 檔即使 snapshot 有 08-28 也不得變 confirmed |
| 10 | 回歸 | `authoritative-quotes.test.ts` 既有 4 案、`holdings-close-memo.test.tsx`、`holdings-sort.test.ts`、完整 suite 全綠 |

## 7. No-Publish Hosted gate

1. **收盤時段**：舊 profile、不開抽屜、不按「立即更新持倉報價」，reload 一次並靜置至多一個 auto interval → banner 自動收斂為 **17/20 aligned、3 待確認**（若屆時上游資料改變，以當下 factual 為準，不得湊全綠）。
2. 第二次 reload：無 console error；`checkup-sparkline` invoke 次數與第一次同量級（one-shot + 60s guard 生效）。
3. **盤中回歸**（下一個交易日 09:00–13:30 任一時點）：價格語意不變（來源仍為即時/db、banner 顯示 pending），且該時段 **0 次** `checkup-sparkline` invoke。
4. 390×844 檢查 hero 與卡片無溢出。

Stage 1 memo fix 保留不回滾；Stage 2（`useSparklines` same-mount 14:05 邊界）維持凍結。

停住等 review。
