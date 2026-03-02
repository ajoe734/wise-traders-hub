
# LINE Pay Sandbox 付款整合

## 目標
按下「確認付款」後，導向 LINE Pay Sandbox 付款頁面，付完款後回到 `/checkout/zhao-pengbo/...` 頁面，沿用現有的「訂閱成功」AlertDialog。

## 流程

```text
[結帳頁: 確認付款] 
    → 呼叫 Edge Function: create-linepay-order
    → 取得 LINE Pay 付款頁面 URL
    → window.location.href 導向 LINE Pay

[LINE Pay 付款完成]
    → 導回 /checkout/:slug/:planId?transactionId=xxx&orderId=xxx
    → 前端偵測 URL 參數，自動呼叫 Edge Function: confirm-linepay
    → 確認成功 → 建立訂閱 → 顯示「訂閱成功」AlertDialog
```

## 需要儲存的密鑰

- `LINEPAY_CHANNEL_ID`: `2009283010`
- `LINEPAY_CHANNEL_SECRET`: `fde0ea4a5eda7b0d6de04597af5ddc0c`

## 實作內容

### 1. Edge Function: `create-linepay-order`

接收前端請求（planId, billingCycle, slug），執行：
- 產生唯一 orderId
- 計算金額（查詢 expert_plans 表）
- 使用 HMAC-SHA256 簽章呼叫 LINE Pay Sandbox Request API (`https://sandbox-api-pay.line.me/v3/payments/request`)
- 設定 confirmUrl 為 `/checkout/:slug/:planId?linepay=confirm`
- 回傳 LINE Pay 的 `paymentUrl` 給前端

### 2. Edge Function: `confirm-linepay`

接收前端的 transactionId 和 orderId，執行：
- 呼叫 LINE Pay Confirm API (`https://sandbox-api-pay.line.me/v3/payments/{transactionId}/confirm`)
- 驗證 returnCode === '0000'
- 用 service_role_key 寫入 `payment_transactions`（status: paid）
- 用 service_role_key 寫入 `member_subscriptions`（status: active）
- 回傳成功/失敗結果

### 3. 修改 `src/pages/Checkout.tsx`

- 在 `useEffect` 中偵測 URL 是否帶有 `transactionId` 參數
- 如果有，自動呼叫 `confirm-linepay` Edge Function
- 確認成功後，顯示現有的「訂閱成功」AlertDialog（完全沿用）
- 修改 `handleCheckout`：當選擇的 provider 是 `line_pay` 類型時，呼叫 `create-linepay-order` 取得付款 URL 並跳轉

### 4. 更新 `supabase/config.toml`

新增兩個 Edge Function 設定（verify_jwt = false）。

## 技術細節

### LINE Pay 簽章方式
- Nonce: 隨機 UUID
- 簽章字串: `{ChannelSecret}{API_URI}{RequestBody}{Nonce}`
- HMAC-SHA256 → Base64
- Headers: `X-LINE-ChannelId`, `X-LINE-Authorization-Nonce`, `X-LINE-Authorization`

### LINE Pay Sandbox Request API 參數
- amount, currency (TWD), orderId
- packages: 商品明細
- redirectUrls: confirmUrl, cancelUrl

### 不需要新增路由
付款完成後直接回到現有的 `/checkout/:slug/:planId` 頁面，透過 query parameter 觸發確認流程。
