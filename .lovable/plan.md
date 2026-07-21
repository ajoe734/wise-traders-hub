## 目標
把 `/company/analysts` 相關操作從「每次不同錯誤」改成穩定、可追蹤、可回歸：帳號設定、重設密碼、寄重設信、建立/補齊分析師、LINE 設定、列表資料都要有一致錯誤處理與測試覆蓋。

## 已確認的現況
- 畫面截圖的錯誤來自前端顯示 `Edge Function returned a non-2xx status code`，目前 UI 沒把後端回傳的實際原因穩定攤開。
- `/company/analysts` 會呼叫：
  - `update-analyst-credentials`：讀 Email、改 Email、立即重設密碼、寄重設信。
  - `create-analyst`：建立或補齊分析師。
  - 直接資料表操作：分析師列表、啟停用、LINE channel 設定。
- `update-analyst-credentials` 目前「寄重設信」仍依賴 `RESEND_API_KEY`，但此專案規範是非 Auth 類寄信走內建寄信系統；這是會產生非 2xx 的高風險路徑。
- 目前 `CompanyAnalysts` 測試只覆蓋建立成功與基本列表，沒有覆蓋帳號設定三個 tab、非 2xx 解析、LINE 設定失敗、建立/補齊失敗一致訊息。

## 修復範圍
1. **統一後台函式錯誤解析**
   - 新增/整理一個前端 helper，專門解析函式錯誤：優先讀後端 JSON `error` / `message`，再讀函式錯誤 message，避免只顯示籠統的非 2xx。
   - 套用到 `/company/analysts` 內所有函式呼叫與資料寫入錯誤：建立分析師、補齊、帳號設定、LINE 設定、啟停用。

2. **修正分析師密碼重設寄信路徑**
   - 移除 `update-analyst-credentials` 內對 `RESEND_API_KEY` 的硬依賴。
   - 改成使用 Lovable Cloud 內建交易型寄信函式或內建 Auth reset 流程可用的穩定路徑。
   - 保留立即重設密碼功能，但錯誤要回傳明確中文原因與 `requestId/correlationId`。

3. **後端函式錯誤可追蹤化**
   - `update-analyst-credentials` 與 `create-analyst` 的每個失敗分支都回傳一致格式：`error`、`code`、必要時 `request_id`。
   - 避免 catch 直接把原始例外丟給前端；敏感資訊不外洩，但要足夠讓管理員知道是權限、帳號不存在、Email 重複、密碼強度、寄信設定或資料庫寫入失敗。
   - 保留既有 `withLogging`，必要時補足關鍵 action 的 structured log。

4. **前端 UX 收斂**
   - Dialog 內顯示可讀錯誤，不再只用 toast 一閃而過。
   - 操作中禁用按鈕，結束後一定恢復 loading 狀態。
   - 成功後重新整理 `company-experts` 與相關列表 cache，避免剛改完又看到舊資料。

5. **完整回歸測試**
   - 補 `CompanyAnalysts` component tests：
     - 帳號設定讀取 Email 成功/失敗。
     - 立即重設密碼成功/弱密碼失敗/後端非 2xx 顯示明確原因。
     - 寄重設信成功/寄信不可用時顯示明確原因。
     - 建立分析師失敗不關 dialog、不清表單。
     - LINE 設定讀取/儲存失敗顯示明確原因。
   - 補或更新 Edge Function tests：
     - `update-analyst-credentials` action whitelist。
     - 無授權、非 company_admin、找不到 expert、LINE virtual email、弱密碼、寄信路徑錯誤格式。

## 技術細節
- 不改資料庫結構，除非驗證中發現 audit log 權限或欄位缺漏；若需要 migration，會只針對必要欄位/政策處理。
- 不新增更多 UI 功能，只修穩定性、錯誤訊息、可追蹤性與測試。
- 不處理其他後台頁面，範圍鎖定 `/company/analysts` 與它直接依賴的函式。

## 驗證標準
- 使用截圖中的「Benny — 帳號設定 → 立即重設」同一路徑，不應再只看到 `Edge Function returned a non-2xx status code`。
- 所有分析師管理操作失敗時都要顯示具體中文原因。
- 相關單元/整合測試通過。
- 若能用已登入 session 端到端驗證，會實際打一次帳號設定流程並回報成功/失敗與 request id；若沒有可用登入 session，會明確標示 E2E 驗證限制。