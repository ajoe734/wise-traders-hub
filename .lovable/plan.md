## 修復目標
使用者訂閱已過期時，進入 `/app/checkout/:slug/:planId` 不應再顯示「您已訂閱此方案」並鎖住付款；應允許續訂付款。仍在有效期限內的訂閱才要被視為已訂閱。

## 實作計畫
1. **統一有效訂閱判斷**
   - 在結帳相關查詢中，將「已訂閱」條件從只有 `status = active` 改為：
     - `status = active`
     - 且 `expires_at` 為空或晚於現在
   - 套用到：
     - `src/hooks/checkout/useCheckoutData.ts`
     - `src/pages/app/AppCheckout.tsx`
     - `src/hooks/checkout/useSubscriptionConfirmation.ts`

2. **修正付款成功後的續訂處理**
   - 後端付款確認目前也只看 `status = active`，可能把已過期但狀態尚未被 cron 更新的舊訂閱當成有效訂閱。
   - 調整 ECPay / LINE Pay / ACpay 的既有訂閱查詢：
     - 有效期內：走延長 `expires_at` 的 renewal path
     - 已過期：不要擋住，讓建立新 ACTIVE 訂閱或重新啟用過期訂閱的流程正確完成
   - 需檢查並修改：
     - `supabase/functions/ecpay-callback/index.ts`
     - `supabase/functions/confirm-linepay/index.ts`
     - `supabase/functions/acpay-notify/index.ts`
     - `supabase/functions/create-acpay-order/index.ts`（同步成功分支）
     - 共用 `supabase/functions/_shared/paymentProcessor.ts` 的防呆更新條件，避免誤把仍有效訂閱標成 expired。

3. **修正 App 帳號頁狀態顯示**
   - `src/pages/app/Account.tsx` 目前只顯示 `status === active` 的訂閱卡，若資料庫 status 還沒被排程改成 expired，畫面會讓過期訂閱看起來仍有效。
   - 改成只有 `status = active` 且 `expires_at > now` 才算有效；過期訂閱由續訂 banner 顯示，避免混淆。

4. **補回歸測試**
   - 新增或擴充 Playwright：模擬 `member_subscriptions` 有 `status=active` 但 `expires_at` 已過期，進入 `/app/checkout/:slug/:planId`：
     - 不出現「您已訂閱此方案」
     - 付款按鈕可點
   - 擴充既有續訂測試：過期訂閱的「立即續訂」仍導到 `/app/checkout/...`，且不被 disabled。

5. **驗證**
   - 跑相關 checkout / renewal E2E，確認：
     - 未過期訂閱仍會擋重複訂閱
     - 已過期訂閱可正常續訂
     - legacy URL redirect 不回歸 404