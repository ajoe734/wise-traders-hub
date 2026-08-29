# HOLDINGS_MANUAL_ENTRY_PLAN_V3

只規劃。本輪 0 production 寫檔、0 DB、0 deploy、0 Publish。

## 0. V2 被推翻的地方（逐條回應）

| # | 裁決 | V3 處置 |
|---|---|---|
| 1 | 禁止 `commitManualTrades` | **刪除該構想**。稽核證明 `applyCorrections` 整段定義在 `TradeTab.jsx:334-379`（閉包內、只用 props），提交管線完全在 TradeTab；手動列直接 append 進 `parsed.trades`，共用同一 `validateRow`／逐列編輯／同一顆按鈕。**`FreeCheckup.jsx` 0 行變更** |
| 2 | 目標價不得有 draft | 收斂為「只允許 current holdings 代碼」，非持倉一律阻擋。無 draft、無 atomicity 問題 |
| 3 | `pf-log-v2` 水合不得列 non-goal | 已做 hydration proof（§4），發現**排序不決定性**，納入最小修正 + reload test |
| 4 | tradeLogOps 排序是使用者可見行為 | **不改**。手動 row 沿用現行日期慣例（§5），不擴範圍 |
| 5 | 測試檔要 exact | 3 個 exact 測試檔 + 1 個 hydration 測試檔（§7），無「檔4或3」 |
| 6 | inputMode 不可一概 numeric | 逐欄表（§6） |
| 7 | parsed shell / mixed JSON / 覆蓋行為 | §3 給 source-based contract |
| 8 | 每次編輯都要重跑 replay | `previewIssues` 由 `parsed.trades` 直接 derive，每 render 重算（§3.4） |
| 9 | name 與 code 必須同步 | §6.3 規則 + 測試 |
| 10/11 | acceptance / 檔案標註 | §7、§8 |

## 1. Corrected single-pipeline flow

```text
[截圖 OCR] ──checkup-parse──┐
                            ├──► parsed.trades (單一 preview 清單, 保留插入順序)
[手動輸入表單] ─buildRow──┘        │
                                    │ 逐列編輯 updateTrade / removeTrade（既有）
                                    │ validateRow（既有，逐列）
                                    │ previewIssues（新增，sequential replay，每 render 重算）
                                    ▼
                       applyCorrections()  ← 唯一 commit（TradeTab.jsx:334，不新增第二支）
                                    ▼
        setHoldings(mergeTradeIntoHoldings / upsertSnapshotHolding) + setTradeLog(...)
                                    ▼
  FreeCheckup 既有 effect：save("pf-log-v2") → localStorage + checkup_storage
                            debounce 800ms → checkup_trade_memos delete+insert
```

手動列與 OCR 列在 `parsed.trades` 內**無法區分**（同 shape），所以 `applyCorrections` 不需要認得 manual origin — 這是不新增第二條管線的關鍵。UI 只用一個**不寫進 row 的**旁路 `Set<index>` 標示來源徽章？**不做**：index 會因刪除而位移。改為：不顯示來源徽章（來源對提交無語意）。

## 2. 為什麼 `FreeCheckup.jsx` 不需要改（逐行）

- `parsed` / `setParsed` 已是 TradeTab props（`TradeTab.jsx:23,88`）→ 手動列可自行 append。
- `holdings` / `setHoldings` / `setTradeLog` / `mergeTradeIntoHoldings` / `upsertSnapshotHolding` / `stripDemoSeedHoldings` / `markUserOwnedHolding` / `holdingsChangedByUserRef` / `setUploadSummary` / `setTab` 全部已在 `applyCorrections` 閉包可見（`TradeTab.jsx:352-377`）→ commit 路徑完整。
- `targets` / `setTargets`（目標價）已在 TradeTab 現有目標價區塊使用 → 驗證改在 TradeTab 內。
- 雲端寫入由 `FreeCheckup.jsx:925-934` 的 `[tradeLog]` effect 自動觸發，與呼叫端無關。
→ 結論：**FreeCheckup.jsx 不列入變更清單**。

## 3. Exact contracts

### 3.1 parsed shell（`parsed === null` 時建立）

