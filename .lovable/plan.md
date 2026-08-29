# HOLDINGS_MANUAL_ENTRY_PLAN_V4.1（最終版）

只規劃。本輪 0 寫檔、0 DB、0 deploy、0 Publish。

## 1. 手動來源語意（blocker 1）

### 1.1 `priceSource` exact 寫入點

| 值 | 寫入處 |
|---|---|
| `screenshot` | `FreeCheckup.jsx:2486`（買進併倉）、`:2498`（買進新倉）、`:2560`（`upsertSnapshotHolding`） |
| `realtime` | `FreeCheckup.jsx:770` |
| `pending_close` / `close` | `FreeCheckup.jsx:1450` / `:1467`、`confirmedClose.ts:198` |
| `db` / `close` | `useFreeCheckupBootstrap.js:71` |
| `demo` | `demoData.js:36` |
| 報價覆蓋 | `holdings.js:155` `priceSource: q?.source ?? item?.priceSource ?? null`（有新報價就覆蓋，與 origin 無關） |

### 1.2 所有 consumer

| Consumer | 行為 | screenshot vs manual 是否等價 |
|---|---|---|
| `constants.jsx:326` `holdingHasUserOrigin` | `src === 'screenshot' \|\| src === 'manual'` → 兩者**已明文等價**（`manual` 已在既有 accepted set） | 等價 ✓ |
| `useHoldingsSync.js:268` 補抓報價 | 過濾 `!h.priceSource \|\| h.priceError` → 有值就不補抓 | 等價 ✓ |
| `FreeCheckup.jsx:3646` 缺價提示 | 同上條件 | 等價 ✓ |
| `holdings.js:155` 自動報價覆蓋 | 新 quote 直接覆蓋 `priceSource`，不看舊值 | 等價 ✓ |
| `holdingsSort.ts:50` memo key | 只要字串進 key | 等價 ✓ |
| `HoldingCardFooter.tsx:19,48` `SRC_LABEL` | **無 `manual` 鍵** → `SRC_LABEL[src] \|\| src` 會在 `title`/`data-price-src` 顯示原始字串 `manual` | **不等價（顯示）** |
| `HoldingsHero.tsx:34,121,371` `SRC_LABEL` | 同上，Hero 會顯示「manual 1」 | **不等價（顯示）** |

→ **裁決**：行為完全等價、顯示不等價。採用 **existing accepted optional field `priceSource`**（非新欄位），值 `'manual'`（`holdingHasUserOrigin` 已支援），並補兩張 `SRC_LABEL` 的 `manual: '手動'`。

### 1.3 傳遞方式（同一 applyCorrections、無第二 commit、無欄位洩漏）

- manual row 帶 `priceSource: 'manual'`（僅存在於 **preview row**）。
- `applyCorrections`（`TradeTab.jsx:339`）以 `...t` 原樣傳給 `mergeTradeIntoHoldings` / `upsertSnapshotHolding`。
- **P10 修改 3 行**：`FreeCheckup.jsx:2486 / 2498 / 2560` 的 `priceSource: 'screenshot'` → `priceSource: trade?.priceSource === 'manual' ? 'manual' : 'screenshot'`（白名單，不接受任意字串）。
- **不洩漏證明**：`applyCorrections` 建 log entry 時是**顯式 7 欄**（`TradeTab.jsx:363-371`：`id,date,time,action,code,name,qty,price,qa`），不 spread `...t`；`saveTradeLogToCloud`（`FreeCheckup.jsx:897-906`）也是顯式映射 9 欄。`checkup_trade_memos` 無 `priceSource` 欄（實測欄位：`id,created_at,trade_date,trade_time,action,code,name,qty,price,qa,user_id`）→ metadata 到不了 log/DB。
- 測試：斷言 tradeLog entry 與 memos payload 的 key 集合恰為上述集合，且不含 `priceSource`/`date` 以外欄位。

## 2. Qty：TW 整數 / US fractional（blocker 2）

