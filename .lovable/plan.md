# HOLDINGS_CLOSE_AUTHORITY_DESIGN_V4_READY

依 PLAN_REVIEW_3 修訂兩點。仍為 Plan mode：未改檔、未 deploy、未 Publish、未寫 DB／cron／secret、未呼叫 provider。V3 其餘契約不變（calendar loader、phase lane、17/3、snapshot 永不 confirmed、cooldown race、no Publish、Stage 2 凍結）。

## 1. UI 語意重用（不新增 `snapshot_pending`、不改 Footer/Hero）

Exact 證據：

- `FreeCheckup.jsx:1446` Demo 路徑已寫 `priceSource:'pending_close'`；`confirmedClose.ts:198 toHoldingPriceIdentity()` 亦回 `'pending_close'`。→ 該值是既有 production 語彙。
- `HoldingCardFooter.tsx:19-31 SRC_LABEL` 與 `HoldingsHero.tsx:34-47 SRC_LABEL` **都沒有** `pending_close` 鍵；`:48 SRC_LABEL[h.priceSource] || h.priceSource` 為 raw fallback。既有 `'close'`、`'db'`、`'realtime'`(Hero 有、Footer 無) 同樣走 fallback。→ 沿用 `pending_close` **不需要**改任何 label map，行為與現有 Demo 路徑一致。
- 「待確認」文案來源是 `HoldingCardFooter.tsx:53-55`，判斷依據是 **`h.priceState === 'pending'`**，與 `priceSource` 無關；`summarizeCloseAlignment` 亦只看 `priceState`/`priceTradeDate`。→ UI 待確認語意已備妥，零新增。

FreeCheckup mapping（`:1535-1538`）改為：

```
priceSource: q.state === 'confirmed' ? 'close'
           : q.source === 'snapshot' ? 'pending_close'
           : 'db'
priceState : q.state
priceTradeDate: q.tradeDate      // pending 時為 Edge factual 日期或 null，永不填 expected
priceReason: q.reason
```

## 2. Transport 可觀測契約（REVIEW_3 §2 → 選項 B）

直讀 `src/checkup/lib/closeAuthority.ts:38-48`：

```ts
try {
  const data = await getCheckupGateway().invoke<{ result?: Record<string, SparklineLike> }>(...)
  const result = data?.result || {};
  for (const symbol of symbols) out[symbol] = buildConfirmedClose(symbol, result[symbol], { now });
} catch {
  for (const symbol of symbols) out[symbol] = buildConfirmedClose(symbol, null, { now });
}
```

三種情況（gateway throw／`data.result` absent／empty factual result）**最終都產生同一組 `pending / reason='no_bars'` 的卡**，回傳型別 `Promise<ConfirmedCloseMap>` 不帶任何 transport 資訊。→ **無法區分，採 B。**

最小 backward-compatible 擴充（`closeAuthority.ts` 進 allowlist）：

```ts
export type CloseFetchTransport = 'ok' | 'throw' | 'absent';
export interface DailyCloseCardsResult { cards: ConfirmedCloseMap; transport: CloseFetchTransport; }
export async function fetchDailyCloseCardsDetailed(codes, now?): Promise<DailyCloseCardsResult>
// 'ok'     = invoke resolved 且 data.result 為 object（即使某些 code 缺席 → 該 code factual pending）
// 'absent' = invoke resolved 但 data.result 非 object / 缺欄位
// 'throw'  = invoke throw（transport failure）
```

`fetchDailyCloseCards` / `fetchConfirmedCloses` 改為薄包裝呼叫 detailed 版並只回 `cards`，**既有 caller 與回傳型別 1:1 不變**。新增 transport contract test（三情境各一）。

`authoritativeQuotes` 只在 TW settled lane 呼叫 `fetchDailyCloseCardsDetailed` 一次，並把 `{ lane, attempted, transport }` 以 meta 形式回給 `refreshPrices`（不杜撰）。

### One-shot 標記規則（可證實）

| 情況 | 標 one-shot？ | 理由 |
| --- | --- | --- |
| `transport==='ok'`（含全部 factual pending、含 result 為空物件） | **標** | gateway attempt 已完成且回應可觀測；再打也是同一答案，避免 storm |
| `transport==='throw'` | 不標 | transport failure，允許 60 秒 guard 後重試 |
| `transport==='absent'` | 不標 | 回應形狀不合契約，視同未完成 attempt |
| lane ≠ `settled`（intraday/settling/unknown） | 不標 | 根本沒進 authority lane，0 Edge call |
| `refreshPrices` early return：`refreshing` / 30s cooldown / no-holdings / demo | **絕不標** | 沒有 attempt |

不 storm 證明：`transport==='ok'` 標記後，同一 `expected` 交易日內 auto effect 不再因 authority 觸發（stale 週期刷新照舊、仍受 5 分鐘 interval 與 60 秒 `lastRunAt` 節流）；`throw/absent` 不標，但每次重試前必須通過既有 60 秒 `lastRunAt` guard，effect deps 仍為 `[tab, holdings]`，不會 per-render 重打。跨到新 expected 交易日才重新開放 1 次。

### Ordering / state machine（V3 §5 保留，補 typed outcome 來源）

