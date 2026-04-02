

# ACpay 金流串接 — Prime Mode 完整實作計畫

## 你的情境

### 申請表 (DOC) 中你的設定

- **支付工具**: 信用卡 (Credit Card)、Google Pay、Apple Pay
- **串接模式**: Prime mode (網頁無跳轉模式)
- **支付模式**: Normal (一般交易，非分期)
- **交易模式**: 3DS (3D 安全驗證)
- **請款模式**: 自動請款
- **退款方式**: API、後台
- 網域(含子域名): https://legendflow.tw/

你是 **Prime mode**（無跳轉模式），不是 URL mode。這代表：

- 消費者在**你的頁面**上輸入卡號（透過 ACpay JS SDK 產生 prime token）
- 你的 server 用 prime token 呼叫 ACpay AIO API 完成交易
- **不會**跳轉到 ACpay 頁面

### 你需要的功能（Prime mode）

| 功能 | PDF 章節 | 說明 |
|------|---------|------|
| 通用參數 | 4.1.1 | service=vmj, version=2.0, SHA-256 sign |
| Prime mode | 4.1.3 | prime 參數 + card_holder_phone_number + country_code + 3DS 相關 |
| non-3DS 返回結果 | 4.2 | prime mode 同步返回 pay_result |
| 3DS 返回結果 | 4.3 | 返回 code_url 讓消費者做 OTP 驗證 |
| 3DS callback_url | 4.4 | OTP 驗完導回你的頁面 |
| 3DS notify_url 異步通知 | 4.6 | 後台非同步確認付款成功 |
| 退款 | 7.3 | API 退款（endpoint: API_ROOT2/Refund, service=unified.micropay.refund） |
| 數位簽章 | 10 | SHA-256 簽章 |
| ACPG 定期定額 | XLSX | remember=Y + period_type/period_frequency |
| ACREC 查詢/取消 | XLSX Page 3 | AES/CBC 加密，JSON POST |
| ACREC 通知 | XLSX Page 3 | 每期扣款結果回呼 |

### 你不需要的功能

| 功能 | 原因 |
|------|------|
| URL mode (4.1.2) | 你用 Prime mode，不跳轉 |
| Card mode (4.1.4) | 不直接收卡號，用 SDK 產 prime |
| Bind+CVV (4.1.5.2) | 初次實作用 ACPG 綁卡即可 |
| 分期交易 | 一般交易 trade_mode=0 |
| Apple/Google Pay | 初期不實作 |
| 取消未請款交易 (4.7) | 你用自動請款 |
| 暫停/更新訂閱 | 用取消即可 |
| 電子發票/載具/累點 | 不使用 |

## 流程圖