### 2.1 下游是否支援 decimal qty（唯讀證據）

| 環節 | 結論 |
|---|---|
| `checkup_trade_memos.qty` | `numeric`（unbounded, scale 未限制）→ **fractional 安全** |
| `holdings.js:232-290` 買/賣併倉 | 全用 `Number()` 加減與 `calcWeightedAvgCost`，**無 round/trunc on qty** |
| `FreeCheckup.jsx:2444-2530` merge | 同上；只有 `cost` 做 `Math.round(x*100)/100` |
| `tradeLogOps` replay / reverse | 純數值運算，無取整 |
| `normalizeHoldingRow`（`holdings.js:170`） | `Number(item.qty) \|\| 0`，不取整 |
| 顯示：`LogPanel.jsx:329`、`LogTab.jsx:101`、`HoldingsTable.jsx:276` | `${log.qty}股` / `qty.toLocaleString()` → `0.5` 顯示為 `0.5` ✓ |
| 衍生金額 `value/pnl/todayPnl` | `Math.round(...)`（`holdings.js:131`、`holdingMath.ts:117,127`、`HoldingCard.tsx:96`）— **只 round 金額，不 round qty**；此為全站既有台幣整數慣例，US 持倉今天已同樣被 round，非本功能引入 |
| `LogPanel.jsx:75-78` 編輯校驗 | `Number.isFinite(qty) && qty > 0`，**已允許小數** |

→ **不 BLOCKED**：decimal qty 端到端可用；唯一既有近似是「金額顯示 round 到整數」，明列為 pre-existing，不在本功能修。

### 2.2 TW / US matrix

| 市場 | code 規則 | qty 規則 | input `inputMode` / `step` | 範例 |
|---|---|---|---|---|
| TW | `/^\d{4,6}[A-Z]?$/`（`chipsRepository.ts:273` 既有） | finite、`> 0`、**整數**（零股亦為整數股數） | `numeric` / `step="1"` | `2330` 1000、`00637L` 5000、`2330` 87（零股） |
| US | `/^[A-Z]{1,5}(\.[A-Z])?$/`（`asset.ts:78`、`signalFieldResolvers.ts:48` 既有） | finite、`> 0`、**可 fractional** | `decimal` / `step="any"` | `AMD` 0.5、`SOXL` 1.25、`BRK.B` 0.1 |

- 規則單一實作：`manualTradeEntry.ts` 匯出 `qtyRuleFor(code)`，**`validateRow` 與 `computePreviewIssues` 共用同一函式**（不得兩處各寫）。
- `validateRow`（`TradeTab.jsx:314`）現行 `Number.isInteger(qty)` 無條件擋小數 → 改為 `qtyRuleFor(code).integerOnly ? Number.isInteger(qty) : true`。錯誤字串：TW「股數需為整數」；US「股數需大於 0」。
- 未知/格式合法但不屬 TW/US universe → 視同 US 寬鬆規則（finite > 0）。
- 測試：AMD 0.5、SOXL 1.25 通過；2330 0.5 被擋；`computePreviewIssues` 對 US 賣出 0.75 > 持有 0.5 判 oversell。

## 3. code/name 同步：清空 name（blocker 3）

採用最簡設計，**不用 index Set、不用 nameStale、不新增 row 欄位**：

- preview 逐列編輯：`updateTrade` 若 `patch.code` 正規化後 ≠ 原 code → 同一次 `setParsed` 內 **`name: ''`**。
- 既有 `validateRow`（`TradeTab.jsx:321`）`if (!name) errs.name = "請填寫股票名稱"` 直接阻擋提交（`hasError` → 按鈕 disabled）。
- 解鎖路徑二選一：resolver 成功回填、或使用者自行輸入。resolver 對「preview 列」的回填一律走 `updateTrade({name})`，不繞過 state。
- 因此 `code=AMD / name=台積電` 在架構上不可能存在。
- 表單（未進 parsed 前）內部 draft state：`{action, code, name, nameDirty, qty, price, date, time}`，**`nameDirty` 只存在於表單 local state**；`buildManualTradeRow` 白名單輸出 10 欄（§4），apply 時自然 strip（不 spread draft）。測試斷言 row key 集合精確相等。

