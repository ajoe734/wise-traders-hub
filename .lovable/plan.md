# HOLDINGS_MANUAL_ENTRY_PLAN_READY

- current HEAD: `cacc6df5032860b179a2e4b8bd8153083fd301dc`
- `git status --porcelain`: 空（本輪 0 mutation，只做 `rg` / `code--view` 唯讀）

## A. 重現與根因

### A1. 現行 exact components / functions / files

| 環節 | 檔案 : 位置 |
|---|---|
| 「＋上傳」CTA → modal | `src/checkup/components/freecheckup/TradeUploadModal.jsx`（整檔；L90 只是把 `TradeTab` 包起來） |
| Trade tab 本體 | `src/checkup/components/freecheckup/TradeTab.jsx`（644 行） |
| 上傳 dropzone / file input | `TradeTab.jsx` L226-271（`#fi` input、`processFile` / `processFiles` / `parseShot`） |
| OCR preview 逐筆編輯 | `TradeTab.jsx` L312-494（`validateRow` L314-329、`updateTrade` L389、`removeTrade` L394） |
| preview → 寫入 | `TradeTab.jsx` `applyCorrections` L334-377 |
| 主解析寫入路徑 | `src/pages/FreeCheckup.jsx` L2660-2730（MAX_HOLDINGS 檢查 L2662-2682、`setHoldings` L2695、`setTradeLog` L2699） |
| 持倉合併 | `FreeCheckup.jsx` `mergeTradeIntoHoldings` L2444、`upsertSnapshotHolding` L2536 |
| 交易備忘三問 | `TradeTab.jsx` L533-562 + `FreeCheckup.jsx` `submitMemo` L2755-2800 |
| 目標價區塊（問題所在） | `TradeTab.jsx` L567-636，state `tpCode/tpFirm/tpVal` 在 `FreeCheckup.jsx` L246-248，傳入 L3436-3438 |
| 交易 replay / 刪除回滾 | `src/checkup/lib/tradeLogOps.js`（`replayTradeLog`、`recomputeHoldingsAfterDelete`）、`src/checkup/lib/holdings.js` `applyTradeEntryToHoldings` L225 |
| 逐筆刪除 UI | `src/checkup/components/log/LogPanel.jsx` L49-54、L319-320、L552-604 |
| cloud sync（交易紀錄） | `FreeCheckup.jsx` `saveTradeLogToCloud` L891-925 + debounce effect L926-934（寫 `checkup_trade_memos`） |
| cloud sync（持倉等 pf-* key） | `FreeCheckup.jsx` `save()` + `CLOUD_SYNC_KEYS`（L78 import，`resetAll` L2882-2911 列出全 key） |
| 上限常數 | `src/pages/_freeCheckup/constants.jsx` L282 `MAX_HOLDINGS = 50`、L278 `SNAPSHOT_IMPORT_ACTION` |

### A2. 為何輸入 2331 沒有新增個股（根因）

**不是 input bug，是功能不存在。** `TradeTab.jsx` L567-636 的區塊標題就是「手動更新目標價」，其 `handleAddTarget`（L569-593）只呼叫 `setTargets(...)`，把 `{firm, target, date}` 寫進 `pf-targets-v1`。它**完全不觸碰** `setHoldings` / `setTradeLog`，所以：

- 輸入 2331 後按鈕仍 disabled（L625 `disabled={!tpCode.trim()||!tpVal}` — 只填代碼、沒填目標價 → 永遠不能按），使用者以為「代碼沒被接受」。
- 就算填了目標價成功送出，`pf-holdings-v2` 不變 → 持倉仍 0 檔，且 `targets[2331]` 因為沒有對應持倉，在持倉頁完全不會被渲染 → **零回饋**。
- 該區塊只在 `!parsed && !img` 時顯示（L568），在空狀態時它是 modal 內**唯一**可輸入的表單，視覺上（`card` + 左側 teal border，與其他卡片同款）與「新增持倉」無法區分 → 嚴重誤導。

逐項 input bug 檢查結果：

