# HOLDINGS_CLOSE_AUTHORITY_RUNTIME_ROOT_READY

只讀稽核完成。未改任何檔、未 deploy、未 Publish、未寫 DB／cron／secret，未呼叫 provider。Stage 1 memo fix 保留（下方證據顯示它必要且無 regression）。

## A. Hosted profile 實際走哪個 branch

- `useCheckupMode().isDemo` 只控制 Demo 模式；畫面「DEMO 1」是 `HoldingsHero.tsx:56` 依 `h.priceSource` 統計的來源分佈，**與 isDemo 無關**。
- `FreeCheckup.jsx:1434 if (isDemo)` → 走 `fetchDailyCloseCards`（收盤權威）。本 profile 有 19 筆 db 來源＋雲端持倉，`isDemo=false`。
- 因此 **reload auto refresh（`FreeCheckup.jsx:1578-1595` → 1592 `refreshPrices()`）與手動「立即更新持倉報價」走的是同一條 `refreshPrices()` 非 Demo 分支：`FreeCheckup.jsx:1508 fetchAuthoritativeQuotes(codes)`**。`fetchDailyCloseCards` 在此 profile **從未被呼叫**。

## B. 這 21 個 code 的 live 交叉表（不是全表總數）

代號來源：`checkup_storage` 今日 key `sparkline_v3_<code>_20260829`（server 端全域市場快取）。

| code | sparkline last_bar | daily_price_snapshots 2026-08-28 | close | snapshot created_at | current_prices updated_at |
| --- | --- | --- | --- | --- | --- |
| 00637L | 2026-08-28 | 無列 | — | — | 無列 |
| 039108 | 2026-07-02 | 有 | 52.5 | 08-28 06:00Z | 2026-06-09 |
| 053848 | 2026-08-25 | 有 | 3.1 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 1503 | 2026-08-28 | 有 | 233 | 08-28 06:00Z | 2026-06-09 |
| 1717 | 2026-08-28 | 有 | 77.7 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 2308 | 2026-08-28 | 有 | 1830 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 2313 | 2026-08-28 | 有 | 241 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 2330 | 2026-08-28 | 有 | 2420 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 2543 | 2026-08-28 | 有 | 38.3 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 3006 | 2026-08-28 | 有 | 214.5 | 08-28 06:00Z | 2026-06-09 |
| 3013 | 2026-08-28 | 有 | 117.5 | 08-28 06:00Z | 2026-06-09 |
| 3017 | 2026-08-28 | 有 | 3360 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 3231 | 2026-08-28 | 有 | 178 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 3443 | 2026-08-28 | 有 | 6015 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 3491 | 2026-08-28 | 有 | 1510 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 4583 | 2026-08-28 | 有 | 467 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 6274 | 2026-08-28 | 有 | 1620 | 08-28 06:00Z | 2026-06-09 |
| 6770 | 2026-08-28 | 有 | 70 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 6862 | 2026-08-28 | 有 | 143.5 | 08-28 06:00Z | 2026-08-28 06:05Z |
| 702157 | 2026-07-28 | 有 | 8 | 08-28 06:00Z | 2026-06-09 |
| 8227 | 2026-08-28 | 有 | 193 | 08-28 06:00Z | 2026-06-09 |

`fetchConfirmedCloses` 最終 state（以上表 last_bar + `confirmedClose.ts:130-140` 規則推導，未實際 invoke provider）：18 檔 `confirmed / 2026-08-28`；`039108`、`053848`、`702157` 為 `pending / stale_trade_date`；`00637L` 無 snapshot／無 current_prices，UNKNOWN（sparkline 已對齊 08-28，可望 confirmed）。

**結論：伺服器側資料是夠的。畫面 20/20 pending 純屬 client 取數路徑問題。**

## C. `authoritativeQuotes.ts` 逐行判定（exact last writer）

- `authoritativeQuotes.ts:52 const phase = marketPhase(market, now)`，`:54 if (phase.hasSettledSnapshot)` 是**唯一**進入收盤權威的閘門。
- `marketClock.ts:54-56`：TW 週末直接 early-return `hasSettledSnapshot:false`；`:63-64` 平日也只有「今天 13:30+35min 之後」才 true。
- Asia/Taipei 2026-08-29（週六）00:05 → `hasSettledSnapshot=false` → **`fetchConfirmedCloses`（:57）與 `daily_price_snapshots`（:75）兩段全部跳過**，直接落到 `:100 current_prices`，回傳 `source:'current'`。
- `FreeCheckup.jsx:1515-1518`：`source==='current'` → `source:'db'`、**`tradeDate: null`** → `:1537` `priceState='pending'`、`:1538` reason `stale_trade_date`。這就是 exact last writer，20/20 pending 由它產生，與 memo 無關。
- 第二個獨立缺陷：`:78 .eq('trade_date', phase.marketDate)` 用的是「今天」而非 `latestCompletedTradeDate()`。就算閘門放行，週六查的是 `2026-08-29`，DB 只有 `2026-08-28`，仍 0 列。
- code normalization／market classification 沒問題：`detectHoldingMarket` 對 4-6 位數字回 TW，`039108/053848/702157` 亦符合；miss 不是 shape 問題。
- 其他 `setHoldings` path 檢查：`:758-775` Realtime 只 `...h` 展開並改 `price/priceSource:'realtime'/priceUpdatedAt`，**不覆寫** `priceTradeDate/priceState`；`:2057-2061` 日報路徑只改 `price/value/pnl/pct`；`:2651` 為匯入路徑。**沒有任何 path 會抹掉收盤身分——問題是它從來沒被寫進去過。**

