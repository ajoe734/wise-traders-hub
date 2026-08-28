# SPARKLINE_CLIENT_CACHE — 唯讀稽核結果與修復計畫

本輪未改任何檔、未 deploy、未寫 DB。以下每一句「現況」都有本輪讀到的 file:line 或 live 查詢佐證。

## 1. Production data flow（「收盤 2026/08/28 · 20/20 待確認」真正的來源）

```text
holdings state (FreeCheckup.jsx)
  └─ H = useMemo(holdings, [holdingsValueKey])            FreeCheckup.jsx:1227-1229
       └─ HoldingsTab → HoldingsHero(holdings=H)
            └─ summarizeCloseAlignment(holdings)          HoldingsHero.tsx:108
                 └─ 逐筆比對 h.priceTradeDate === expected && h.priceState !== 'pending'
                                                          closeAlignment.ts:40-41
```

`priceTradeDate` / `priceState` 的**唯一寫入點**只有三處，全在 `FreeCheckup.jsx`：

- Demo 路徑 L1447-1448、L1464-1465（來源 `fetchDailyCloseCards`）
- 正式路徑 L1536-1538（`refreshPrices` → `fetchAuthoritativeQuotes` → `fetchConfirmedCloses` → gateway `invoke('checkup-sparkline')`）

Realtime 寫入點 L755-775 只更新 `price/priceSource/priceUpdatedAt`，**完全不碰** `priceTradeDate/priceState`。

結論（重要）：**這條 banner 路徑不經過 `useSparklines`，也不經過任何 sparkline localStorage 快取**；`closeAuthority` 是直接 gateway invoke（`gateway/supabaseGateway.ts` 無任何快取層）。

## 2. 對你提出的三個前端根因，逐項驗證

1. **部分不成立。** `useSparklines` 的快取鍵 `sparklineCacheKey()` → `datasetCacheKey(code,'daily_ohlc',now,market)`，鍵裡**已含 `latestCompletedTradeDate`**（marketDataStatus.ts:141-147 註解與實作）。因此 08/27 的 complete cache 在 14:05 後鍵值就換了，不會被命中。它確實缺 `tradeDate >= expected` 的顯式 predicate，但那是 defence-in-depth，不是 banner 卡住的原因。
2. **成立（次要）。** fetch effect 依賴只有 `[codesKey, enabled, pricesKey]`，`attemptedRef` key 只有 `code:sparklineCacheKey(code)`；同一 mount 跨 14:05 不會被任何依賴變化喚醒（只有 render 才會重算 key）。影響 30 日走勢／抽屜，不影響 banner。
3. **成立。** `useConfirmedCloses.ts` 無任何 production consumer（只有自身定義）。不列入修復標的。

## 3. Banner 卡在 20/20 的候選根因（尚未實證，Stage 0 先證）

- **RC-A（主要嫌疑）memo 鍵漏欄位**：`holdingsValueKeyShort` 只含 `code|qty|price|cost`（holdingsSort.ts:41-44）。`refreshPrices` 若取回的收盤價與現有 `price` 相同（收盤後重整最常見），memo 鍵不變 → `H` 仍是**舊物件陣列** → banner 讀到舊的 `priceTradeDate/priceState`，永遠不轉綠。
- **RC-B Realtime 覆蓋**：L755-775 以 `current_prices` 覆寫 `price` 但不更新收盤身分，會把已 confirmed 的列洗成「價格新、身分舊」。
- **RC-C 持久化缺欄位**：`normalizeHoldingMetrics`（holdings.js:114-160）只 spread `...item`，沒有從 quote 帶出 `tradeDate`；reload 後若儲存體沒有該欄位，全部起手 pending，再被 RC-A 鎖死。

Live 端已排除：`checkup_storage` 18 檔 sparkline last_bar = 2026-08-28、`daily_price_snapshots` 2026-08-28 有 163 列、`tw_market_holidays` anon/authenticated 皆可 SELECT（32 列）。伺服器側是好的。

## 4. Stage 0（先證後修，仍不改 production 行為）

