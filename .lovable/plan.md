# 改用平台內建郵件（免 API key），修復所有 Email 通知

## 背景與根因
- 目前 9 個發信功能（email-push-renewal-reminder、notify-payment-failure、notify-backtest-result、checkup-notify-complete、knowledge-full-audit、subscriber-expiry-teacher-reminder、recover-failed-transactions、recover-abandoned-checkout、admin-manage-users）都直接呼叫 Resend API，使用 `RESEND_API_KEY`。
- 該 key 已失效（Resend 回 401「API key is invalid」），所有會員 Email 通知全部失敗；站內通知與 LINE 不受影響。
- 平台提供內建郵件（Lovable Emails）：key 由平台保管，不需申請/貼任何 key；只需以 legendflow.tw 完成 DNS 驗證（使用者需要在網域管理商加紀錄）。

## 目標
- 所有現有 Email 通知改走平台內建郵件，寄件者維持 noreply@legendflow.tw。
- 使用者不需提供任何 API key；站內通知、LINE 通道行為不變。
- 不回歸：估值資料、排程 110/111、BSR 移除、安全掃描 0 Critical、重複身分提示。

## 步驟

### 1. 設定郵件網域（需要使用者操作一次）
- 顯示平台郵件設定對話框，選 legendflow.tw 作為寄信網域。
- 使用者在網域管理商（如 Cloudflare）加入平台給的 DNS 紀錄（SPF/DKIM）。
- DNS 驗證不需等完成即可繼續 scaffold；驗證通過後自動開始送達。

### 2. 建立郵件基礎設施
- `setup_email_infra`：寄信佇列、寄送紀錄、退訂/抑制名單、處理排程。
- `scaffold_transactional_email`：產生交易信件發送函式與範本骨架。
- 套用品牌樣式（legendflow 品牌：全小寫 wordmark、橘點 #EC662D、Kore-eda 極簡、off-white #F5F3EF、無陰影漸層）。

### 3. 共用發信模組
- 在 `supabase/functions/_shared/` 建立單一 `sendEmail.ts`，封裝內建郵件發送（含失敗回傳 status/body）。
- 9 個現有發信功能逐一改呼叫此共用模組，移除 `RESEND_API_KEY` 依賴與 `api.resend.com` 直連。
- 保留 email-push-renewal-reminder 的三通道獨立成敗語意：站內先送、Email/LINE 各自記錄成功/失敗，audit action 名稱不變（`subscription.renewal_email_sent/failed`），避免管理頁「會員提醒」欄回歸。

### 4. 測試
- 新增/更新合約測試：發信一律走共用模組、程式碼不得再出現 `api.resend.com` 或 `RESEND_API_KEY`、失敗時錯誤訊息含 status/body。
- 既有 renewal-reminder 狀態彙總測試維持通過。

### 5. 部署與正式驗證
- 部署所有改動的 Edge Functions。
- 唯讀檢查 DNS 驗證狀態；若已驗證，用「前台檢視」測試帳號實發一封到期提醒 Email，確認寄送紀錄成功（驗完還原測試帳號資料）。
- 若 DNS 尚未驗證：其餘全部完成並回報「等待 DNS 生效」，不造假成功。

### 6. Gates
- focused tests、tsgo、check:module-boundaries、build 全綠。
- 回報：改動檔案清單、部署版本、測試結果、DNS 驗證狀態、實發結果。

## 不做
- 不處理廖基富起始日方案（A/B/C 仍待使用者決定）。
- 不動 LINE 通道、不動站內通知邏輯。
- 不 Publish。

## 使用者需要做的唯一一件事
在 legendflow.tw 的 DNS 管理介面加入平台提供的紀錄（屆時會列出逐筆紀錄內容）。