- focus / controlled value：`tpCode` 是受控 input（L603），值有進 state，無 focus 竊取，無 re-mount 重置。**無 bug**。
- mobile keyboard：`tpCode` **缺 `inputMode`**（OCR preview 的 code 欄 L449 有 `inputMode="numeric"`），iOS 會跳英數鍵盤 —— 次要缺陷，但非根因。
- validation：目標價表單**無任何 inline error**，只有 disabled 按鈕，不會說明為什麼不能按。
- disabled button：確認為上述 L625 條件。
- 股票名稱解析：目標價路徑**完全沒有**名稱解析；`resolveStockName`（`src/lib/stockNameResolver.ts` L71）在此路徑未被呼叫。
- 代碼正規化：此路徑用 `tpCode.trim()`（L571），**沒有** `normalizeStockCode`（`src/checkup/lib/chipsRepository.ts` L451）→ `00637l` 會存成小寫，與籌碼查詢的 canonical 形式不一致。

### A3. 文案承諾但功能不存在

- `src/checkup/components/holdings/HoldingsTable.jsx` L433：空狀態文字「**上傳成交記錄或手動新增**」— 承諾手動新增，全站無此入口。（`HoldingsTable` 僅被 `HoldingsPage`/harness 使用，非主線 FreeCheckup，但文案仍是假承諾。）
- `src/pages/_freeCheckup/constants.jsx` L281 註解：「觸發點：截圖解析新增 / **手動新增** / 批次匯入」— 註解描述了不存在的觸發點。
- `src/checkup/components/freecheckup/HoldingsEmptyState.tsx` L121：「支援 JPG / PNG 截圖，**無需手動輸入**」— 目前這句是**唯一誠實**的，但補了手動流程後必須改寫，否則反向誤導。
- `src/checkup/components/trade/TradePanel.jsx` L976 / L1074 有「手動更新目標價 / 手動更新財報」，屬 `TradePage` 舊路徑，**同樣沒有手動成交**。

**結論：全站零手動成交路徑，且至少 2 處文案／註解承諾了它。**

## B. 資料流圖（目標狀態）

```text
                     ┌──────────── 上傳成交 modal (TradeUploadModal) ───────────┐
                     │  [ 截圖辨識 ]  [ 手動輸入 ]   ← 同一工作流的兩個 tab      │
                     └───────┬──────────────────────┬───────────────────────────┘
                             │                      │
        processFile/parseShot│                      │ ManualTradeForm.submit()
        (checkup-parse Edge) │                      │  normalizeStockCode
                             │                      │  resolveStockName / fallback
                             ▼                      ▼  inline validate
                    ┌────────────────────────────────────────┐
                    │  parsed.trades[]  ← 共用 preview 清單    │  (source: 'ocr' | 'manual')
                    │  逐列可編輯 / 可刪除 / validateRow      │  ★ 0 DB write 到此為止
                    └───────────────┬────────────────────────┘
                                    │ applyCorrections()（既有，唯一提交點）
                                    ▼
       stripDemoSeedHoldings → mergeTradeIntoHoldings ×N → setHoldings
                                    │
                                    └→ setTradeLog（新 entry，append-only，不覆蓋）
                                             │
              ┌──────────────────────────────┴───────────────────────────┐
              ▼                                                          ▼
   save('pf-holdings-v2') + checkup_storage upsert          saveTradeLogToCloud (debounce 800ms)
                                                            → checkup_trade_memos delete+insert
              │
              ▼
   刪除回復：LogPanel 逐筆刪除 → recomputeHoldingsAfterDelete → replayTradeLog（全量重算）
             或 resetAll() → 全 pf-* key 歸零
```

## C. 分階段 plan

### Stage 1 — 目標價區塊語意分離（最小、可獨立上）

**檔案：** `src/checkup/components/freecheckup/TradeTab.jsx`（僅 L567-636 區塊）

- 標題改為「研究報告目標價（不會新增持倉）」，加一行說明；卡片改用 teal 淡底 + `lbl` 附註，與成交表單視覺明確分層。
- `tpCode` 加 `inputMode="numeric"`、`aria-label`、`aria-describedby`。
- 送出時走 `normalizeStockCode(tpCode)`。
- 加 inline error（代碼空白／目標價非正數／該代碼不在持倉 → 提示「目標價會保存，但需先有此持倉才會顯示」）。
- 位置移到手動輸入 tab 的**下方次要區**，不再是空狀態唯一表單。

**Acceptance：** 空持倉時輸入 2331 有明確「這裡不會新增持倉，請用上方手動輸入」提示；`pf-holdings-v2` 不變。
**Rollback：** 單檔 revert L567-636。

