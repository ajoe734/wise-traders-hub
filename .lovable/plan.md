# 持倉數量反覆不一致：根因修復計畫

## 已查明的問題

### 6515 的實際證據

- 正式訊號目前是：買進 20 股、加碼 20 股、加碼 20 股、減碼 50 股；單純用訊號流水相減會得到 **10 股**。
- 正式持倉帳 `trade_records` 現在是：未實現持倉 **50 股**（成本 6,341.80），另有已實現減碼 **50 股**（成交價 6,885）。
- 稽核軌跡顯示兩筆加碼曾被重複套用：2026/08/03 草稿建立 20 → 40、2026/08/06 草稿建立 40 → 60、2026/08/07 發布時又 60 → 80 → 100，2026/08/14 減碼後成為 50。
- 週記管理搜尋列下方由 `computeHoldingSummary()` 從 `expert_signals` 重算，得到 10 股；績效／持倉頁由 `useExpertHoldingsBundle` → `get_expert_capital_status()` 讀正式持倉帳，得到 50 股。
- 已實現的 50 股交易紀錄仍存在；不是整筆消失，而是上方「影子持倉」沒有使用正式帳本。

### 為什麼會反覆發生

1. **雙資料源**：週記頁另算一份持倉，違反既有「Expert holdings 單一資料源」規則。
2. **歷史重複套用**：舊版 trigger 同時在 pending 建立與 published 發布時改持倉；後來雖新增 `signal_trade_applications`，歷史污染仍留在正式帳。
3. **編輯流程仍有破口**：`save_signal_batch(..., _is_editing=true)` 刪除整批訊號再重建；application 紀錄跟著 cascade 刪除，重建後可再次套用。add 的效果合併在原始 open trade，也不一定能隨刪除正確還原。
4. **減碼會靜默截斷**：資料庫以 `LEAST(要求量, 現有持倉)` 執行；要求 50、實際只有 40 仍成功，application 卻記 50，形成新 drift。
5. **現有測試只保護同一 signal_id 重發**，沒有涵蓋跨批次編輯、刪除重建、實際套用量與要求量不一致。
6. Production 全量唯讀比對目前找到 **14 個 symbol drift，6 個達千股以上**；不能只修 6515 畫面。

## 實作範圍

### 1. 先建立可重現的資料庫回歸測試

新增 transaction rollback 測試，完整覆蓋：

- pending 建立 → published 發布 → 重試發布：每個 signal 只能套用一次。
- buy 20 → add 20 → add 20 → trim 50 的逐步 before/after quantity。
- 編輯同一 batch：未變更、改數量、刪除一筆、新增一筆，皆不得重複加碼或遺失已實現紀錄。
- 同標的跨 batch、跨週、同時提交的鎖定與順序。
- trim/sell 超過持倉必須整筆拒絕，不得靜默截斷。
- `signal_trade_applications.applied_quantity` 必須等於真正造成的 quantity delta。
- 張／股 base unit、零股、exit、recall/taken_down、重試與 rollback。

先讓測試對現況變紅，再以同一組測試驗證修復。

### 2. 正式持倉成為所有畫面的唯一資料源

- 移除週記頁以 `computeHoldingSummary(filtered, searchQuery)` 從訊號流水重算持倉的路徑。
- 週記管理頁直接使用既有 `useExpertHoldingsBundle` 的 `rawOpenPositions/openPositions`，依搜尋 symbol 顯示正式未平倉數量與加權成本。
- 數量顯示一律走 `positionQuantity.ts`，資料庫仍存 base unit；禁止再維護 `zhangQty/guQty` 兩個互不換算的影子桶。
- 已實現與未實現頁面維持讀 `trade_records`，驗證同一 symbol 的 open/closed 合計及成本不被 UI 二次重算。

### 3. 重做交易套用的冪等與編輯語意

- 將「是否已套用」與「實際套用結果」鎖在同一個資料庫 transaction，對 expert + symbol 取得鎖後再計算。
- `signal_trade_applications` 記錄 requested quantity、actual delta、before quantity、after quantity 與 effect version；成功改帳後才完成 application。
- pending → published 只改可見狀態，不再改持倉。
- 批次編輯不再用「刪 application 後重建」冒充修改：
  - 未變更交易欄位：完全 no-op。
  - 文字欄位修改：不碰持倉。
  - action／quantity／price／unit 修改或刪除：transaction 內先精確反轉舊 effect，再套用新 effect；任一步失敗則整批 rollback。
- buy/add/trim/sell/exit 使用相同 symbol matching 與同一 open-position 規則。
- oversell、找不到持倉、單位不符直接回明確錯誤碼；禁止 `LEAST()` 靜默截斷。
- recall/taken_down 與 edit 共用同一套 effect reversal，不再各自維護另一份數學。

### 4. 既有資料全量稽核與精確修復

- 對所有 experts／symbols 比對 published/pending application ledger、open/closed `trade_records`、requested/actual delta、base unit、成本、已實現數量與狀態。
- 產生修復前／後差異清單；不以訊號淨額直接覆寫正式帳，避免把老師已確認的實際持倉改錯。
- 6515 以老師確認的正式狀態為準：未實現 50 股、已實現 50 股；補齊可追溯的 adjustment/audit 原因，不捏造缺失訊號。
- 其餘 14 個 drift 逐筆分類為「可由完整 audit trail 確定」或「需人工確認」；只有前者自動修，後者保持不動並列入後台待確認清單。
- 修復操作必須 idempotent、可 dry-run、可重跑，且每筆寫 audit log。

### 5. 驗收

- DB regression：上述生命週期、編輯、重試、併發、oversell、張股、recall 全數通過。
- 前端 unit：週記搜尋 6515 必須顯示正式持倉 **50 股**，不得再顯示訊號淨額 10 股。
- Authenticated Preview：以彥愷週記管理與績效頁交叉驗證 6515；未實現 50、已實現 50、成本與損益一致。
- Production read-back：全量 drift 為 0，或只剩有明確 `manual_review` 原因且未被擅自修改的項目。
- 重跑發布、重新整理、編輯文字、編輯交易內容各一次；數量不得再次變動。
- 檢查所有相關檔案、RPC、trigger、Edge Function、路由與表欄位，不只抽樣 6515。

## 不變量

```text
一個 signal effect 只能成功套用一次
application.actual_delta = trade_records 真正變化量
所有持倉畫面 = 同一份 authoritative holdings bundle
編輯／重試／發布不得改變未修改的交易效果
要求減碼量 > 可用持倉 => 全部失敗，不得截斷
任何資料修復都有 dry-run、audit log、可重跑
```