## D. Auto refresh gate 稽核

`FreeCheckup.jsx:1587 const stale = !lastUpdate || (Date.now()-lastUpdate) > intervalMs`。`lastUpdate` 由 `:1548`（quote 抓取時間）與 `:1643`（`priceUpdatedAt` 種入）決定，**等同「報價剛更新」，完全不看收盤身分**。00:01 更新 + 5 分鐘設定 → reload 時 `stale=false` → 不刷新。這是第二個必要條件。

最小 cooldown-safe predicate（純函式，不新增 provider polling）：

```
needsCloseAuthorityRefresh(holdings, now) =
  總數>0 且 存在 h 使 (h.priceState !== 'confirmed' || h.priceTradeDate?.slice(0,10) !== latestCompletedTradeDate(now))
```

併入 `:1587`：`const due = stale || needsCloseAuthorityRefresh(holdings)`，其餘 guard 完全沿用（`refreshing`、`minutes<=0`、既有 60 秒 `lastRunAt`、`refreshPrices` 內 30 秒冷卻）。收斂後 predicate 自動回 false，不會 storm。

## E. Preview build identity

平台未對 sandbox 暴露 hosted preview 的 build hash／revision endpoint（先前 canary 亦因 Lovable auth-bridge cookie 而無法取得）。**標 UNKNOWN**，不以 repo hash 冒充。本輪不以「Stage 1 是否載入」作為結案依據——因為即使已載入，C 的 coverage miss 仍會使 banner 停在 20/20，兩者無法互相證偽。

## 1. 唯一 root chain

```text
週末／未過 14:05 → marketClock.hasSettledSnapshot=false
  → authoritativeQuotes 跳過 confirmed-close 與 snapshot 兩段（coverage miss，必要條件 1）
  → 只回 current_prices，tradeDate=null
  → FreeCheckup:1537 priceState='pending' → banner 20/20
且 auto gate 以 quote 新鮮度判 stale（必要條件 2）→ reload 不觸發刷新
（次要）snapshot 查詢用 phase.marketDate 而非 latestCompletedTradeDate → 閘門修好仍會 0 列
Stage 1 memo fix：必要但不充分（identity 從未變化，memo 無從失效）
```

## 2. Exact minimal allowlist（4 檔）

| 檔案 | 變更 |
| --- | --- |
| `src/checkup/lib/authoritativeQuotes.ts` | TW 一律先試 `fetchConfirmedCloses`（不受 `hasSettledSnapshot` 限制）；`daily_price_snapshots` 改用 `latestCompletedTradeDate(now,{market:'TW'})` 當 `trade_date`；`current_prices` 維持最後 fallback（`source:'current'`，tradeDate 仍為 null，不偽造）。回傳型別不變。 |
| `src/checkup/lib/closeAlignment.ts` | 新增純函式 `needsCloseAuthorityRefresh(holdings, now)`（D 段定義）。 |
| `src/pages/FreeCheckup.jsx` | 僅 `:1587-1589` 併入 `needsCloseAuthorityRefresh`；其餘 guard 一字不動。 |
| `src/test/unit/authoritative-quotes.test.ts` + `src/test/unit/close-alignment.test.ts` | 下述 red→green 案例。 |

不動 `marketClock.ts`（`hasSettledSnapshot` 另有 `useAuthoritativePrices` 消費者，改它會擴散）、不動 `useSparklines.ts`、Edge、DB、cron。

## 3. Fixed-time red→green tests

固定時鐘，皆先紅：

1. `2026-08-29T00:05+08`（週六）：20 檔 → 目前全部 `source:'current'`；修後 18 檔 `source:'snapshot'` 且 `updatedAt='2026-08-28'`，3 檔落後者維持 `current`（誠實 pending）。
2. `2026-08-28T02:00+08`（平日開盤前）：expected 仍是 `2026-08-27`，不得誤判為 08-28。
3. `2026-08-28T14:40+08`（已定版）：維持既有行為，snapshot 查 `2026-08-28`。
4. `2026-08-28T13:40+08`（settling）：不得宣稱當日 confirmed。
5. `needsCloseAuthorityRefresh`：全 confirmed+expected → false；任一 pending 或日期不符 → true；空陣列 → false。
6. 回歸：`authoritative-quotes.test.ts` 既有 4 案、`holdings-close-memo.test.tsx`、`holdings-sort.test.ts` 全綠；再跑一次完整 suite 確認 0 regress。

## 4. No-Publish Hosted gate

不 Publish，只用既有 Preview URL：

1. 舊 profile、**不開任何抽屜、不按「立即更新持倉報價」**，reload 一次，靜置至多一個 auto interval：banner 必須自動由「20/20 待確認」收斂為 factual（依 B 表預期 3 檔誠實 pending，不得偽造成全綠）。
2. 第二次 reload：無 console error、`checkup-sparkline` invoke 次數與第一次同量級（cooldown 生效、無 storm）。
3. 390×844 檢查 hero 與卡片無溢出。

## 5. Stage 1 處置

保留 `holdingsSort.ts` 的 close identity memo key，不回滾；本輪證據顯示它是收斂的必要條件，且無 regression 證據。Stage 2（`useSparklines` same-mount 14:05 邊界）維持凍結。

停住等 review。
