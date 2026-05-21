## 為什麼會出現 `new row violates row-level security policy for table "member_subscriptions"`

你目前選的是「匯款／ATM 轉帳」。`src/pages/Checkout.tsx` L488–507 的 fallback 直接用 **使用者身份** 從前端 `insert` 一筆 `status = 'active'` 的 `member_subscriptions`。但 `member_subscriptions` 的 RLS 只有：

- `Users can view own subscriptions`（SELECT）
- `Users can update own subscription preferences`（UPDATE）
- `Company admins full access`
- `Analysts can view own plan subscriptions`

**完全沒有給一般使用者的 INSERT policy**，所以一定被擋。這條 fallback 是早期 demo 殘留，而且就算放行也是大漏洞 — 使用者按一下「確認付款」就能不付錢直接開通訂閱。

對照 `checkup` 已經有正確流程：`create-checkup-remittance` edge function 用 service role 寫 `remittance_orders(status='awaiting_info')`，會員後續到 `/account/remittance-orders` 補匯款後五碼，admin 在 `confirm-remittance` 才會真正建立 `member_subscriptions`。Expert 訂閱缺了對應的 `create-expert-remittance`。

## 修正計畫

### 1. 新增 edge function `supabase/functions/create-expert-remittance/index.ts`
仿 `create-checkup-remittance`，改寫 expert 欄位：
- 讀 `expert_plans`（`price_monthly` / `price_yearly` / `expert_id` / `is_active` / `review_status='approved'`）算 `basePrice`
- 套用 `originalAmount / discountAmount / discountReason / attribution / upgradeFromSubscriptionId`
- service role insert `remittance_orders`：
  - `product_kind: 'expert_plan'`
  - `plan_id: <expert plan id>`
  - `checkup_plan_id: null`
  - `billing_cycle / amount / original_amount / discount_amount / discount_reason / attribution / status: 'awaiting_info'`
- 回傳 `{ orderId, amount }`

不需要動 `supabase/config.toml`（沿用預設 `verify_jwt`）。

### 2. 改 `src/pages/Checkout.tsx`
- 移除 L488–509 的「Other providers: simulate payment and create subscription directly」整段（含對 `member_subscriptions` 的 insert）。
- 改成：若 `provider.provider_type === 'remittance'`（或非 line_pay/ecpay/acpay 的 fallback），呼叫 `supabase.functions.invoke('create-expert-remittance', { body: {...} })`，成功後 `navigate('/account/remittance-orders?orderId=...')` 並關閉處理中狀態；失敗顯示 `resultDialog`。
- 同時校正按鈕文案：匯款流程不是「付款成功」而是「已建立匯款訂單，請於 24 小時內完成匯款並回填後五碼」。

### 3. 不動的東西
- 不改 RLS（不要給使用者 INSERT `member_subscriptions` 的權限）。
- 不動 `confirm-remittance`、`submit-remittance-info`、`/account/remittance-orders` 既有流程。
- 不動 LINE Pay / ECPay / ACpay 分支。

### 4. 驗證
1. 在 `/checkout/sharkgu/<planId>` 選「匯款／ATM 轉帳」→ 按「確認付款」→ 不該再噴 RLS 錯，應跳到 `/account/remittance-orders` 看到一筆 `awaiting_info` 訂單。
2. 既有 `e2e` 與 `src/test/integration/1.5-payment-subscription-atomicity.test.ts` 仍應通過。
3. ECPay / LINE Pay / ACpay 三條路徑不受影響。

### 風險
- 若有其他 provider_type（測試模式假通道）真的需要「直接開通」，會被一併導向匯款流程。從目前 `payment_providers` 來看只剩 ecpay / line_pay / acpay / remittance 四種，無此風險。
