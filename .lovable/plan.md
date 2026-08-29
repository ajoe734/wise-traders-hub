# HOLDINGS_MANUAL_ENTRY_PLAN_V2

唯讀稽核完成，尚未寫任何 production 檔。以下每一點都對應 source 證據。

## 0. 稽核推翻 V1 的三個前提

| V1 假設 | Source 事實 | 影響 |
|---|---|---|
| 手動列需帶 `market` / `currency` | checkup 交易／持倉 schema **完全沒有** market/currency。OCR 契約 `constants.jsx:242` = `{action,code,name,qty,price,market_price,amount,total_cost,fee}`；`normalizeHoldingRow` (`holdings.js:163`) 產出 `{code,name,qty,cost,price,type,alert,expire,targetPrice}`。唯一分類器是 `inferHoldingType(code,name)` (`constants.jsx:284`) | 手動列**不得**新增任何欄位；`signalFieldResolvers.inferMarket` 完全不進場（那是 signals domain） |
| trade log 寫 `checkup_trade_memos` | 兩處都寫：`save("pf-log-v2", tradeLog)` (`FreeCheckup.jsx:929`, → localStorage + `checkup_storage` upsert，`constants.jsx:401`)，並 debounce 800ms 後 `saveTradeLogToCloud` 做 `checkup_trade_memos` delete+insert (`FreeCheckup.jsx:891-925`)。註：`pf-log-v2` **不在** `CLOUD_SYNC_KEYS` (`constants.jsx:272`)，寫得進去、開機不讀回 | 資料流圖與測試斷言改成雙寫；本計畫不修 `CLOUD_SYNC_KEYS`（non-goal） |
| 目標價 orphan 只需提示 | `targets` 的唯一 consumer 是 `dossierUtils.js:85` `targets[holding.code]?.reports`，以 holding 為索引 | 非持倉／非 preview 代碼的目標價**永久不可見** → 必須阻擋提交 |

## 1. Exact unique file list（10 檔，無「附帶」）

新增 5：
1. `src/checkup/lib/stockIdentity.ts` — 純識別工具（`normalizeStockCode`、`isTaiwanStockCode`），零 import、零 I/O。
2. `src/checkup/lib/manualTradeEntry.ts` — 純 builder + validator + replay 檢查，只 import (1) 與 `constants.jsx` 的 `inferHoldingType` / `MAX_HOLDINGS`。
3. `src/checkup/components/freecheckup/ManualTradeForm.jsx` — 手動輸入表單（preview 列、名稱 async resolve）。
4. `src/test/unit/manual-trade-entry.test.ts` — row contract / validator / replay / 日期 round-trip 矩陣。
5. `src/test/integration/manual-trade-entry.integration.test.tsx` — 0 network/0 DB → confirm 一次 → 刪除 replay 回空。

修改 5：
6. `src/checkup/lib/chipsRepository.ts` — 只把 `normalizeStockCode`/`isTaiwanStockCode` 改為 `export { ... } from './stockIdentity'`（行為 0 變更）。理由：現檔 import `./gateway` 與 `@/lib/trafficTracker`，交易 domain 不得反向耦合籌碼 repository。
7. `src/checkup/components/freecheckup/TradeTab.jsx` — 新增 segmented control（截圖 / 手動）＋ 目標價區塊改文案與位置。
8. `src/checkup/lib/tradeLogOps.js` — `replayTradeLog` 比較子改 deterministic（見 §4）。
9. `src/checkup/lib/__tests__/tradeLogOps.test.js` — 補跨月／混合日期格式排序回歸。
10. `src/pages/FreeCheckup.jsx` — 只新增一個 `commitManualTrades(rows)`（複用既有 `mergeTradeIntoHoldings` + `setTradeLog` 相同 shape）並以 prop 傳入 TradeTab；不動 parse pipeline、不動 auto-save effect。

不碰：Edge function、migration、RLS、Demo fixture、`CLOUD_SYNC_KEYS`、BSR 修正檔、`db/r1/p/acl-25.*`。

## 2. Atomic stages（每階段可獨立 rollback）

- **Stage A（純工具，無 UI）**：檔 1、2、6、8、9、4。行為對使用者 0 變化。Rollback = revert 6 檔。
- **Stage B（核心功能，atomic）**：檔 3、7、10、5 一起上。tab 與目標價搬遷在同一 commit（V1 的 Stage1 依賴 Stage2 之錯誤已消除）。Rollback = revert 4 檔，回到 Stage A 狀態仍可用。
- **Stage C（驗收，不改 production code）**：390×844 RWD / a11y 證據。

## 3. Exact row contract