與 `checkup-parse` response 消費形狀相容（`FreeCheckup.jsx:2739-2742` 讀 `trades` / `targetPriceUpdates` / `note`；`TradeTab.jsx:312,495` 讀 `parsed?.trades`、`parsed.targetPriceUpdates`）：

```json
{ "trades": [], "targetPriceUpdates": [], "note": "" }
```

建立後立即 append 手動 row。已有 OCR rows → 直接 `[...prev.trades, row]`（append 到尾端，混合順序即插入順序，永不重排）。

### 3.2 manual row（與 OCR row 逐欄同構，不新增欄位）

OCR row（AI 契約 `constants.jsx:242` + `FreeCheckup.jsx:2742` 補 action）：
```json
{"action":"買進","code":"2330","name":"台積電","qty":1000,"price":1085,
 "market_price":1090,"amount":1085000,"total_cost":1085000,"fee":1545}
```
manual row（缺值一律 `null`，不是 `undefined`、不是 `0`）：
```json
{"action":"買進","code":"2330","name":"台積電","qty":1000,"price":1085,
 "market_price":null,"amount":null,"total_cost":null,"fee":null,
 "date":"2026/8/29","time":"10:32"}
```
mixed `parsed.trades` 範例（OCR 兩列 + 手動一列 append）：
```json
{"trades":[
  {"action":"買進","code":"2454","name":"聯發科","qty":1000,"price":1420,"market_price":1435,"amount":1420000,"total_cost":1420000,"fee":2022},
  {"action":"賣出","code":"2330","name":"台積電","qty":2000,"price":1102,"market_price":1100,"amount":2204000,"total_cost":null,"fee":3141},
  {"action":"買進","code":"00637L","name":"元大滬深300正2","qty":5000,"price":32.15,"market_price":null,"amount":null,"total_cost":null,"fee":null,"date":"2026/8/29","time":"10:32"}
 ],"targetPriceUpdates":[],"note":""}
```

**manual origin 不會被 `validateRow` 判錯**（`TradeTab.jsx:314-329` 逐條核對）：`name` 非空 ✓、`code` 符合 `/^[0-9A-Za-z]{2,8}$/`（`2330`/`00637L`/`AMD`/`SOXL` 皆通過）✓、`qty` 正整數 ✓、`price` > 0 ✓、`action ∈ {買進,賣出,持倉匯入}` ✓。`date`/`time`/`market_price:null` 皆不被 `validateRow` 檢查，且 `applyCorrections`（`:339`）用 spread `...t` 原樣保留，`mergeTradeIntoHoldings`（`FreeCheckup.jsx:2459`）以 `Number(trade?.market_price) || price` 兜底 → null 安全。

四案例 builder 輸出（只列差異欄）：

| | code | name 來源 | qty | price | type（commit 後由 `inferHoldingType`） |
|---|---|---|---|---|---|
| 台積電 | `2330` | resolver | 1000 | 1085 | 股票 |
| 正2 ETF | `00637L`（` 00637l `→upper） | resolver | 5000 | 32.15 | ETF |
| AMD | `AMD` | 使用者填，fallback `AMD` | 30 | 132.5 | 股票 |
| SOXL | `SOXL` | 使用者填，fallback `SOXL` | 100 | 21.44 | 股票 |

無 `market` / `currency` / `source` 欄位：checkup domain 全域沒有這兩個概念（`holdings.js:163` 產出欄位、OCR 契約皆無），唯一分類器是 `inferHoldingType(code,name)`（`constants.jsx:284`）。

### 3.3 preview 生命週期（選定行為，避免誤提交舊資料）

| 事件 | 行為 |
|---|---|
| 移除最後一列 | `setParsed(null)`（沿用既有 `removeTrade` 的 `TradeTab.jsx:394` 語意，統一由 helper 判斷 `trades.length===0 → null`），preview 區整段消失，按鈕不存在 |
| `img` / `b64` | 手動列**不動** `img`/`b64`；若清單只剩手動列而 `img` 仍在，維持顯示（使用者可再解析）。commit 時走既有 `setImg(null); setB64(null); setParsed(null)`（`:374`）一次清乾淨 |
| 已有未 confirm 清單時再上傳 OCR | **明確採「覆蓋 + 二次確認」**：先跳 confirm dialog「目前有 N 筆未寫入的資料，重新解析會清空並改用新截圖結果」。使用者確認才 `setParsed(newResult)`。理由：靜默 merge 會讓使用者把上一張截圖的舊資料一起提交 |
| commit 失敗（`hasError`） | 既有行為：toast + 早退，`parsed` 完整保留（`:335-338`） |

