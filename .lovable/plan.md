# HOLDINGS_CLOSE_AUTHORITY_DESIGN_V3_READY

依 PLAN_REVIEW_2 修訂三個阻塞點。仍為 Plan mode：未改檔、未 deploy、未 Publish、未寫 DB／cron／secret、未呼叫 provider。Stage 1 memo fix 保留，Stage 2 凍結。

## 0. Exact 20 codes（fixture 值固定，不依賴 live DB）

`3443, 3017, 6274, 2308, 039108, 3491, 702157, 053848, 2313, 8227, 1717, 3006, 00637L, 3013, 6862, 4583, 3231, 1503, 6770, 2543`（已排除 2330）

- 17 檔 sparkline last_bar = `2026-08-28`（含 `00637L`，該檔無 daily snapshot）→ confirmed。
- 3 檔 factual lag：`039108`=2026-07-02、`053848`=2026-08-25、`702157`=2026-07-28 → pending（即使 `daily_price_snapshots` 有 08-28 列）。

→ **17 aligned / 3 pending**。這些數值在 unit test 內寫成**固定 fixture 常數**，測試 runtime **不連 live DB**；live 只在 Hosted gate 讀。

## 1. Close-authority lane（phase-aware，重用 canonical calendar）

新增純函式於 `src/checkup/lib/marketCalendar.ts`（與 `sessionPhase`/`settleMinute` 同檔，不新增第二套時鐘）：

```
closeAuthorityLane(now, market='TW'):
  if (!holidaysLoaded(market)) return 'unknown'                 // fail-closed
  const { localDate, localMinutes } = sessionPhase(now, market)
  if (!isTradingDay(localDate)) return 'settled'                // 週末 + tw_market_holidays 休市日
  if (localMinutes < openMin)              return 'settled'     // 平日盤前
  if (localMinutes <= closeMin)            return 'intraday'    // 09:00–13:30
  if (localMinutes <  settleMinute(market))return 'settling'    // 13:30–14:05
  return 'settled'                                              // 14:05 後
```

`intraday`/`settling`/`unknown` → 維持 current/realtime、`priceState='pending'`、**0 次 Edge call**（刻意語意）。只有 `settled` 才進 authority lane。

## 2. Calendar loader 接上 production（REVIEW_2 §2）

已證現況：`loadMarketHolidays()` 的唯一生產呼叫點是 `closeAuthority.ts:36`，發生在 `fetchDailyCloseCards` **內部**（比 lane 判定晚）；`useConfirmedCloses.ts` 無任何 importer（dead code）。因此若 lane 先跑，`holidaysLoaded=false` → 永遠 `unknown`，修復會再次無效。

**指定 production async path**：`fetchAuthoritativeQuotes()` 在函式開頭、分市場之前，**每個 request 恰一次** `await loadMarketHolidays().catch(() => false)`，成功後才計算 lane。

