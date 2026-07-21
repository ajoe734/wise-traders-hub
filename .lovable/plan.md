## 目標

驗證 07/14–07/20 匯出的老師週記，尤其是彥愷（sharkgu），不會再出現：
1. 4576 大銀微系統 出現「賣出 1 張」
2. 買賣單位錯亂（同一標的張／股混雜相加不合理）

## 目前資料快照（已查）

彥愷本週訊號（無 trim/sell 4576）：
- 07/17 `buy 4576 1 張`
- 07/17 `add 4576 999 股`
- 之前被誤發的 pending `trim 4576 1 張` 已在上一輪 DELETE
- `trade_records` 只留 1 筆 open 1000 股

理論上匯出檔應該：
- 4576 段落只有 buy + add
- 「本週總計」對 4576 走「依單位分列」呈現：買進 `1 張` 與 `999 股`；賣出應為 0
- 全檔不會出現 `賣出.*4576.*1 張`

## 驗證步驟（build 時執行）

### 1. 用實際資料跑一次匯出（read-only）
- 讀取 `src/lib/journalsExport.ts`，理解 `buildJournalMarkdown` / 本週總計組裝邏輯（尤其單位分列判斷）
- 寫一支 Node 腳本 `/tmp/verify-yankai-export.mjs`：
  - 直連 DB，撈 07/14–07/20 彥愷全部 published signals
  - 呼叫 `buildJournalMarkdown` 產生 markdown
  - 對輸出做斷言：
    - `不含` 任何 `賣出.*4576` / `4576.*賣出` / `4576.*(trim|sell|exit)`
    - `不含` `賣出股數：1 張`（4576 段落）
    - 4576 段落只有 2 筆 row（buy 1 張 + add 999 股）
    - 「本週總計」4576 走分列或不出現於賣出段

### 2. 跑既有回歸測試
- `bunx playwright test e2e/journals-export-dual-unit-totals.spec.ts e2e/journals-export-quantity-unit-default.spec.ts e2e/journals-export-weekly-totals.spec.ts e2e/journals-export-weekly-totals-whitespace-tolerance.spec.ts`
- 確認 fixture-based dual-unit / 單位 fallback 全綠

### 3. 新增針對彥愷案例的 fixture E2E
- 在 `src/pages/JournalsExportHarnessEntry.tsx` 加一個 `je-export-yankai-4576` 按鈕，資料 = 上述 3 筆真實訊號（buy 1 張 + add 999 股，無 sell/trim/exit）
- 新增 `e2e/journals-export-yankai-4576-no-sell.spec.ts`：
  - 匯出檔中 4576 段落 rowCount=2、無「賣出」關鍵字
  - 「本週總計」的 `總賣出股數` 段落內不出現 `4576` 或 `1 張`（因為本標的無賣出）
  - 「總買進股數（依單位分列）」若有出現，`張:1` 與 `股:999` 兩者必須都在（來自 buy+add 合併統計，若程式把 add 視為買進累計）
    - 若 `add` 不併入買進，改斷言：「總買進」= `1 張`，且 add 999 股單獨列在明細不影響總計
  - 這條由 `journalsExport.ts` 的實際規則決定，先讀原始檔再定案

### 4. 報告
- 貼出：
  - 實際 markdown 摘錄（4576 段落 + 本週總計段落）
  - 三份 e2e 測試結果（既有 + 新增）
  - 明確結論：4576 已無「賣出 1 張」，單位錯亂已消失

## 不做

- 不改 `journalsExport.ts` 產生邏輯（除非驗證發現真的產出錯誤才進 build 修）
- 不動彥愷 DB 資料