### Stage 2 — 手動成交表單（核心）

**新增檔案（2 個）：**
- `src/checkup/components/freecheckup/ManualTradeForm.jsx` — 純表單，state 內含，`onAddRow(row)` 往上拋。
- `src/checkup/lib/manualTradeEntry.ts` — 純函式：`buildManualTradeRow(input)`、`validateManualTradeInput(input, { holdings, previewRows, maxHoldings })`。**不碰 DB、不碰 React**。

**修改檔案（2 個）：**
- `src/checkup/components/freecheckup/TradeTab.jsx` — 在 dropzone 之上加 `[截圖辨識][手動輸入]` segmented control（`role="tablist"`），手動 tab 渲染 `ManualTradeForm`；`onAddRow` → `setParsed(prev => ({...prev, trades:[...(prev?.trades||[]), row]}))`，**重用既有 preview 清單與 `applyCorrections`**。TRADE_TAB_PROP_SCHEMA 需同步（`freecheckup-tab-prop-schema.test.ts` 會擋）。
- `src/pages/_freeCheckup/constants.jsx` — 若需新增 `MANUAL_ENTRY_SOURCE` 常數與修正 L281 註解。

**欄位與 canonical 重用：**

| 欄位 | 來源 canonical function | 缺口 |
|---|---|---|
| 代碼正規化 | `normalizeStockCode`（`chipsRepository.ts` L451） | 無 |
| 市場推斷 TW/US | `isTaiwanStockCode` 規則 `/^\d{4,6}[A-Z]?$/`（同檔）；US 走 `inferMarket`（`src/lib/signalFieldResolvers.ts` L50） | `inferMarket` 目前只服務 signal 域 → **最小新增**：`manualTradeEntry.ts` 內薄包裝，不複製規則 |
| 名稱解析 | `resolveStockName` / `resolveStockNames`（`src/lib/stockNameResolver.ts` L71/L112） | 無。解析失敗 → 名稱欄可手填，fallback 顯示「未知名稱（可自行輸入）」，**不阻擋** |
| 買/賣 | 沿用字面 `"買進"/"賣出"`（`mergeTradeIntoHoldings` L2459 判斷） | 無 |
| 股數 | TW 整股/零股：正整數；US fractional：`Number.isFinite && > 0`，依市場切換 `validateRow` 的整數要求 | **`TradeTab.jsx` L325 現行硬性 `Number.isInteger` 需依市場放寬**（唯一 preview 驗證改動） |
| 幣別 | 由市場推斷，沿用 holdings row 既有欄位；不新增 schema | 無 |
| 成交價 | `> 0` | 無 |
| 日期 | 沿用 `toLocaleDateString("zh-TW")` 格式（`FreeCheckup.jsx` L2703 / `tradeLogOps.js` 排序依賴此字串） | 無。手動日期需輸出**同格式**，否則 replay 排序錯亂 |
| 手續費/稅 | `mergeTradeIntoHoldings` 已支援 optional `fee` / `total_cost`（L2450-2451） | 無。手動表單設為 optional，留白即 `null` |

**inline error 覆蓋（`validateManualTradeInput`）：** 空代碼、格式不符 `^[0-9A-Za-z]{2,8}$`、qty ≤ 0 / NaN / TW 非整數、price ≤ 0 / NaN、日期非法或未來日、空白名稱且解析失敗、賣超（`qty > 現有持倉 + preview 內同碼淨買`）、合併後代碼數 > `MAX_HOLDINGS`（沿用 `FreeCheckup.jsx` L2662-2682 同一算式）、未知代碼（warning 非 error）。

**重複成交：** 同碼同日同價再加一列 → **新增新 row**，不去重、不覆蓋；`replayTradeLog` 會照時間序逐筆套用（`tradeLogOps.js` L20-32）。

**Auth：** 手動 tab 與截圖 tab 共用 `isDemo` 判斷（`TradeTab.jsx` L172-188 既有登入提示），demo 未登入時渲染同一提示，**不新增任何 bypass**。

**Acceptance：** 加入 N 列 preview 期間 DB write = 0（以 network 斷言）；按一次「套用修正並更新持倉」後 holdings/tradeLog/cloud 三者一致。
**Rollback：** 刪 2 新檔 + revert `TradeTab.jsx` 的 tab 區塊。