### 3.4 previewIssues（sequential replay，每 render 重算）

```
previewIssues = computePreviewIssues(holdings, parsed.trades)
```
純函式（`manualTradeEntry.ts`），在 `rowErrors` 之後同層 derive，因此**逐列編輯 action/code/qty、刪除、順序變動後自動重算**（無 state、無 memo key 風險）：
- 以 `Map<code, qty>` 由 current holdings 起算，**依陣列順序**逐列套用；`賣出` 且 `qty > map.get(code)` → `{index, code, reason:'oversell'}`（先賣後買不被倒灌放行）。
- 全部套完後 `unique codes where qty>0 > MAX_HOLDINGS(50)` → `{index:null, reason:'max_holdings', overBy}`；賣到 0 的代碼釋放名額。
- `持倉匯入` 列以 upsert 語意覆寫 qty（對齊 `upsertSnapshotHolding`）。
- 送出鈕：`disabled = hasError || previewIssues.length > 0 || trades.length === 0`；錯誤列以 `index` 高亮，訊息與現有欄位錯誤同一區塊呈現。

### 3.5 目標價（0 orphan、0 draft）

- 提交條件：`code ∈ current holdings codes`（`holdings` prop）。
- 不在持倉 → 按鈕 disabled + inline「此代碼不在你的持倉中，請先完成『手動新增成交』並寫入後再設定目標價」。preview 內尚未 confirm 的代碼**也一律阻擋**。
- 無 draft、無延後寫入、confirm 失敗不會留下 target。
- 區塊 UI 調整：加標題「目標價（僅供參考，不會新增持倉）」、移到手動輸入表單下方且視覺分隔。

## 4. Hydration proof（唯讀證據）

`src/hooks/useFreeCheckupBootstrap.js:253-276`：

1. **exact 初始化來源**：`supabase.from("checkup_trade_memos").select("*").order("created_at",{ascending:false})`。有 row → 用它；`data` 為空或 throw → `loadScopedLocal("pf-log-v2", [], userId)`。demo 模式 → `DEMO_TRADE_LOG`（`:162`）。`pf-log-v2` 只是 fallback，**不在 `CLOUD_SYNC_KEYS`** 不影響主路徑。
2. **欄位重建**（`:260-269`）：`id ← row.id`(uuid，非原 client numeric id)、`date ← trade_date`、`time ← trade_time`、`action`、`code`、`name`、`qty:Number`、`price:Number`、`qa:Array||[]` → **9 欄全數重建**。刪除回滾用 `recomputeHoldingsAfterDelete(tradeLog, deletedId)`（`tradeLogOps.js:39`）以 `r.id !== deletedId` 過濾，uuid 一樣可用 → **reload 後逐筆刪除回滾成立**。
3. **順序不決定性（唯一缺口）**：`saveTradeLogToCloud`（`FreeCheckup.jsx:891-914`）是「delete all + 單批 insert」，整批 `created_at` 取同一 statement 時間 → `order('created_at' desc)` 對同批 row **無法決定順序**。`replayTradeLog`（`tradeLogOps.js:20`）先比 `date time` 再比 `String(id)`，因此只有「同日同分鐘同代碼」才會受影響，但**畫面列表順序**每次 reload 都可能不同。
   → **最小修正（Compatibility Fix B，1 檔 1 行）**：查詢改為 `.order("created_at",{ascending:false}).order("trade_date",{ascending:false}).order("trade_time",{ascending:false}).order("id",{ascending:true})`。純讀取排序，不動 schema／寫入／其他 key。
4. 資料流圖已於 §1 修正為雙寫（`checkup_storage` + `checkup_trade_memos`）。

## 5. 日期：不改 tradeLogOps