以 Playwright 對本地 preview 跑一次持倉看板，攔截 `checkup-sparkline` invoke 並在 console 印出：每次 `setHoldings` 後 `holdingsValueKey` 是否變化、`priceTradeDate/priceState` 分佈、banner 文案。用結果確認 RC-A/B/C 何者為真，再進 Stage 1。若 RC-A 被證實，Stage 1 的第一刀就是 memo 鍵。

## 5. Exact allowlist（Stage 1，最小面）

| 檔案 | 變更 |
| --- | --- |
| `src/checkup/lib/holdingsSort.ts` | `holdingsValueKeyShort` 補 `priceTradeDate|priceState`（僅此二欄） |
| `src/pages/FreeCheckup.jsx` | Realtime 寫入時，若 `h.priceTradeDate` 已是 expected 則保留身分；不新增 refresh |
| `src/checkup/hooks/useSparklines.ts` | 共用 freshness predicate + `expectedTradeDate` 進 effect dep／attempted key；`SPARKLINE_CACHE_VERSION` 6→7；`prefetchSparkline` 走同一 gate |
| `src/checkup/lib/marketCalendar.ts` | 匯出 `isSparklineFresh(entry, expected)` 與 `useExpectedTradeDate()` 所需的 boundary timer helper |
| tests | `src/test/unit/sparkline-client-freshness.test.ts`（新增）＋既有 `useSparklines-cache-migration.test.tsx` 補案 |

Edge `checkup-sparkline` 本輪不動；BSR／週記／籌碼不動。

## 6. 技術細節

- **freshness predicate**：`isSparklineFresh(entry, expected)` = 既有 `isCompleteSparkline` && `lastBar.date >= expected`。`holidaysLoaded('TW')` 為 false 時**回傳 true（維持現狀、不重抓）**，避免日曆載入失敗造成 request storm，同時不謊報 confirmed（confirmed 判定仍由 `confirmedClose.ts` 負責）。
- **邊界 timer**：`useExpectedTradeDate()` 以單一 `setTimeout` 對準下一次台北 14:05（跨假日/週末則對準下一個交易日），觸發後 `setState(expected)` 並重排；`useEffect` cleanup 清 timer，無 polling。
- **attempt key**：`${code}:${sparklineCacheKey(code)}:${expected}` → 每檔每個 expected date 至多一次 invoke。
- **cache 版本**：僅 bump sparkline namespace 版本並刪除 `lf.checkup.cache.sparkline.v6`，不碰其他 localStorage 命名空間；版本 bump 只當一次性 migration，日常靠 predicate。
- 30 筆批次、in-flight dedupe、partial/fail 30 分冷卻、server global cooldown 語意全部不變。

## 7. Executable tests

固定時鐘（`vi.setSystemTime`），不使用未固定 `Date.now()`：

1. 14:04:59 前一交易日 complete cache → hit、0 fetch
2. 14:05:00 後同一 cache → stale、恰 1 次 fetch
3. same mount 跨 14:05 → expected 改變、attempted gate 不擋、恰 1 次
4. 第二次 render／reload 且 v7 cache fresh → 0 fetch
5. v6 → v7 migration 只清 sparkline namespace，其他 key 保留
6. 週末、`tw_market_holidays` 假日 → expected 正確 roll back
7. 假日表載入失敗 → 不謊報、0 額外 fetch
8. `prefetchSparkline` 與 list lane 共用同一 gate（stale complete cache 不再旁路命中）
9. partial/fail 冷卻回歸不破
10. banner：`priceState` 由 pending→confirmed 而 `price` 不變時，`holdingsValueKey` 必須改變（RC-A 紅測）

## 8. Hosted gate

Stage 1 只改前端 → 需 Publish 後在 Hosted 驗：不開任何抽屜，reload 一次，banner 由「20/20 待確認」收斂到與伺服器一致（目前 18 檔 last_bar=08-28，上游落後者誠實維持 pending，不得偽造）。回滾＝revert 這批前端檔案，無 DB／Edge 影響。