## 4. Exact contracts

### 4.1 parsed shell（`parsed === null`）
```json
{ "trades": [], "targetPriceUpdates": [], "note": "" }
```
（消費點：`TradeTab.jsx:312,495`、`FreeCheckup.jsx:2739-2742`）

### 4.2 manual row（**exact 12-key set**，缺值 `null`）

canonical key set（builder / whitelist / test 三處一律以此為準，多一個少一個都算失敗）：
`action, code, name, qty, price, market_price, amount, total_cost, fee, date, time, priceSource`

```json
{"action":"買進","code":"00637L","name":"元大滬深300正2","qty":5000,"price":32.15,
 "market_price":null,"amount":null,"total_cost":null,"fee":null,
 "date":"2026/8/29","time":"10:32","priceSource":"manual"}
```

- `date` / `time` / `priceSource` 不被 `validateRow` 檢查；`mergeTradeIntoHoldings` 以 `Number(market_price) || price` 兜底 → `null` 安全。
- `buildManualTradeRow` 以 exact 12-key 白名單輸出，表單 draft 的 `nameDirty` 等欄位自然被 strip。
- tradeLog entry 與 `checkup_trade_memos` 各自維持既有 **explicit mapping**（`TradeTab.jsx:363-371` 9 欄 / `FreeCheckup.jsx:897-906` 9 欄），`priceSource` **不得外洩**到任一者。
- T1/T4 以 `Object.keys(row).sort()` 精確比對 12-key set，並斷言 log/memos payload key 集合不含 `priceSource`。


mixed `parsed.trades`（OCR ×2 + manual ×1，append 尾端、順序永不重排）：
```json
{"trades":[
 {"action":"買進","code":"2454","name":"聯發科","qty":1000,"price":1420,"market_price":1435,"amount":1420000,"total_cost":1420000,"fee":2022},
 {"action":"賣出","code":"2330","name":"台積電","qty":2000,"price":1102,"market_price":1100,"amount":2204000,"total_cost":null,"fee":3141},
 {"action":"買進","code":"AMD","name":"AMD","qty":0.5,"price":132.5,"market_price":null,"amount":null,"total_cost":null,"fee":null,"date":"2026/8/29","time":"10:32","priceSource":"manual"}
]," targetPriceUpdates":[],"note":""}
```

### 4.3 生命週期（同 V3，維持）
移除最後一列 → `setParsed(null)`；手動列不動 `img/b64`；已有未 confirm 清單再上傳 OCR → **二次確認後覆蓋**；commit 走既有 `setImg(null);setB64(null);setParsed(null)`（`TradeTab.jsx:374`）。

### 4.4 previewIssues：每 render 重算
`computePreviewIssues(holdings, parsed.trades)` 為純函式、在 `rowErrors` 同層 derive（無 state、無 memo），因此**逐列編輯 action/code/qty、刪除、順序變更後即時更新**；依序 replay 判 oversell（先賣後買不被倒灌）、套完後 `unique qty>0 > MAX_HOLDINGS(50)` 判超限（賣光釋放名額）。送出鈕 `disabled = hasError || previewIssues.length>0 || trades.length===0`。

### 4.5 目標價
只允許 **current holdings** 代碼；preview 未 confirm 的代碼一律阻擋。無 draft、無延後寫入、confirm 失敗不留 target。

## 5. Single-pipeline proof