- `applyCorrections`（`TradeTab.jsx:365-366`）對缺 `date` 的列已補 `new Date().toLocaleDateString("zh-TW")`。
- 手動 row 的 `date` 由**同一慣例**產生（`zh-TW` 非補零 `YYYY/M/D`，helper `formatTradeDate()` 直接呼叫 `toLocaleDateString("zh-TW")`，日期選擇器回傳值也轉成同慣例），`time` 用 `toLocaleTimeString("zh-TW",{hour:'2-digit',minute:'2-digit'})`。
- 因此**不引入第二種日期格式**，`replayTradeLog` 排序行為 0 變化 → 不列 Compatibility Fix、不改 `tradeLogOps.js`。
- 已知**既有**缺陷（本功能不新增、不修）：`replayTradeLog` 對非補零日期採字串比較，`2026/8/9` 會排在 `2026/8/29` 之後。列為 pre-existing，不擴範圍。手動列日期預設今天且不提供跨月回填 → 不放大此缺陷。

## 6. 表單欄位規格

| 欄位 | element | type | inputMode | 其他 | 正規化 |
|---|---|---|---|---|---|
| 買/賣 | 兩顆 segmented button | — | — | `aria-pressed` | 直接寫 `買進`/`賣出` |
| 股票代碼 | `input` | `text` | `text` | `autoCapitalize="characters"`, `autoCorrect="off"`, `spellCheck={false}`, `maxLength={8}`, `pattern="[0-9A-Za-z]{2,8}"` | `trim()` + `toUpperCase()`（`00637l`→`00637L`，`amd`→`AMD`） |
| 股票名稱 | `input` | `text` | `text` | `maxLength={40}` | `trim()`；空 → fallback = code |
| 股數 | `input` | `text` | `numeric` | `step="1"`, `min="1"`, `enterKeyHint="next"` | 整數；`validateRow` 已擋非整數 |
| 成交價 | `input` | `text` | `decimal` | `step="0.01"`, `min="0"`, `enterKeyHint="done"` | `Number()`；> 0 |
| 日期 | `input` | `date` | — | `max`=今天 | 轉 `zh-TW` 慣例字串（§5） |
| 時間 | `input` | `time` | — | 預設現在 | `HH:mm` |

（`type="number"` 一律不用：iOS 滾輪誤觸與 `e/+/-` 問題；改 `text` + inputMode，驗證交給既有 `validateRow`。）

### 6.3 名稱／代碼同步規則
- code 變更 → `seq += 1`，非同步 `resolveStockName`（`src/lib/stockNameResolver.ts:71`）；只有 `seq === mySeq` 才寫回（過期 promise 丟棄）。
- 使用者手動編輯 name → `nameDirty = true`，之後 resolver **不覆寫**。
- **加入 parsed 之後**再改 code（preview 逐列編輯）：`updateTrade` 若 `patch.code` 與原值不同，同時把該列標記 `nameStale`；UI 顯示「代碼已變更，請確認名稱」，且 `validateRow` 之外加一條 preview 檢查 → 阻擋提交，直到使用者確認／改名。杜絕 `code=AMD / name=台積電`。
- 解析中（loading）不阻擋「加入清單」；未回來就 fallback = code。

## 7. Exact files（10 檔，逐一標註）

**Production（6）**
| # | 檔 | 新/改 | 理由 |
|---|---|---|---|
| P1 | `src/checkup/lib/stockIdentity.ts` | 新 | 純識別工具 `normalizeStockCode` / `isTaiwanStockCode`，零 import、零 I/O |
| P2 | `src/checkup/lib/chipsRepository.ts` | 改 | 上述兩函式改 `export { … } from './stockIdentity'`；行為 0 變更。理由：現檔 import `./gateway` + `@/lib/trafficTracker`，交易表單不得耦合籌碼 repository |
| P3 | `src/checkup/lib/manualTradeEntry.ts` | 新 | 純函式：`buildManualTradeRow`、`appendToParsed`、`computePreviewIssues`、`formatTradeDate/Time` |
| P4 | `src/checkup/components/freecheckup/ManualTradeForm.jsx` | 新 | 手動輸入 UI（§6），唯一輸出是呼叫 `onAdd(row)` |
| P5 | `src/checkup/components/freecheckup/TradeTab.jsx` | 改 | segmented control（截圖／手動）、掛 P4、`previewIssues` derive、`nameStale`、OCR 覆蓋二次確認、目標價區塊限制與文案 |
| P6 | `src/hooks/useFreeCheckupBootstrap.js` | 改 | Compatibility Fix B：`checkup_trade_memos` 查詢加決定性次要排序（§4.3） |

