## 背景

綠界 AIO 不會發給特店任何 Action URL — 官方端點是**所有特店共用的固定網址**：

- 正式：`https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5`
- 測試：`https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5`

特店真正拿到的只有：MerchantID、HashKey、HashIV。目前 PaymentSettings 頁要求填「信用卡專用 Action URL」（必填）和「主 AIO Action URL（選填）」是錯誤設計，會讓你以為要去綠界後台找這兩個值。

## 目標

把 `/company/payments` 的 ECPay 區塊改成「**環境切換 + 三個必填憑證**」，跟綠界實際發給特店的東西一致。Action URL 由系統依環境自動帶。

## 變更內容

### 1. UI 簡化 — `src/pages/company/Payments.tsx`

移除以下兩個欄位：
- 「信用卡專用 Action URL」（`credit_action_url` input）
- 「主 AIO Action URL（選填）」（`api_url` input）

新增一個欄位：
- 「環境」單選（Radio / Select）：`測試 (stage)` / `正式 (production)` — 對應 `value.env`

ECPay 區塊最終欄位：
1. MerchantID
2. HashKey
3. HashIV
4. 環境（stage / production）

連動行為：
- 切換環境時，畫面下方顯示對應的固定 Action URL（唯讀文字，給管理員看），告知這個 URL 已自動套用、不需手動填。
- 移除 `credit_action_url` / `api_url` 的必填驗證、儲存、diff 比對與 audit field list。
- `ecpayOriginal.credit_action_url` 缺漏判斷拿掉，改成檢查 `merchant_id / hash_key / hash_iv / env` 四項。

### 2. 後端：根據 env 自動決定 URL — `supabase/functions/_shared/ecpayCredentials.ts`

調整 `loadEcpayCreds`：
- 仍然向下相容讀 `credit_action_url` / `api_url`（已存在的舊資料不破壞）。
- 但**優先邏輯改為**：若這兩個欄位空 → 依 `env` 字段決定：
  - `production` → `https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5`
  - `stage`（預設）→ `https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5`
- 新增常數 `ECPAY_PROD_AIO`、`ECPAY_STAGE_AIO`。
- `creditActionUrl` 與 `apiUrl` 在新邏輯下會等於 env 對應的官方 URL（除非舊資料還留著自訂值，那就尊重它）。

### 3. 狀態檢查也跟著改 — `supabase/functions/admin-ecpay-status/index.ts`

`apiUrl` 顯示邏輯加上「依 env 自動」分支，避免顯示 stage URL 但 env 標 production 的混淆。

### 4. 資料保留策略

不刪 `payment_settings.value.credit_action_url` / `api_url` — 老資料仍保留作為 override（給未來如果綠界真的發特殊網址的極端情況）。只是 UI 不再暴露、不再要求填。

### 5. 文案調整

PaymentSettings 頁 ECPay 區塊頂部加一段說明：

> ECPay 收單網址由系統依環境自動套用（綠界不會另外發給你 Action URL）。你只需要從綠界後台複製：MerchantID、HashKey、HashIV，並選擇對應環境。

## 不會動到的部分

- `create-ecpay-order` / `create-checkup-ecpay-order` / `ecpay-callback` / `checkup-ecpay-callback`：它們繼續用 `creds.creditActionUrl`，新邏輯下這個值會是正確的官方 URL，無需改 callsite。
- ECPay 三組憑證 secret（env fallback）保留不動。
- 其他金流通道（LinePay / 匯款）不變。

## 驗收

1. `/company/payments` 的 ECPay 區塊只剩 4 個欄位（3 憑證 + 環境）。
2. 切換 stage / production，下方提示文字顯示對應官方 URL。
3. 不填 Action URL 也能存檔、能成功送出 ECPay 訂單（前後台 + 健檢都能下單）。
4. `admin-ecpay-status` 回傳的 `apiUrl` 與選擇的環境一致。