```text
=== Prime mode + 3DS + 定期定額首次訂閱 ===

使用者              前端 (React)                 create-acpay-order          ACpay AIO
  |                    |                         (Edge Function)              |
  |-- 選方案+付款 ------>|                              |                       |
  |                    |-- 載入 ACpay JS SDK -------->|                       |
  |<-- 顯示卡號輸入表單 ---|  (SDK iframe/fields)        |                       |
  |                    |                              |                       |
  |-- 輸入卡號+CVC ----->|                              |                       |
  |                    |-- SDK.getPrime() ----------->|                       |
  |                    |<-- prime token --------------|                       |
  |                    |                              |                       |
  |                    |-- invoke create-acpay-order ->|                       |
  |                    |   { prime, amount, phone,    |                       |
  |                    |     country_code, name,      |                       |
  |                    |     email, 3DS=Y, remember=Y,|                       |
  |                    |     period_type=m, ... }     |                       |
  |                    |                              |-- POST XML to AIO --->|
  |                    |                              |   (prime mode + 3DS   |
  |                    |                              |    + recurring params) |
  |                    |                              |<-- XML response ------|
  |                    |                              |   status=0, code_url  |
  |                    |<-- { code_url } -------------|                       |
  |                    |                              |                       |
  |<-- 跳轉到 code_url  |  (3DS OTP 驗證頁)             |                       |
  |-- 輸入 OTP -------->|                              |                       |
  |                    |                              |                       |
  |<-- callback_url 導回 |                              |                       |
  |   (query: result_code, pay_result, ...)           |                       |
  |                    |                              |                       |
  |                    |       同時 ACpay POST notify_url:                       |
  |                    |                              |<-- XML notify --------|
  |                    |                              |   verify sign          |
  |                    |                              |   check pay_result=0   |
  |                    |                              |   寫 member_subscriptions|
  |                    |                              |   寫 payment_transactions|
  |                    |                              |-- return "SUCCESS" --->|
  |                    |                              |                       |
  |                    |-- 查 DB 確認訂閱 active ------->|                       |
  |<-- 顯示訂閱成功 ------|                              |                       |


=== Prime mode non-3DS (備用，若未來關閉 3DS) ===

前端                  create-acpay-order          ACpay AIO
  |-- prime+params -->|                              |
  |                   |-- POST XML ----------------->|
  |                   |<-- XML 同步返回 pay_result=0 ---|
  |                   |   直接寫 DB                     |
  |<-- { success } ---|                              |


=== 每月自動扣款 (ACREC 引擎) ===

ACpay 定期定額引擎            acpay-recurring-notify
  |-- non-3DS 自動扣款 ------->|
  |   POST JSON (AES encrypted)|
  |                            |-- AES 解密
  |                            |-- 檢查 payResult=0
  |                            |-- 更新 expires_at
  |                            |-- 寫 payment_transactions
  |                            |-- return { err_code: "0" }
  |                            |
  |-- 扣款失敗 (payResult=1) -->|
  |                            |-- notify-payment-failure
  |   (ACpay 自動重試 2 天)      |
  |   第 3 天失敗 → 訂閱結束       |-- auto-cancel 邏輯


=== 取消訂閱 (ACREC API) ===

前端 (帳號頁)         acpay-recurring-manage       ACpay ACREC
  |-- 點取消 -------->|                              |
  |                  |-- AES 加密 JSON              |
  |                  |-- POST recurring.cancel ----->|
  |                  |   active_date=月底            |
  |                  |<-- AES 加密 JSON 回傳 ----------|
  |                  |   更新 member_subscriptions    |
  |<-- 顯示已取消 -----|                              |


=== 退款流程 ===

管理後台/Edge Function              ACpay AIO
  |-- POST XML 退款 ----------------->|
  |   endpoint: API_ROOT2/Refund      |
  |   service=unified.micropay.refund |
  |   out_trade_no + out_refund_no    |
  |   + SHA-256 sign                  |
  |<-- XML 回傳退款結果 ----------------|
  |   記錄 payment_transactions        |
  |   記錄 audit_logs                  |
```

## 與上一版計畫的核心差異

1. **Prime mode 而非 URL mode**：前端需載入 ACpay JS SDK，在你的頁面上收集卡號產生 prime token
2. **3DS 時仍有跳轉**：Prime mode + 3DS 時，AIO 會返回 `code_url`，消費者需跳轉做 OTP，完成後導回 `callback_url`
3. **non-3DS 時完全同步**：若未來不啟用 3DS，prime mode 會同步返回 `pay_result`，不需 notify_url

## 實作步驟

### Step 1: 設定 Secrets

需要新增：

- `ACPAY_MERCHANT_NO` — 測試用特店代號
- `ACPAY_MERCHANT_KEY` — 測試用特店金鑰（SHA-256 簽章 + ACREC AES 加密共用）

### Step 2: 重寫 `create-acpay-order` Edge Function

- 接收前端傳來的 `prime`, `amount`, `phone`, `countryCode`, `cardHolderName`, `cardHolderEmail`, `planId`, `billingCycle`, `userId`, `origin`
- 組 XML 請求：service=vmj, prime mode 參數, 3DS=Y, remember=Y
- Prime mode 必填欄位：`prime`, `card_holder_phone_number`, `country_code`, `card_holder_name`, `card_holder_email`, `three_domain_secure=Y`, `notify_url`, `callback_url`
- 定期定額參數：`period_type=m`, `period_frequency=1`, `recurring_total_fee`（若填寫則訂閱採用此金額）
- 計算 SHA-256 簽章
- POST 到 `https://aiodir.payloop.com.tw`（測試區 API_ROOT）
- 解析 XML 回應：
  - **3DS**: 返回 `code_url` 給前端跳轉
  - **non-3DS**: 直接處理 `pay_result`，寫入 DB

### Step 3: 重寫 `acpay-callback` → `acpay-notify`

- 接收 ACpay 3DS notify_url 的 XML POST
- 驗證 SHA-256 簽章
- 確認 pay_result=0 且 total_fee 符合
- 防重複處理（檢查 out_trade_no 是否已處理）
- 寫入 `member_subscriptions` + `payment_transactions`
- 回傳純字串 `SUCCESS`

