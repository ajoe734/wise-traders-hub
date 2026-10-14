# 產業分類總覽頁（管理後台）

## 目標
新增一個管理後台頁面，列出全部 125 個細分產業的名稱與固定代碼，並並排顯示每個產業對應的同業名單，方便你逐組確認「產業 ↔ 代碼 ↔ 同業名單」的對應關係。

## 畫面內容
- 路由：`/company/industry-codes`，僅管理員（company_admin）可進，從管理後台首頁加入口連結。
- 依 13 個大類（半導體 SEMI、電子零組件 ECMP…）分區，每區列出該大類的細分產業。
- 每個產業一列顯示：
  - 產業代碼（如 `SEMI-09`）、產業名稱、別名（舊名稱）、是否已停用（retired 標記）。
  - 對應同業名單：成員股票代號＋公司名稱，標記來源——「人工加入」（include）、「人工排除」（exclude，顯示為被排除）、「自動補齊」（市值前 12）。
  - 該產業在全市場對應到的股票總數（2,531 檔對應結果）。
- 跨產業自訂組（目前僅 ODM／伺服器 COMP-01）單獨一區顯示，標明「人工自訂組」。
- 頂部提供搜尋框：可依產業名稱、代碼、股票代號或公司名稱篩選，快速跳到某一組。
- 純唯讀檢視頁，不提供編輯；要調整名單仍由你告訴我後改資料檔。

## 技術做法
- 新頁面 `src/pages/company/IndustryCodes.tsx`，資料全部來自現有靜態檔，不新增後端：
  - `src/checkup/data/industryCodes.json`（125 個代碼、別名、retired）
  - `src/checkup/data/valuationPeerGroups.json`（124 組名單、include/exclude/custom）
  - `src/checkup/data/stockIndustry.json`＋`companyProfiles.json`（股票代號 → 公司名稱、產業、市值）
- `App.tsx` 加 lazy route `/company/industry-codes`（`ProtectedRoute requiredRole="company_admin"`），管理後台首頁加入口。
- 樣式遵循現有後台頁與 Kore-eda 極簡規範（off-white、無陰影、日期 YYYY/MM/DD）。
- 新增單元測試：頁面用的純組裝函式（產業 → 代碼 → 名單 → 股票名稱的對應、retired 過濾、自訂組歸類），放在 `src/test/unit/`。

## 驗收
- 管理員開 `/company/industry-codes` 能看到 13 大類、125 個產業代碼與 124 組同業名單，非管理員進不去。
- 搜尋「緯創」或「3231」能跳到 ODM／伺服器組。
- 型別檢查、相關單元測試通過；手機寬度（390px）下表格可橫向捲動不破版。
- 僅預覽，不發布正式站。