**Test（4）**
| # | 檔 | 新 | 覆蓋 |
|---|---|---|---|
| T1 | `src/test/unit/manual-trade-entry.test.ts` | 新 | row shape ×4、`appendToParsed`（null shell／append／混合順序／清空→null）、`computePreviewIssues`（依序 oversell ×6、MAX 49/50/51、賣光釋放）、`normalizeStockCode`、日期慣例 round-trip |
| T2 | `src/test/unit/manual-trade-form.test.tsx` | 新 | JSX component：name resolve race（2330→AMD 舊 promise 後到）、loading/error/fallback/nameDirty、demo disabled、每欄 `type`/`inputMode`/`step`/`min` 斷言、uppercase 正規化 |
| T3 | `src/test/integration/manual-trade-pipeline.test.tsx` | 新 | 真實 TradeTab：manual only／OCR only／mixed；confirm 前 `fetch`+`supabase.from` 0 次；confirm 只呼叫一次 `applyCorrections` 路徑（`setHoldings`/`setTradeLog` 各 1）；逐列編輯後 issues 與 disabled 即時更新；`nameStale` 阻擋；OCR 覆蓋二次確認；目標價 orphan → 0 write |
| T4 | `src/test/integration/trade-log-hydration.test.ts` | 新 | 模擬 memos 回傳（同批 created_at）→ 斷言 9 欄重建、決定性順序、`recomputeHoldingsAfterDelete` 以 uuid 刪到空 |

不碰：Edge function、migration、RLS、cron、Demo fixture、`CLOUD_SYNC_KEYS`、`FreeCheckup.jsx`、`tradeLogOps.js`、BSR 修正檔、`db/r1/p/acl-25.*`。

## 8. Atomic rollout / rollback（每階段都能 build）

- **Stage A — utils**：P1, P2, P3, T1。無任何 UI import 指向新 utility（P4/P5 尚未存在）。使用者可見行為 0 變化。Revert = 4 檔。
- **Stage B — 功能（atomic）**：P4, P5, T2, T3 同一批。P5 是唯一 import P3/P4 的地方 → revert Stage B 後不會留下懸空 import；Stage A 的 utility 成為無人使用但可 build 的模組。Revert = 4 檔。
- **Stage C — 耐久性**：P6, T4。獨立於 A/B，可單獨 revert（回到「同批 created_at 順序不決定」的既有狀態）。

## 9. Full acceptance（全部要綠，否則 BLOCKED）

功能：manual only／OCR only／manual+OCR mixed 各一輪；confirm 前 0 mutation（network + supabase spy）；confirm 只走 `applyCorrections`；reload 後 rows/holdings/log 一致；記錄逐筆刪除回空。
工程門檻：`npx vitest run src/test/unit/manual-trade-entry.test.ts src/test/unit/manual-trade-form.test.tsx src/test/integration/manual-trade-pipeline.test.tsx src/test/integration/trade-log-hydration.test.ts` exit 0；current BSR 目標 spec `e2e/holdings-bsr-unavailable.spec.ts` exit 0；`npm run typecheck:edge:chips` exit 0；`npm run build` exit 0；`npm run check:module-boundaries` exit 0；`db/r1/p/acl-25.json|.md` 對 baseline byte-identical。
Hosted：31 檔 `[30,1]` 分批、未開 drawer、390×844 RWD、驗收後回復 DB baseline。
**既有全量 Vitest timing flakes（`journal-flow-perf.test.ts`）獨立列示**，不併入本功能綠燈，也不以「全量綠」冒充。
390×844 鍵盤限制：Chromium 無 OS 軟鍵盤 → 不宣稱「不遮擋」；以 `focus()` + `boundingBox ⊂ visualViewport`、模擬 viewport 844→460 後 CTA 可見、屬性斷言取代，真機截圖列人工驗收。

## 10. Non-goals

不新增第二條 commit 管線；不改 `FreeCheckup.jsx`；不改 `tradeLogOps.js` 排序；不修 `CLOUD_SYNC_KEYS`／其他 storage key；不引入 market/currency 欄位；不改 OCR prompt 與 Demo fixture；不動 Edge／migration／RLS／cron；不 deploy、不 Publish。

**HOLDINGS_MANUAL_ENTRY_PLAN_V3_READY**