Manual draft →（builder）→ **trade row**（與 OCR `preparedTrades` 逐欄同構）：

```json
{ "action": "買進", "code": "2330", "name": "台積電", "qty": 1000, "price": 1085,
  "market_price": null, "amount": null, "total_cost": null, "fee": null,
  "date": "2026/08/29", "time": "10:32" }
```

四個必答案例（builder 輸出）：

| 欄位 | TW 2330 | TW ETF 00637L | AMD | SOXL |
|---|---|---|---|---|
| code | `"2330"` | `"00637L"`（upper） | `"AMD"` | `"SOXL"` |
| name | `"台積電"`(resolve) / fallback code | `"元大滬深300正2"` / code | 使用者填或 `"AMD"` | 使用者填或 `"SOXL"` |
| qty | 1000 | 5000 | 30 | 100 |
| price / market_price / amount / total_cost / fee | 1085 / null / null / null / null | 同左 | 132.5 / null… | 21.44 / null… |
| date / time | `"2026/08/29"` / `"10:32"` | 同 | 同 | 同 |
| action | `"買進"`｜`"賣出"` | 同 | 同 | 同 |

- **無 market/currency/source 欄**（§0）。
- `mergeTradeIntoHoldings` (`FreeCheckup.jsx:2444`) 消費：`action/code/name/qty/price/total_cost/fee/market_price`；未帶 `market_price` 時以 `price` 當市價，新持倉得 `type: inferHoldingType(code,name)`（2330→股票、00637L→ETF、AMD/SOXL→股票）、`priceSource:'screenshot'`。**唯一差異**：手動列由 `commitManualTrades` 設 `priceSource:'manual'`（`holdingHasUserOrigin` `constants.jsx:` 已認得 `'manual'`），其餘完全相同。
- **tradeLog entry**（與 `FreeCheckup.jsx:2700-2707` 同 shape）：`{ id: Date.now()+Math.random(), date, time, action, code, name, qty, price, qa: [] }`。
- `replayTradeLog` (`tradeLogOps.js:20`) 只讀 `date/time/id/action/code/qty/price/name` → 手動列可完整 replay。
- `saveTradeLogToCloud` 映射：`trade_date=date`、`trade_time=time`、`action/code/name/qty/price`、`qa=[]`。

## 4. 日期：deterministic，不新增 locale 契約

現況風險（既有 bug，本計畫順手收斂）：log 用 `toLocaleDateString("zh-TW")` → `"2026/8/9"`（不補零），而 `replayTradeLog` 用**字串比較** → `"2026/8/9" > "2026/08/29"`，跨月與補零混用會排錯。

- 手動列一律輸出補零 `YYYY/MM/DD`（純函式 `formatSlashDate` 置於 `manualTradeEntry.ts`，不用 `toLocaleDateString`）。
- `tradeLogOps.replayTradeLog` 比較子改為：`parseFlexibleDate(date)`（`datetime.js:9`，已支援 `YYYY/M/D` 與 `YYYY-MM-DD`）→ epoch，再比 `time`（`HH:mm` 補零字串），最後 `String(id)`。無法 parse 者排最後，保持穩定。
- 測試：round-trip（build → parse → format 相等）、跨月（8/9 vs 8/29 vs 9/1）、補零與非補零混排、Safari 相容（不使用 `new Date("YYYY-MM-DD HH:mm")` 這類 Safari NaN 形式，只走 `parseFlexibleDate` 既有分支，並加 regex 斷言）。

## 5. 目標價（0 orphan write）

- 提交條件：`code ∈ (現有 holdings ∪ 本次 preview 列)`。
- 否則**阻擋**提交，inline error「此代碼尚未在你的持倉中，請先用『手動新增成交』建立部位」，並提供跳到手動 tab 的按鈕（帶入該代碼）。
- 若 code 已在 preview → 允許存草稿，**confirm 之後才寫入** `targets`，確保 `dossierUtils` 立即看得到。
- 測試：`0 orphan write` — 對未持有代碼提交，斷言 `save("pf-targets-v1", …)` 呼叫次數 = 0 且 `targets` state 不變。

## 6. Demo / 未登入 exact 契約

TradeTab 已有 `isDemo` prop。

| 情境 | 行為 |
|---|---|
| demo 點「手動輸入」tab | tab 可切換，表單以 `disabled` 呈現＋既有登入 CTA；`onChange` 不掛載，`draft` state 不建立 |
| demo 點「加入清單」 | 按鈕 `disabled` 且 `onClick` 早退（`if (isDemo) return;`）→ `setManualRows` 不被呼叫，`parsed` **不變**；斷言 `parsed === null` |
| demo 點「確認寫入」 | 不存在（沒有 rows），且 `commitManualTrades` 首行 `if (isDemo) return;` |