`applyCorrections` 全段在 `TradeTab.jsx:334-379` 閉包內，使用的 `parsed/setParsed/holdings/setHoldings/setTradeLog/mergeTradeIntoHoldings/upsertSnapshotHolding/stripDemoSeedHoldings/markUserOwnedHolding/holdingsChangedByUserRef/setUploadSummary/setTab/setImg/setB64` 皆為既有 props → 手動列 append 進 `parsed.trades` 後，**共用同一驗證、同一逐列編輯、同一顆按鈕、同一 apply/replay/cloud pipeline**。不新增任何 commit 函式。`FreeCheckup.jsx` 的變更（P10）只有 3 行 `priceSource` 白名單 + 文案，**不新增管線**。

## 6. Hydration 排序界線（P6）

`useFreeCheckupBootstrap.js:258`：`.order("created_at",{ascending:false})`；delete-all + 單批 insert → 同批 `created_at` 相同 → 順序不決定。
最小修正：`.order("created_at",{ascending:false}).order("trade_date",{ascending:false}).order("trade_time",{ascending:false}).order("id",{ascending:true})`。

**priority 與型別誠實聲明**：primary `created_at`（timestamptz，真時間序）；secondary `trade_date`/`trade_time` 皆為 **`text`**（實測），且既有寫入是非補零 `YYYY/M/D` → **不宣稱日期次序正確**，只宣稱「同批 row 的排序在多次 reload 之間 deterministic（最終由 `id` asc 定案）」。畫面時間排序仍由既有前端邏輯負責，不在本功能修。
欄位重建已證完整：`id/date/time/action/code/name/qty/price/qa` 9 欄（`:260-269`），`recomputeHoldingsAfterDelete` 以 `r.id !== deletedId` 對 uuid 有效 → reload 後逐筆刪除回滾成立。

## 7. UX 命名（blocker 5）

exact 現況：`TradeUploadModal.jsx:40 aria-label="上傳成交"`、`:72` 標題文字 `上傳成交`；`FreeCheckup.jsx:3205,3224 aria-label="上傳成交"`、`:3207` 按鈕字 `＋ 上傳`。

改為：modal 標題與 aria-label → **「新增成交」**；頂欄／底欄按鈕字 → **「＋ 新增成交」**（窄螢幕 ≤380px 以 CSS 縮字級，不改字串，避免兩套文案）；aria-label → 「新增成交」。理由：tab 內同時有「上傳截圖」與「手動輸入」，上層動詞需為兩者的上位詞。tab 標籤：`上傳截圖` / `手動輸入`。

## 8. Exact files（15 檔；production 10 / test 5）

**Production（10）**
| # | 檔 | 新/改 | 理由 |
|---|---|---|---|
| P1 | `src/checkup/lib/stockIdentity.ts` | 新 | `normalizeStockCode`、`isTaiwanStockCode`、`isUsTicker`、`classifyCode`、`qtyRuleFor`；零 import、零 I/O |
| P2 | `src/checkup/lib/chipsRepository.ts` | 改 | 兩函式改 `export … from './stockIdentity'`（行為 0 變更）；避免交易表單耦合 gateway/trafficTracker |
| P3 | `src/checkup/lib/manualTradeEntry.ts` | 新 | `buildManualTradeRow`、`appendToParsed`、`computePreviewIssues`、`formatTradeDate/Time` |
| P4 | `src/checkup/components/freecheckup/ManualTradeForm.jsx` | 新 | 手動輸入 UI，唯一輸出 `onAdd(row)` |
| P5 | `src/checkup/components/freecheckup/TradeTab.jsx` | 改 | segmented control、掛 P4、`previewIssues`、`validateRow` 改用 `qtyRuleFor`、code 變更清空 name、OCR 覆蓋二次確認、目標價限制與文案 |
| P6 | `src/hooks/useFreeCheckupBootstrap.js` | 改 | memos 查詢 tie-break deterministic（§6） |
| P7 | `src/checkup/components/freecheckup/_ui/holdingCard/HoldingCardFooter.tsx` | 改 | `SRC_LABEL` 補 `manual: '手動'`（1 行） |
| P8 | `src/checkup/components/freecheckup/HoldingsHero.tsx` | 改 | `SRC_LABEL` 補 `manual: '手動'`（1 行） |
| P9 | `src/checkup/components/freecheckup/TradeUploadModal.jsx` | 改 | 標題／aria-label → 「新增成交」（2 行） |
| P10 | `src/pages/FreeCheckup.jsx` | 改 | (a) `:2486/:2498/:2560` `priceSource` 白名單 3 行；(b) `:3205/:3207/:3224` CTA 文案 3 行。**無新函式、無新管線** |