- loader 本身已有 daily cache（`loadedForDate`）+ `inflight` dedupe，同一台北日第二次呼叫**不會**再打 `tw_market_holidays`。
- 不 per-code 載入、不新增 polling、不新增 interval。
- loader 失敗 → `holidaysLoaded=false` → lane `unknown` → 全部 current/pending/**0 Edge**。
- `fetchAuthoritativeQuote()`（單檔版）走同一函式，自然共用。

Tests：成功載入後 Sat 00:05 走 settled；loader 失敗 → 0 Edge、無 confirmed；同一台北日連續兩次 `fetchAuthoritativeQuotes` → `tw_market_holidays` DB query 恰 1 次。

## 3. 單一 authority 規則 + exact merge（REVIEW_2 §1，消除自相矛盾）

**confirmed 只由 `fetchDailyCloseCards` 的 card `state==='confirmed'` 授予。`daily_price_snapshots` 與 `current_prices` 永遠只能 pending。**

Contract 證據：`closeAuthority.ts:5-12`（snapshot 是 14:00 從 current_prices 複寫的鏡像，冷門股會把舊 quote 偽裝成收盤、且缺 OHLC）、`confirmedClose.ts:96-101 isCompleteBar()`（confirmed 需 OHLCV 齊全且 volume>0，snapshot 表結構上做不到）。live 佐證：`039108` snapshot close 52.5 == `current_prices` 52.5（updated_at 2026-06-09）。

`AuthoritativeQuote` shape（唯一 shape 變更）：

```ts
interface AuthoritativeQuote {
  price: number; yesterday: number|null; change: number; changePct: number;
  updatedAt: string|null;
  source: 'close' | 'snapshot' | 'current';   // 事實來源，不冒充
  state: 'confirmed' | 'pending';             // 只有 source==='close' 可能是 confirmed
  tradeDate: string | null;                   // confirmed=expected；pending=Edge 的 factual 日期或 null
  reason: string | null;                      // pending 原因（Edge card.reason 優先）
}
```

TW merge（`settled` lane），三步、**Edge 只呼叫一次**：

```
expected = latestCompletedTradeDate(now, {market:'TW'})
cards = await fetchDailyCloseCards(list, now)          // 1 次 gateway attempt

// step 1：confirmed
for code where cards[code].state==='confirmed' && close>0:
    { price: cc.close, yesterday: cc.prevClose, source:'close',
      state:'confirmed', tradeDate: cc.tradeDate, reason: null, updatedAt: cc.fetchedAt ?? cc.tradeDate }

// step 1b：保留 Edge pending 的 factual metadata（不含 price）
pendingMeta[code] = { tradeDate: cards[code].tradeDate ?? null,      // 例 039108 → '2026-07-02'
                      reason:    cards[code].reason ?? null }        // 例 'stale_trade_date'

// step 2：unresolved → daily_price_snapshots .eq('trade_date', expected)  只補 price
    { price: row.close_price, source:'snapshot', state:'pending',
      tradeDate: pendingMeta[code]?.tradeDate ?? null,               // 絕不寫 expected
      reason:    pendingMeta[code]?.reason ?? 'unconfirmed_close',
      updatedAt: row.trade_date }

// step 3：仍 unresolved → current_prices  只補 price
    { price: row.price, source:'current', state:'pending',
      tradeDate: pendingMeta[code]?.tradeDate ?? null,               // 不因補價而丟掉 factual 日期
      reason:    pendingMeta[code]?.reason ?? 'no_confirmed_close',
      updatedAt: row.updated_at }
```

- pending 的 `tradeDate` 一律取自 Edge factual metadata；沒有 metadata 才 `null`。**永不**用 `expected` 填 pending 的 tradeDate。
- 非 TW（US / US_OPTION / CRYPTO）行為完全不變，沿用 `marketPhase.hasSettledSnapshot` 既有路徑（`state` 依原語意標記，snapshot 亦不宣稱 TW 式 confirmed）。

FreeCheckup mapping（`:1510-1521`、`:1537-1538`）：

```
priceSource : q.source==='close' ? 'close' : (q.source==='snapshot' ? 'snapshot_pending' : 'db')
priceState  : q.state
priceTradeDate: q.tradeDate
priceReason : q.reason
```

即 **pending snapshot/current 不得映射成 `'close'`**；`HoldingCardFooter`/`HoldingsHero` 既有 label map 對 `snapshot_pending` 補「待確認（鏡像價）」文案，UI 不顯示已確認。`summarizeCloseAlignment` 邏輯不變（`priceState!=='pending' && tradeDate===expected` 才算 confirmed），因此 3 檔 lag 必然 pending。

## 4. Auto refresh predicate（phase-aware）

```
needsCloseAuthorityRefresh(holdings, now):
  if (closeAuthorityLane(now) !== 'settled') return false
  expected = latestCompletedTradeDate(now, {market:'TW'})
  return holdings.some(h => h.priceState !== 'confirmed'
                         || String(h.priceTradeDate||'').slice(0,10) !== expected)
```

併入 `FreeCheckup.jsx:1587`：`const due = stale || needsCloseAuthorityRefresh(holdings)`。`refreshing` guard、60 秒 `lastRunAt`、`refreshPrices` 內 30 秒 lastUpdate 冷卻**全部保留**。

## 5. One-shot 與 30 秒 cooldown 的 exact state machine（REVIEW_2 §3）

**不用猜：由 `refreshPrices()` 回傳 typed outcome，one-shot 只在收到「確實嘗試過 authority」的 outcome 後才標記。**

```ts
type RefreshOutcome =
  | { kind:'skipped', why:'refreshing'|'cooldown'|'no-holdings'|'demo' }
  | { kind:'attempted', lane:'settled', expected:string }   // 已進入 settled lane 且完成一次 gateway attempt（confirmed 或 factual pending 皆算）
  | { kind:'attempted', lane:'intraday'|'settling'|'unknown' }
  | { kind:'failed', transport:true }                       // gateway throw / 整批 transport failure
```

`refreshPrices` 現有 early return 一律回 `{kind:'skipped', why}`（`:1428 refreshing`、`:1486 cooldown`、`:1494 no-holdings`）。authority attempt 的判定由 `fetchAuthoritativeQuotes` 回傳 meta（`lane` + `attempted:boolean` + `transportError:boolean`）向上帶出。

auto effect ordering（`:1578-1595`）：

```
1. 既有 guards：tab/holdings/refreshing/minutes<=0
2. due = stale || needsCloseAuthorityRefresh(holdings)
3. expected = latestCompletedTradeDate()
4. if (authorityAttemptRef.current.date === expected && !dueByStale) return   // one-shot 只擋 authority 觸發，不擋 stale 週期刷新
5. if (Date.now() - lastRunAt < 60_000) return                                // 既有 60s guard 不變
6. lastRunAt = Date.now()
7. timer = setTimeout(async () => {
     const out = await refreshPrices()
     if (out.kind === 'attempted' && out.lane === 'settled')
         authorityAttemptRef.current = { date: out.expected }                 // 只有這裡才標 one-shot
     // skipped / failed / 非 settled lane：不標，等 60s guard 後可再試
   }, 300)
8. cleanup：clearTimeout(timer)；並以 disposedRef 阻止 unmount 後寫 ref/state
```

- **cooldown / refreshing / disabled / no holdings 的 skipped attempt 絕不標 one-shot。**
- gateway throw / transport failure → `{kind:'failed'}`，不標 one-shot；retry 由既有 60 秒 `lastRunAt` guard 節流（每 render 不會重跑，因為 effect deps 仍是 `[tab, holdings]` 且 60s guard 在前）。
- 跨到新的 expected 交易日 → `authorityAttemptRef.date !== expected` → 允許再 1 次。
- 週期性刷新 effect（`:1598-1630`）不改，仍沿用 `lastRunAt` 寫入。

## 6. Exact minimal allowlist（6 檔）

| 檔案 | 變更 |
| --- | --- |
| `src/checkup/lib/marketCalendar.ts` | 新增 `closeAuthorityLane(now, market)`。 |
| `src/checkup/lib/authoritativeQuotes.ts` | request 級 `await loadMarketHolidays()`；TW lane 化；§3 三步 merge + pendingMeta；shape 加 `state/tradeDate/reason`；回傳 meta（lane/attempted/transportError）；非 TW 不變。 |
| `src/checkup/lib/closeAlignment.ts` | 新增 `needsCloseAuthorityRefresh(holdings, now)`。 |
| `src/pages/FreeCheckup.jsx` | `:1508-1521` 讀新 shape；`:1536-1538` 映射（含 `snapshot_pending`）；`refreshPrices` 回 typed outcome；`:1578-1595` state machine + one-shot ref + cleanup。 |
| `src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardFooter.tsx` + `HoldingsHero.tsx` | 只加 `snapshot_pending` 的 label 文案，不改統計邏輯。 |
| `src/test/unit/authoritative-quotes.test.ts`（擴充）、`src/test/unit/close-authority-lane.test.ts`（新增） | §7 測試。 |

不動 `marketClock.ts`、`useSparklines.ts`、`holdingsSort.ts`、`closeAuthority.ts`、Edge、DB、cron。

## 7. Fixed-time red→green tests（全部 assert invocation count；不連 live DB）

| # | 固定時間（Asia/Taipei）／情境 | 預期 |
| --- | --- | --- |
| 1 | Fri 08-28 10:00 | current wins、pending、`tradeDate=null`、**sparkline invoke=0**、snapshot query=0 |
| 2 | Fri 08-28 13:40 settling | 同上、invoke=0 |
| 3 | Fri 08-28 14:06 | confirmed、`tradeDate=2026-08-28`、invoke=1 |
| 4 | Sat 08-29 00:05 | expected=2026-08-28、invoke=1 |
| 5 | 平日盤前 Fri 08-28 02:00 | expected=2026-08-27 |
| 6 | 休市日（fixture 注入 `tw_market_holidays`） | 用前一交易日、invoke=1 |
| 7 | loader 失敗 / calendar unavailable | lane=unknown、全 current/pending、invoke=0、無 confirmed |
| 8 | 同一台北日連兩次 `fetchAuthoritativeQuotes` | `tw_market_holidays` query 恰 1 次 |
| 9 | Edge pending + snapshot 有 expected 列 | `state='pending'`、`source='snapshot'`、`tradeDate` = Edge factual 日期（非 expected）、`priceSource≠'close'` |
| 10 | Edge pending + 只有 current_prices | pending、`tradeDate` 仍保留 Edge factual 日期、reason 保留 |
| 11 | predicate | lane≠settled → false；settled+mismatch → true |
| 12 | one-shot race：`lastUpdate=now-10s` + pending | 首次被 cooldown skip → **不標** one-shot、invoke=0；冷卻過後恰 **1** 次 authority invoke；同 expected 之後 0；跨 expected 再 1 |
| 13 | transport failure | 不標 one-shot、60s 後可 retry、不每 render 重打 |
| 14 | exact 20 codes fixture（固定常數） | confirmed 17 / pending 3、`otherDates=['2026-07-02','2026-07-28','2026-08-25']`、`aligned=false`；3 檔即使 snapshot 有 08-28 也不得 confirmed |
| 15 | 回歸 | `authoritative-quotes.test.ts` 既有 4 案、`holdings-close-memo.test.tsx`、`holdings-sort.test.ts`、完整 suite 全綠 |

## 8. No-Publish Hosted gate

1. **收盤時段**：舊 profile、不開抽屜、不按手動更新，reload 一次靜置至多一個 auto interval → banner 自動收斂為 **17/20 aligned、3 待確認**（上游若變動則以當下 factual 為準，不湊全綠）。
2. 第二次 reload：無 console error；`checkup-sparkline` invoke 與第一次同量級（one-shot + 60s guard 生效）。
3. **盤中回歸**（下一交易日 09:00–13:30）：價格語意不變（即時/db + pending），該時段 **0 次** `checkup-sparkline` invoke。
4. 390×844 檢查 hero 與卡片無溢出。

Stage 1 memo fix 不回滾；Stage 2 維持凍結。停住等 review。
