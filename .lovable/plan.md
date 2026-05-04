## 目的
讓你（company_admin）按一個按鈕就能看到目前綠界（ECPay）是接到**測試店**還是**正式店**，以及 API URL 是 stage 還是 production，**不洩漏 HashKey/HashIV**。

## 改動

### 1. 新增 Edge Function `admin-ecpay-status`
- 驗證呼叫者是 `company_admin`
- 讀 `payment_settings.ecpay_credentials` 與環境變數 `ECPAY_MERCHANT_ID` / `ECPAY_API_URL` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV`
- 回傳：
  - `merchantId_masked`：商店編號只露末四碼（例：`****0132`）
  - `apiUrl`：完整網址（這個本來就是公開的，可以露）
  - `env`、`isStageUrl`、`isOfficialTestStore`（merchantId === `2000132`）
  - `hasHashKey` / `hasHashIV`：只回 true/false
  - `verdict`：`TEST — 測試環境` 或 `PRODUCTION — 正式環境`

### 2. 在 `/company/payment-settings` 加一個「綠界環境檢查」區塊
- 一顆按鈕「檢查目前綠界設定」
- 點下去呼叫 `admin-ecpay-status`，把結果（masked merchantId、apiUrl、verdict）顯示在卡片上

## 不會做
- 不會印出完整 MerchantID、HashKey、HashIV
- 不會修改任何金流邏輯

## 預期結果
你按下按鈕後立刻知道：
- 商店編號末四碼是不是 `0132`（=綠界官方測試店）
- API URL 是 `payment-stage.ecpay.com.tw`（測試）還是 `payment.ecpay.com.tw`（正式）
- 一句話結論：測試 or 正式
