## 問題

Checkout 頁面三處「沙盒」字樣是 hardcoded，與後端實際付款環境完全脫鉤。

DB `payment_settings.ecpay_credentials.env = "production"`，綠界其實會真的扣款，但前台一律顯示「沙盒測試模式」，使用者誤以為退回沙盒。

## 方案

讓前台讀取後端真實 env，僅在 `env !== "production"` 時才顯示沙盒提示。

### 1. 後端揭露 env 給前台

新增一個極輕量公開查詢點：擴充既有的 `admin-ecpay-status` 不行（需 admin 權限），改在 `payment_settings` 增加可公開讀取的 view，或更簡單：在 `payment_providers.config` 寫入 `env` 欄位，由 RLS policy "Anyone can view active providers" 直接帶給前台。

採後者，遷移內容：

```sql
update payment_providers
set config = jsonb_set(coalesce(config, '{}'::jsonb), '{env}', '"production"')
where provider_type = 'ecpay';
```

之後 ECPay 設定維運時，DB 兩處 (`payment_settings.ecpay_credentials.env`、`payment_providers.config.env`) 必須同步更新；可在 `admin-ecpay-status` 或設定 UI 內補一個 trigger / 寫入同步邏輯（本次先以遷移修一次正式環境）。

### 2. 前台依 env 切顯示

- `src/pages/Checkout.tsx`：從 `providers` 找出 selected provider 的 `config.env`，推導 `isSandbox = env !== 'production'`，傳給兩個子元件。
- `src/pages/_checkout/PaymentMethodPicker.tsx`：`isSandbox` 為 true 才顯示 `🧪 目前為沙盒測試模式`。
- `src/pages/_checkout/OrderSummaryCard.tsx`：badge (line 95-97) 與按鈕字 (line 114) 改為條件式；production 時 badge 不顯示，按鈕字改回「確認付款」。

### 3. 驗證

- 在 preview（後端為 production）登入 `/checkout/sharkgu/ab1d8e55-...`，badge 與「（沙盒）」字樣應消失。
- 將 `payment_providers.config.env` 暫改為 `stage` 驗證會重新顯示，再改回 `production`。
- 不動 ACpay / LINE Pay / 匯款的既有行為。

## 不會改動

- 真實付款流程、edge function 的 mode 解析邏輯（`ecpayCredentials.ts`）皆不變。
- 只調整前台顯示與一次資料修正。