### Step 4: 新增 `acpay-recurring-notify` Edge Function

- 接收 ACREC 定期定額每期扣款通知（JSON, AES 加密）
- AES/CBC/NoPadding 解密（key=特店金鑰去掉`-`後32bytes, IV=nonce_str去`-`前16碼）
- 處理 `order.currentPeriodPayResult`：
  - `0` → 續訂成功，更新 `expires_at`，寫入 `payment_transactions`
  - `1` → 扣款失敗，呼叫 `notify-payment-failure`
- 回傳 `{ err_code: "0", err_msg: "成功" }`

### Step 5: 新增 `acpay-recurring-manage` Edge Function

- 整合 ACREC API：`recurring.find`（查詢）、`recurring.cancel`（取消）
- AES/CBC/ZeroPadding 加密 request
- AES/CBC/NoPadding 解密 response
- 取消時 `active_date` 設為當月月底

### Step 6: 新增 `acpay-refund` Edge Function

- 退款 API 串接，endpoint: `https://aio.payloop.com.tw/Refund`（測試區 API_ROOT2）
- service=`unified.micropay.refund`
- 必填參數：`service`, `version`, `charset`, `sign_type`, `merchant_no`, `out_trade_no`, `nonce_str`, `sign`
- 退款編號 `out_refund_no` 需唯一（不超過20字元）
- SHA-256 簽章
- 與現有 `process-refund` 整合，記錄 `payment_transactions` + `audit_logs`

### Step 7: 刪除 `confirm-acpay` Edge Function

- Prime mode 不需要前端二次確認步驟

### Step 8: 更新前端 `AppCheckout.tsx`

- 載入 ACpay JS SDK（需要確認 SDK CDN URL）
- 在頁面上渲染卡號輸入區域（SDK 提供的安全 iframe）
- 新增持卡人資訊表單欄位：手機號碼（去掉前綴0）、國碼（預設886）、英文姓名、電子郵件
- 點擊付款 → SDK.getPrime() → 取得 prime token
- 呼叫 `create-acpay-order` 傳入 prime + 持卡人資訊
- 若返回 `code_url` → `window.location.href = code_url`（3DS OTP）
- 若同步成功 → 直接顯示訂閱成功
- 處理 3DS callback_url 回傳（query params: result_code, pay_result）

### Step 9: 更新 `supabase/config.toml`

- 新增 `acpay-notify`, `acpay-recurring-notify`, `acpay-recurring-manage`, `acpay-refund` 的 `verify_jwt = false`
- 移除 `confirm-acpay` 區塊

### 技術細節

**SHA-256 數位簽章（PG AIO 用）：**

1. 收集所有非空參數（排除 sign 本身）
2. 按 key 字母排序
3. 拼接為 `key1=value1&key2=value2&...`
4. 末尾加上 `&key=<特店金鑰>`
5. SHA-256 雜湊後轉大寫 hex

**ACREC AES 加密（定期定額管理用）：**

- 金鑰 = 特店金鑰去掉 `-` 後 32 bytes
- IV = `nonce_str` 去掉 `-` 後取前 16 碼
- 演算法：AES/CBC/ZeroPadding, block size 256bit
- 加密後 Base64 放入 `data` 欄位
- 回傳解密用 AES/CBC/NoPadding

**API 端點區分：**

- 測試區 API_ROOT（產生訂單用）：`https://aiodir.payloop.com.tw`
- 測試區 API_ROOT2（退款/查詢用）：`https://aio.payloop.com.tw`
- 測試區 ACREC（定期定額管理用）：`https://rec.payloop.com.tw`
- 正式區 API_ROOT：`https://aiodir.acpay.com.tw`
- 正式區 API_ROOT2：`https://aio.acpay.com.tw`
- 正式區 ACREC：`https://rec.acpay.com.tw`

**out_trade_no 規則：** 不超過 20 字元，英數字，唯一

**本次修正內容（相較上一版）：**

1. Step 2 補齊 prime mode 3DS 必填欄位：`card_holder_name`, `card_holder_email`, `country_code`
2. Step 8 新增持卡人資訊表單欄位（姓名、郵件、手機國碼）
3. 補回遺漏的 Step 6 退款 Edge Function（`acpay-refund`）
4. 補齊 API 端點區分：API_ROOT（產生訂單）vs API_ROOT2（退款/查詢）vs ACREC（定期定額管理），三者為不同 URL
5. 流程圖補齊退款流程區塊
6. Step 9 新增 `acpay-refund` 到 config.toml