測試以 callback spy 斷言（不引用行號）：`setParsed` / `commitManualTrades` 呼叫次數皆為 0。

## 7. 賣超驗證（依序 replay，非淨額）

`validatePreview(existingHoldings, previewRows)`：以 `Map<code, qty>` 由現有持倉起算，**依 preview 陣列順序**逐列套用；賣出時 `if (qty > map.get(code)) → error(index)`。因此「先賣 1000 後買 1000」在第 1 列即擋下，不被後面的買單倒灌放行。回傳 `{ ok, errors: [{index, code, reason}] }`，deterministic、純函式。

## 8. MAX_HOLDINGS

以 replay 後結果計算：`unique codes where qty > 0`（現有持倉套完 preview 全部列之後）。賣到 0 的代碼在 `mergeTradeIntoHoldings` 會 splice 移除，因此**釋放名額**。超過 50 才擋，錯誤訊息標出超出的代碼數。不沿用 FreeCheckup 現有的粗略「代碼聯集」估算。

## 9. parsed / manual state 契約

- 單一事實來源：手動列只存在 `TradeTab` 內部 `manualRows`（陣列，初始 `[]`），**不寫入 `parsed`**，直到 confirm。
- `parsed === null` 時切到手動 tab：`img`、`parsed` 皆不動。
- confirm 後：呼叫 `commitManualTrades(rows)` → 清空 `manualRows`，`parsed`/`img` 仍保持原值（OCR 結果不被清掉）。
- 移除最後一列：`manualRows = []`，confirm 按鈕 disabled，不觸發任何 setState 於 parent。
- 再次上傳 OCR：走原 pipeline，`manualRows` 不受影響（互不清除）。

## 10. 名稱 async resolve race

`resolveStockName` (`src/lib/stockNameResolver.ts:71`) 以 seq token 控制：每次 code 變更 `seq += 1`，回呼比對 `seq === mySeq` 才 setState；unmount 時 `cancelled=true`。狀態：`idle / loading / resolved / error`；error 或查無 → fallback = code；使用者手填後 `nameDirty=true`，此後 resolve 結果**不覆寫**。component test：2330→AMD 快速切換（舊 promise 後到）斷言顯示 AMD 名稱。

## 11. Test matrix

Unit（檔 4）：row shape ×4 案例、`inferHoldingType` 對齊、date round-trip/跨月/混排、sell-over-position 依序 replay ×6、MAX_HOLDINGS 邊界（49/50/51、賣光釋放）、normalizeStockCode（` 00637l ` → `00637L`）、0 orphan target。
Component（檔 4 或 3 對應）：name race、loading/error/fallback/dirty、demo disabled。
Integration（檔 5）：真實 `TradeTab` + 真實 `commitManualTrades`（只 mock `supabase` client 與 `fetch` 作為 spy，不 mock orchestration）—
- 加入 preview 前後、confirm 前：`fetch` 0 次、`supabase.from` 0 次；
- confirm：`setHoldings` 1 次、`setTradeLog` 1 次、`checkup_storage` upsert 與 `checkup_trade_memos` delete+insert 各恰一輪（debounce fake timer）；
- 刪除該筆 → `recomputeHoldingsAfterDelete` replay 回空。
E2E/RWD（Stage C）：390×844 截圖；鍵盤限制見 §12。

## 12. 390×844 鍵盤 limitation（明標）

Playwright/Chromium **無法開啟 OS 軟鍵盤**，因此不宣稱「鍵盤不遮擋」。替代證據：(a) 每個輸入框 `focus()` 後 `scrollIntoViewIfNeeded` + `boundingBox` 落在 visualViewport 內；(b) 以 `visualViewport` 高度模擬 844→460 後重測 CTA 可見；(c) `inputmode="decimal"` / `enterKeyHint` 屬性斷言；(d) 真機手動截圖列為人工驗收項。

## 13. Rollback / Non-goals

Rollback：Stage B revert 4 檔即回到「只有純工具、UI 無變化」；Stage A revert 6 檔回到 baseline。無 DB／Edge 變更，故無資料回滾。

Non-goals：不動 Edge、migration、RLS、cron、Demo fixture、`CLOUD_SYNC_KEYS`、BSR 修正檔與 `db/r1/p/acl-25.*`（維持 byte-identical）；不重構 FreeCheckup 主體；不改 OCR prompt；不引入 market/currency 欄位；不 deploy、不 Publish。

**HOLDINGS_MANUAL_ENTRY_PLAN_V2_READY** — 本輪 0 檔寫入 production、0 DB mutation、0 deploy。