### Stage 3 — 390x844 RWD 與可及性

**檔案：** `ManualTradeForm.jsx` + `TradeTab.jsx`（僅 style / a11y）

- 遵守專案憲法：任何 `fontSize >= 32` 必須有 className + `≤560px` / `≤380px` media query（本表單刻意全部 < 32，避免碰 L2965/L4745 字面 `<style>` 硬合約）。
- 「加入清單」CTA 置於表單內、非 sticky 底欄，鍵盤彈出時不遮擋；modal 本身已 `overflowY:auto`（`TradeUploadModal.jsx` L48）。
- 每個 input 有 `<label>` 或 `aria-label`；error 用 `aria-describedby` + `role="alert"`；tablist 支援方向鍵。

**Acceptance：** 執行既有 `scripts/check-freecheckup-rwd.mjs` 與手機三斷點回歸清單（560/390/380）+ `bunx playwright test e2e/freecheckup-card.spec.ts`。
**Rollback：** style-only revert。

## D. 測試與驗收

### D1. 新增/修改 exact files（總計 8 檔，無大範圍 refactor）

新增：
1. `src/checkup/components/freecheckup/ManualTradeForm.jsx`
2. `src/checkup/lib/manualTradeEntry.ts`
3. `src/checkup/lib/__tests__/manualTradeEntry.test.ts`
4. `src/checkup/components/freecheckup/__tests__/ManualTradeForm.test.tsx`
5. `src/test/integration/manual-trade-pipeline.test.tsx`
6. `e2e/manual-trade-entry.spec.ts`

修改：
7. `src/checkup/components/freecheckup/TradeTab.jsx`（tab 切換 + 目標價區塊 + `validateRow` 市場感知）
8. `src/pages/_freeCheckup/constants.jsx`（註解 L281 + 常數）

附帶文案修正（1 行級）：`HoldingsTable.jsx` L433、`HoldingsEmptyState.tsx` L121。

### D2. Component/unit
輸入 2330 顯示「台積電」；解析失敗顯示 fallback 且可手填；各 inline error 狀態；加入 preview 後清單 +1 且表單清空；**送出前 `supabase.from` 呼叫數 = 0**；刪除 preview row 後清單 -1。

### D3. Integration
manual + OCR row 混合於同一 `parsed.trades`；一次 `applyCorrections` 後 `pf-holdings-v2` / `pf-log-v2` / `checkup_trade_memos` payload 三者一致；`recomputeHoldingsAfterDelete` 逐筆刪回空 = `replayTradeLog([])` baseline。

### D4. Canonical normalization cases
`2330`→TW 整股；` 00637l `→`00637L` TW 槓桿 ETF；`AMD`→US（允許 fractional）；`SOXL`→US ETF；以及 invalid `12`／duplicate 同碼同日／sell-over-position／第 51 檔觸發 MAX_HOLDINGS。

### D5. Hosted acceptance
QA account（`b3502f0a…`, company_admin）baseline 已證全空 → 用手動輸入建 31 檔不同普通台股 → **不開任何 drawer**，觀測 `tw-chips-detail-v2` 為 `[30, 1]` 兩次 POST → 390x844 layout / console / network 截圖 → 逐筆刪除或 `resetAll()` 回空 baseline 並複驗 `checkup_storage` 9 key 全空。

### D6. 全量回歸
`npx vitest run`、`npm run typecheck:edge:chips`、`npm run build`、`npm run check:module-boundaries`、changed-files diff 與 `db/r1/p/acl-25.*` 對 baseline byte-identical。**既有 `journal-flow-perf.test.ts` timing flake 需單獨標註，不冒充本次結果。**

## E. Non-goals（明確排除）

- 不改 `checkup_storage` / `checkup_trade_memos` schema、不新增 migration、不動 RLS/GRANT。
- 不改 `tw-chips-detail-v2` 或任何 Edge function。
- 不寫任何繞過 `applyCorrections` 直接改 holdings 的捷徑。
- 不改 DEMO fixture 的 20 檔上限、不新增 auth bypass / 測試後門。
- 不重構 `FreeCheckup.jsx` 主體（本計畫對該檔 0 行改動）、不動 L2965/L4745 字面 `<style>` 硬合約。
- 不做 CSV/批次貼上匯入（後續獨立議題）。
- 不改既有 OCR 解析、備忘三問、目標價資料結構。