**Test（5）**
| # | 檔 | 覆蓋 |
|---|---|---|
| T1 | `src/test/unit/manual-trade-entry.test.ts` | row 白名單 key 集合、`appendToParsed`（shell/append/混合序/清空→null）、`computePreviewIssues`（依序 oversell、US fractional oversell、MAX 49/50/51、賣光釋放）、`qtyRuleFor`（2330 0.5 擋 / AMD 0.5 過 / SOXL 1.25 過）、日期慣例 round-trip |
| T2 | `src/test/unit/stock-code-universe.test.ts` | TW/US regex 與 `chipsRepository.isTaiwanStockCode`、`asset.ts` symbolRegex **parity**（防 drift）；`12` 非法、`00637l→00637L`、`BRK.B` 合法、`TOOLONGX` 非法 |
| T3 | `src/test/unit/manual-trade-form.test.tsx` | name resolve race（2330→AMD 舊 promise 後到）、fallback=code、`nameDirty` 不被覆寫、demo disabled、每欄 `type/inputMode/step/min` 斷言、uppercase 正規化、qty inputMode 依 code 動態切換 |
| T4 | `src/test/integration/manual-trade-pipeline.test.tsx` | manual only／OCR only／mixed；confirm 前 `fetch`+`supabase.from` 0 次；confirm 只跑一次 apply（`setHoldings`/`setTradeLog` 各 1）；tradeLog entry 與 memos payload key 集合不含 `priceSource`；`priceSource:'manual'` 只落在 holding；改 code 清空 name 阻擋；逐列編輯後 issues/disabled 即時更新；OCR 覆蓋二次確認；目標價 orphan → 0 write |
| T5 | `src/test/integration/trade-log-hydration.test.ts` | 同批 `created_at` → 決定性順序；9 欄重建；`recomputeHoldingsAfterDelete` 以 uuid 刪到空 |

## 9. 表單欄位規格

| 欄位 | element | type | inputMode | 其他屬性 | 正規化 |
|---|---|---|---|---|---|
| 買/賣 | segmented button ×2 | — | — | `aria-pressed` | `買進`/`賣出` |
| 股票代碼 | `input` | `text` | `text` | `autoCapitalize="characters"`, `autoCorrect="off"`, `spellCheck={false}`, `maxLength={8}` | `trim().toUpperCase()`；不符 TW/US regex → inline error「代碼格式不正確（台股 4–6 碼，美股 1–5 英文字母）」 |
| 股票名稱 | `input` | `text` | `text` | `maxLength={40}` | `trim()`；空 → fallback=code（送出前補） |
| 股數 | `input` | `text` | TW `numeric` / US `decimal`（依 code 動態） | TW `step="1"`；US `step="any"`；`min` 省略（驗證交給 `qtyRuleFor`） | `Number()` |
| 成交價 | `input` | `text` | `decimal` | `step="0.01"`, `enterKeyHint="done"` | `Number()`，> 0 |
| 日期 | `input` | `date` | — | `max`=今天 | 轉現行 `zh-TW` 非補零慣例（§10） |
| 時間 | `input` | `time` | — | 預設現在 | `HH:mm` |

（一律不用 `type="number"`：iOS 滾輪誤觸與 `e/+/-`。）

## 10. 日期：不改 tradeLogOps

