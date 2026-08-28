# HOLDINGS_CLOSE_MEMO — Stage 1（只修 banner root cause）

本輪未改任何檔、未 deploy、未 Publish、未寫 DB。

## 1. Exact root proof（RC-A，唯一 Stage 1 標的）

```text
refreshPrices()  FreeCheckup.jsx:1524-1541
  setHoldings(prev => prev.map(h => ({ ...h, price, priceTradeDate: hit.tradeDate,
      priceState: hit.tradeDate === latestCompletedTradeDate() ? 'confirmed' : 'pending', ... })))
      → 產生新 array、新物件；price 在「收盤後重整」通常與舊值相同

holdingsValueKey = holdingsValueKeyShort(holdings)      FreeCheckup.jsx:1227
  holdingsSort.ts:41-44 →  `n=${len}:` + `${code}|${qty}|${price}|${cost}`
  → 不含 priceTradeDate / priceState → price 未變時字串完全相同

H = useMemo(() => holdings || EMPTY_HOLDINGS, [holdingsValueKey])   FreeCheckup.jsx:1229
  → memo 命中，H 仍指向**舊 array**（舊 close identity）

HoldingsHero.tsx:108  summarizeCloseAlignment(H)
closeAlignment.ts:40-41  td === expected && priceState !== 'pending'
  → 讀到舊的 priceTradeDate/priceState → 永遠 20/20 待確認
```

Live 已排除伺服器側：`checkup_storage` 18 檔 sparkline last_bar = 2026-08-28、`daily_price_snapshots` 2026-08-28 有 163 列、`tw_market_holidays` anon/authenticated 可讀（32 列）。持倉分頁已有進入 300ms auto refresh 與週期 refresh，所以不是「沒刷新」，是刷新結果被 memo 吃掉。

### RC-B 撤回（依你要求，證據為否）

Realtime handler `FreeCheckup.jsx:755-775` 的 mapping 為
`return { ...h, price, value, pnl, pct, priceSource:'realtime', priceUpdatedAt, priceError:null }`
— 沒有任何 statement 指派或刪除 `priceTradeDate` / `priceState`，close identity 由 `...h` 保留。**RC-B 不成立，已從 allowlist 移除，本輪不改 `FreeCheckup.jsx`。**

### RC-C 撤回

`normalizeHoldingMetrics`（holdings.js:114-160）以 `...item` 起手，保留既有欄位；舊持久化資料起手 pending 可由既有 auto refresh 補齊，畫面不更新的原因仍是 RC-A。不擴檔。

## 2. Exact allowlist / diff intent

| 檔案 | 變更 |
| --- | --- |
| `src/checkup/lib/holdingsSort.ts` | `holdingsValueKeyShort` 每筆由 `code|qty|price|cost` 改為 `code|qty|price|cost|priceTradeDate|priceState|priceSource|priceError`（空值一律正規化成空字串） |
| `src/checkup/lib/__tests__/holdingsSort` 既有測試檔 | 補紅測：同 code/qty/price/cost、只改 close identity → key 必須不同；其餘既有斷言不動 |
| 1 個 integration 測試（`src/test/unit/close-alignment.test.ts` 內新增 case，或新增 `holdings-close-memo.test.tsx`，二選一，最終只碰一檔） | 以 production memo/render path 證 banner：pending→confirmed 後 `summarizeCloseAlignment(H)` 必須收斂 |

不動 `useSparklines.ts`、`marketCalendar.ts`、`FreeCheckup.jsx`、Edge、DB、cron。

### 納入欄位的 production consumer 證據

- `priceTradeDate`、`priceState` — `closeAlignment.ts:40-41`（banner）、`HoldingCardFooter.tsx:53-54,118-119`
- `priceSource` — `HoldingsHero.tsx:56`（來源分佈）、`HoldingCardFooter.tsx:48,116`
- `priceError` — `HoldingCardFooter.tsx:50,120`（「報價問題」與 `data-price-error`）

**刻意排除 `priceUpdatedAt`**（`HoldingsHero.tsx:59` 最舊 tick、`Footer:56-57`）：它每次 refresh 必變，納入等於讓 memo 幾乎恆失效，破壞既有穩定 reference 的效能契約；且它總是與 `price`／`priceSource`／`priceState` 其一同時變動，實務上不會單獨滯留。

## 3. Red → Green tests

先紅（在改 `holdingsSort.ts` 之前必須失敗）：

1. `holdingsValueKeyShort` 純函式：兩筆同 `code/qty/price/cost`，A = `{priceTradeDate:'2026-08-27', priceState:'pending'}`、B = `{priceTradeDate:'2026-08-28', priceState:'confirmed'}` → 目前輸出相同（紅：斷言 `not.toBe`），修後不同。
2. `priceSource` 由 `'current'`→`'close'`、`priceError` 由字串→null 各自獨立改變 key。
3. Banner integration：以 production memo 語意（`useMemo(holdings,[holdingsValueKeyShort(holdings)])`）模擬 refresh 前後兩個 array（price 不變、close identity 由 pending 舊日 → confirmed expected），斷言 `summarizeCloseAlignment` 由 `confirmed=0` 變成 `confirmed=n`。紅在修前（memo 命中舊 array），綠在修後。
4. 回歸：`price` 變動仍改 key；`n=` 長度前綴語意不變；空陣列回 `''`；既有 holdings-sort 測試全綠。

驗證指令：`bunx vitest run src/checkup/lib/__tests__ src/test/unit/close-alignment.test.ts`，再跑一次完整 suite 確認 0 regress。

## 4. Hosted gate（禁止 Publish）

只在既有 Lovable Preview URL 驗，不 Publish：

1. 舊使用者 profile、**不開任何抽屜**，reload 一次 → auto refresh 後 banner 由「20/20 待確認」收斂為 factual（伺服器目前 18 檔對齊 08-28，落後者誠實維持 pending，不得偽造）。
2. 第二次 reload：無 console error、無額外 `checkup-sparkline` request storm（invoke 次數與第一次同量級）。
3. 390×844 檢查 hero 與卡片無溢出。

回滾＝revert `holdingsSort.ts` 一檔，無 DB／Edge 影響。

## 5. Stage 2（本輪不做，Stage 1 Preview 通過後另立）

`useSparklines` same-mount 跨台北 14:05 邊界：effect 依賴與 `attemptedRef` key 納入 expected trade date。React hook／timer 一律留在 `useSparklines.ts` 或獨立 hook 檔；`marketCalendar.ts` 維持純函式，只提供「下一個 14:05 邊界」的純計算 helper。
