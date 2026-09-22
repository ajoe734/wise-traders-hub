# 改用平台內建郵件寄信

目前 9 個發信功能都直連外部寄信服務 Resend，而那把金鑰已失效（回「API key is invalid」），所以所有 Email 全部寄不出去。改成走平台內建郵件後，金鑰由平台保管，你不必再申請或保管任何金鑰。

## 你要先做的一步

在寄信設定裡選 **legendflow.tw** 當寄件網域，它會給你幾筆 DNS 紀錄，拿去 legendflow.tw 的網域管理商（例如 Cloudflare）加上去。這一步沒完成，信一樣寄不出去——這是 Email 的硬規定：必須證明網域是你的，否則 Gmail／Yahoo 會拒收。

完成後我接手，其餘全部由我做完。

## 我要做的事

1. 建立寄信基礎設施：送信佇列、重試、寄送紀錄、退信與退訂名單。
2. 寫一個共用發信模組，所有功能都從這裡寄信，寄件者維持 legendflow.tw。
3. 把 9 個發信功能全部改接過去：
   - 訂閱到期提醒（會員端）
   - 訂閱到期提醒（通知老師）
   - 付款失敗通知
   - 未完成結帳挽回
   - 失敗交易補救
   - 健檢完成通知
   - 回測結果通知
   - 知識庫稽核報告
   - 後台帳號管理相關信件
4. 三通道各自獨立成敗的邏輯不變：站內通知照舊先送，Email 改走內建郵件，LINE 不動；審計紀錄的名稱與同日不重複發送的規則維持原樣。
5. 部署後實際寄一封到期提醒做驗證，並在管理頁的「會員提醒」欄看到 Email 從「失敗」變「已送出」。

## 不會動到的部分

- 站內通知與 LINE 推播的既有行為
- 提醒排程時間（T-7／T-3／T-1／到期當日／過期 24 小時）
- 估值三把尺、個股分類、持倉抽屜已移除的關鍵分點區塊

## 技術細節

- `email_domain--setup_email_infra` 建立 pgmq 佇列（`auth_emails`／`transactional_emails`）、`email_send_log`、`suppressed_emails`、`email_unsubscribe_tokens`、`process-email-queue` Edge Function 與其排程；不手寫 SQL 建佇列。
- 新增 `supabase/functions/_shared/mailer.ts`：單一發信入口（收件者、主旨、HTML、idempotency key、purpose=transactional），內含退訂／退信檢查與錯誤回傳格式，前台不需鏡像。
- 改造範圍（移除 `RESEND_API_KEY` 與 `https://api.resend.com/emails` 直呼）：`email-push-renewal-reminder`、`subscriber-expiry-teacher-reminder`、`notify-payment-failure`、`recover-abandoned-checkout`、`recover-failed-transactions`、`checkup-notify-complete`、`notify-backtest-result`、`knowledge-full-audit`、`admin-manage-users`。
- 既有 `audit_logs` 的 `renewal_email_sent` / `renewal_email_failed` 事件名稱與 idempotency 維持不變，管理頁狀態欄不需改動資料來源。
- 新增合約測試：禁止程式碼再出現 `api.resend.com` 或 `RESEND_API_KEY`；發信一律經由 `_shared/mailer.ts`。
- 驗收：focused tests、tsgo、check:module-boundaries、build 全綠；部署 9 個函式後實發一封並讀 `email_send_log` 確認 `sent`。