手動 row 用與 `applyCorrections`（`TradeTab.jsx:365-366`）**同一慣例**（`toLocaleDateString("zh-TW")` 非補零 `YYYY/M/D`、`toLocaleTimeString` `HH:mm`），不引入第二種格式 → `replayTradeLog` 排序行為 0 變化，`tradeLogOps.js` 不列入變更。既有「非補零字串比較跨月排序」缺陷為 pre-existing，不修、不放大（手動列預設今天）。

## 11. Atomic rollout / rollback（每階段可 build）

- **Stage A — utils**：P1, P2, P3, T1, T2。無 UI import 指向新 utility。使用者可見行為 0。Revert = 5 檔。
- **Stage B — 功能（atomic）**：P4, P5, P7, P8, P9, P10, T3, T4。P5 是唯一 import P3/P4 者 → revert 後無懸空 import；P7/P8/P9/P10 的小改與 P5 同生共死（`manual` 標籤與 CTA 文案不得單獨留下）。Revert = 8 檔。
- **Stage C — 耐久性**：P6, T5。獨立可 revert。

## 12. Acceptance

功能（local）：manual only／OCR only／mixed；confirm 前 0 mutation；confirm 只走同一 orchestration；reload 後 rows/holdings/log 一致；記錄逐筆刪除回空；US fractional（AMD 0.5、SOXL 1.25）端到端。
工程門檻（全部 exit 0）：
1. selected：`npx vitest run` 上列 5 個新測試檔；
2. **完整回歸：`npx vitest run`（全量，必跑，不可只跑 selected）**；
3. `bunx playwright test e2e/holdings-bsr-unavailable.spec.ts`；
4. `npm run typecheck:edge:chips`；`npm run build`；`npm run check:module-boundaries`。

全量 Vitest 判定規則（不假綠）：
- 若唯一失敗是**已知 `journal-flow-perf.test.ts` timing flakes** → 貼 exact 全量 run 輸出 + 該檔 **isolated rerun** 結果，明列為既有 timing flake，不併入本功能綠燈、不以「全量綠」宣稱。
- 若出現**任何非 timing 的新失敗** → 本輪判定 **BLOCKED**，先修完再繼續，不得帶病交付。

Blob / baseline 契約（持續保留）：`db/r1/p/acl-25.json` 與 `db/r1/p/acl-25.md` 對 baseline `c62a3290b` **byte-identical**；current BSR production / test / Edge typecheck blobs 不得變更（`supabase/functions/tw-chips-detail-v2/index.ts`、`src/checkup/hooks/useChipsBatch.ts`、`src/checkup/hooks/useTwChipsDetail.ts`、`e2e/holdings-bsr-unavailable.spec.ts` 等本功能檔案清單以外的檔一律 diff 為空）。**不 deploy、不 Publish、不動 DB schema。**

**Hosted 驗收（依序）**：① 入口文案顯示「＋ 新增成交」、modal 標題「新增成交」；② 兩 tab（上傳截圖／手動輸入）皆可見可切；③ 輸入 `2330` 有名稱回饋；④ 加入**共同** preview 清單（與 OCR 同一區塊）；⑤ confirm 後持倉 1 檔；⑥ reload 後一致、刪除該筆回空；⑦ 再做 31 檔 `[30,1]` 分批、未開 drawer、390×844；⑧ 驗收後回復 DB baseline。

390×844 鍵盤限制：Chromium 無 OS 軟鍵盤 → 不宣稱「不遮擋」；以 `focus()` + `boundingBox ⊂ visualViewport`、模擬 viewport 844→460 後 CTA 可見、屬性斷言取代；真機截圖列人工驗收。

## 13. Non-goals

不新增第二條 commit 管線；不改 `tradeLogOps.js`；不修金額 `Math.round` 慣例；不修既有非補零日期排序；不動 `CLOUD_SYNC_KEYS` 或其他 storage key；不新增 market/currency 欄位；不改 OCR prompt、Demo fixture、Edge、migration、RLS、cron；不擴張到 TW/US 以外市場；不 deploy、不 Publish。

**HOLDINGS_MANUAL_ENTRY_PLAN_V4_READY**
