# 刪除持倉時提示：記手動賣出，或單純刪除

## 背景
目前確認視窗只有一條路：「只移出目前持倉，不建立賣出交易」。使用者（人類是懶惰的）常常其實是「已經賣掉了」，直接刪除會讓已實現損益漏掉這一筆。要在確認視窗就讓他二選一。

## 機制現況（已查證）
- 單純刪除：`deleteHoldingWithExclusion` 寫排除標記 + 更新持倉，不碰任何交易資料（`src/checkup/lib/holdingDeleteService.ts`）。
- 記賣出：交易紀錄 replay（`applyTradeEntryToHoldings` → `mergeTradeIntoHoldings`）在賣出股數 = 持股股數時會自動把該檔移出持倉，已實現損益由交易紀錄計算，會正確入帳。既有提交管線是 `TradeTab.applyCorrections`（`setHoldings` + `setTradeLog` 前插 + 既有 effect 自動存雲端 `checkup_trade_memos`）。
- 賣出後**不需要**排除標記：replay 結果股數 0，`reconcileHoldingsWithTradeLog` 不會讓它復活；之後手動重新買進就是正常新部位。

## 修改內容

### 1) 純函式層（`src/checkup/lib/holdingDeleteService.ts` 或新檔）
- 新增 `buildSellTradeEntry({ code, name, qty, price, now })`：輸出與 `TradeTab.applyCorrections` 同形狀的交易列（`action: '賣出'`、`qty`、`price`、`date`/`time` 用 `zh-TW` 非補零慣例、`priceSource: 'manual'`）。
- 驗證：`qty` 必須 > 0 且 ≤ 持股股數（允許部分賣出，部分賣出時該檔不會被移出，僅扣股數）；`price` > 0；賣出股數 > 持股 → 回 `oversell` 錯誤，不得送出。

### 2) 確認視窗改造（`src/checkup/components/freecheckup/HoldingDeleteDialog.tsx`）
- 標題不變；內文改成兩個明確選項（兩顆按鈕，非 radio）：
  - 「**記賣出並刪除**」：說明「會在你的交易紀錄記一筆賣出，已實現損益與績效會計入這筆」。選這條時展開兩個可編輯欄位：股數（預填全部持股）、價格（預填目前市價），並顯示預估賣出金額。
  - 「**只刪除持倉**」：保留現行文案（不建立賣出交易、不動交易紀錄與資金、重新加入會恢復）。
- 兩顆都是一次點擊完成；「取消」不動任何資料。
- testid：`holding-delete-sell`、`holding-delete-remove-only`、賣出欄位 `holding-delete-sell-qty` / `holding-delete-sell-price`。

### 3) 正式頁接線（`src/pages/FreeCheckup.jsx`）
- `handleDeleteHolding(code, opts)` 擴充第二參數 `{ withSell, qty, price }`：
  - `withSell` → 用 `buildSellTradeEntry` 產生賣出列，走與 `applyCorrections` 相同的寫入：`setHoldings` 用 `mergeTradeIntoHoldings`（stripDemoSeedHoldings + markUserOwnedHolding 同現行）、`setTradeLog` 前插交易列、`holdingsChangedByUserRef.current = true`；交易紀錄雲端同步交給既有 `saveTradeLogToCloud` effect。成功後 toast「已記錄賣出並移除持倉」。
  - 無 `withSell` → 現行 `deleteHoldingWithPersistence` 不變。
- `HoldingsDetailPanel` 的 `onDeleteHolding` prop 簽名同步為 `(code, opts)`；`onConfirm` 把選擇與欄位值傳入。`HoldingsTab` / `HoldingsWorkbench` 只是傳遞，簽名不變。

## 範圍與隔離
- 不改單純刪除的既有語意與排除標記機制；不動 BSR、估值、行事曆管線。
- 記賣出**只**走前端既有交易紀錄管線，不直接寫任何資料庫帳務表。

## 驗證
- 單元：`buildSellTradeEntry` 形狀/日期格式/驗證（含 oversell、部分賣出）。
- 整合：dialog 三條路（記賣出、只刪除、取消）＋ 記賣出後持倉移除、tradeLog 前插、排除標記不寫入；更新既有 wiring 測試與 harness render 測試。
- 全量測試、`tsgo`、module-boundaries、build；手機 E2E `e2e/freecheckup-card.spec.ts` 回歸。
- 不發布；完成後回報，再由使用者決定部署。
