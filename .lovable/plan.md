# 交流投顧金鑰清單（單一文件）

## 要做的事
把交流投顧需要填的所有金鑰整理成**一份**文件 `交流投顧-金鑰清單.html`，存到 Files，手機和桌機都能點連結。

金鑰的值是加密存放的，我讀不到，所以文件裡**不會有值**。每個金鑰會寫清楚怎麼拿到它。

## 內部位置（先講清楚限制）
本專案所有金鑰都在同一個地方：**Cloud → Secrets**（或 More → Settings → Secrets）。文件每列都會附這個內部入口。
但那裡只會列出名稱，**看不到值**，連你和我都讀不到；Lovable 不提供匯出或顯示金鑰值的連結。所以要拿到真正的值，還是只有兩條路：
- 能自己產生的（CRON_SHARED_SECRET 等）：新專案按 Generate，不需要舊值。
- 第三方發的（FinMind、綠界、LINE 等）：只能回到原服務後台重新複製，外部連結保留當備用。

## 文件內容
每個金鑰一列，四欄：
1. 金鑰名稱（可一鍵複製）
2. 填法：按 Generate／直接打字／到服務後台複製／不用填
3. 取得連結（可直接點）
4. 共用風險：沒差／共用額度／會出錯

分組：
- **按 Generate**：CRON_SHARED_SECRET、DATA_UPSERT_API_KEY、REPORT_API_KEY 等
- **直接打字**：SITE_URL（填新專案網址）、E2E_ALLOW_SIMULATED_PURCHASE、E2E_TEST_EMAIL／PASSWORD（新專案重新註冊）、GA4_PROPERTY_ID、GA4_MEASUREMENT_ID
- **到後台複製**：FINMIND_TOKEN、FINNHUB_API_KEY、ANTHROPIC／GEMINI／OPENROUTER、RESEND_API_KEY、ECPAY_*（附測試值頁）、LINEPAY_*、LINE_LOGIN_*、PLATFORM_LINE_*、GA4_SERVICE_ACCOUNT_JSON
- **不用填**：系統自動帶的項目

最上方放風險提醒：綠界與 LINE Pay 用正式值會真扣款；LINE、GA4 共用會混到正式站資料；FinMind 共用每日額度。

## 技術細節
- 先讀本專案完整的金鑰名稱清單，一個都不漏，再對照程式找出每個金鑰的用途。
- 存為 `/mnt/documents/交流投顧-金鑰清單.html`，不動專案程式。
- 完成後轉成圖片檢查手機與桌機版面。