```
type RefreshOutcome =
  | { kind:'skipped', why:'refreshing'|'cooldown'|'no-holdings'|'demo' }
  | { kind:'attempted', lane:'settled', expected:string, transport:'ok'|'throw'|'absent' }
  | { kind:'attempted', lane:'intraday'|'settling'|'unknown' }

auto effect：
1. 既有 guards（tab / holdings / refreshing / minutes<=0）
2. due = stale || needsCloseAuthorityRefresh(holdings)
3. expected = latestCompletedTradeDate()
4. if (authorityAttemptRef.current.date === expected && !stale) return
5. if (Date.now() - lastRunAt < 60_000) return          // 既有 guard 不變
6. lastRunAt = Date.now()
7. timer = setTimeout(async () => {
     const out = await refreshPrices()
     if (disposedRef.current) return
     if (out.kind==='attempted' && out.lane==='settled' && out.transport==='ok')
        authorityAttemptRef.current = { date: out.expected }
   }, 300)
8. cleanup：clearTimeout(timer) + disposedRef（unmount 後不寫 ref/state）
```

## 3. Exact allowlist（production 5 檔 + tests 3 檔 = 8）

Production source：

| # | 檔案 | 變更 |
| --- | --- | --- |
| 1 | `src/checkup/lib/marketCalendar.ts` | 新增純函式 `closeAuthorityLane(now, market)` |
| 2 | `src/checkup/lib/closeAuthority.ts` | 新增 `fetchDailyCloseCardsDetailed` + `CloseFetchTransport`；既有兩支改薄包裝，型別與行為不變 |
| 3 | `src/checkup/lib/authoritativeQuotes.ts` | request 級 `await loadMarketHolidays()`；TW lane 化；三步 merge + pendingMeta；shape 加 `state/tradeDate/reason`；回傳 meta；非 TW 不變 |
| 4 | `src/checkup/lib/closeAlignment.ts` | 新增 `needsCloseAuthorityRefresh(holdings, now)`（phase-aware） |
| 5 | `src/pages/FreeCheckup.jsx` | `:1508-1521` 讀新 shape、`:1535-1538` 映射（重用 `pending_close`）、`refreshPrices` 回 typed outcome、`:1578-1595` state machine + one-shot ref + cleanup |

Tests：

| # | 檔案 | 內容 |
| --- | --- | --- |
| 6 | `src/test/unit/authoritative-quotes.test.ts`（擴充） | lane 行為、merge、invoke count、20 codes fixture |
| 7 | `src/test/unit/close-authority-lane.test.ts`（新增） | `closeAuthorityLane` 純函式、loader 接線、predicate、one-shot race |
| 8 | `src/test/unit/close-authority-transport.test.ts`（新增） | `fetchDailyCloseCardsDetailed` 三情境 + 舊 API 相容 |

**不改**：`HoldingCardFooter.tsx`、`HoldingsHero.tsx`（§1 已證不需要）、`marketClock.ts`、`useSparklines.ts`、`holdingsSort.ts`、Edge、DB、cron。

Rollback scope：revert 上述 5 支 production 檔（純 client、無 DB／Edge／schema 副作用）；tests 可獨立保留或一併 revert。Stage 1 `holdingsSort.ts` 不在 rollback 範圍內、不回滾。

## 4. Fixed-time tests（全部 assert invocation count；不連 live DB，值為固定 fixture）

| # | 情境（Asia/Taipei） | 預期 |
| --- | --- | --- |
| 1 | Fri 08-28 10:00 | current wins、pending、`tradeDate=null`、sparkline invoke **0**、snapshot query 0 |
| 2 | Fri 08-28 13:40 settling | 同上、invoke 0 |
| 3 | Fri 08-28 14:06 | confirmed、`tradeDate=2026-08-28`、invoke 1 |
| 4 | Sat 08-29 00:05 | expected=2026-08-28、invoke 1 |
| 5 | 平日盤前 Fri 08-28 02:00 | expected=2026-08-27 |
| 6 | 休市日（fixture 注入 holidays） | 用前一交易日、invoke 1 |
| 7 | loader 失敗 → lane unknown | 全 current/pending、invoke 0、無 confirmed |
| 8 | 同一台北日連兩次 `fetchAuthoritativeQuotes` | `tw_market_holidays` query 恰 1 次 |
| 9 | Edge pending + snapshot 有 expected 列 | `state='pending'`、`source='snapshot'`、`tradeDate`=Edge factual 日期、映射為 `pending_close`（**不是** `close`） |
| 10 | Edge pending + 只有 current_prices | pending、保留 Edge factual `tradeDate`/`reason`、映射 `db` |
| 11 | transport contract | throw → `'throw'`；`data.result` 缺 → `'absent'`；正常（含空物件）→ `'ok'`；舊 API 回傳型別不變 |
| 12 | predicate | lane≠settled → false；settled+mismatch → true |
| 13 | one-shot race：`lastUpdate=now-10s` + pending | 首次被 cooldown skip → 不標、invoke 0；冷卻過後恰 **1** 次 invoke；同 expected 之後 0；跨 expected 再 1 |
| 14 | transport throw / absent | 不標 one-shot；60 秒後可重試；不 per-render 重打 |
| 15 | exact 20 codes fixture（固定常數） | confirmed **17** / pending **3**、`otherDates=['2026-07-02','2026-07-28','2026-08-25']`、`aligned=false`；3 檔即使 snapshot 有 08-28 也不得 confirmed |
| 16 | 回歸 | 既有 4 案、`holdings-close-memo.test.tsx`、`holdings-sort.test.ts`、完整 suite 全綠 |

## 5. No-Publish Hosted gate

1. 收盤時段：舊 profile、不開抽屜、不按手動更新，reload 一次靜置至多一個 auto interval → 自動收斂 **17/20 aligned、3 待確認**（上游若變動以當下 factual 為準）。
2. 第二次 reload：無 console error；`checkup-sparkline` invoke 與第一次同量級。
3. 盤中回歸（下一交易日 09:00–13:30）：價格語意不變（即時/db + pending），該時段 **0 次** invoke。
4. 390×844 無溢出。

Stage 1 memo fix 不回滾；Stage 2 維持凍結。停住等 review。
