## 背景

目前所有金流（ECPay / LINE Pay / 匯款）都是**單次扣款**——沒有任何自動續訂能力。但資料庫和 UI 卻把訂閱當「自動續訂」在賣（`auto_renew=true` 預設、Account 顯示「自動續訂」、checkout 文案寫「每月自動續訂」），造成「設了但不會生效」的鬼故事：

- ECPay/LINE Pay 訂戶到期後 `expire-subscriptions` 直接標 `expired`，沒有人去扣下一期
- `auto_renew` 欄位對非 ACpay 用戶是個謊言旗標
- `line-push-renewal-reminder`、`auto-cancel-failed-renewals` 都是針對「應該自動扣但失敗」的場景設計，跟現實對不上
- ACpay 入口已經移除，所以 ACREC 那條路線也用不到了

你的決策：**承認現實 → 不自動扣，過期即斷，無寬限期，但提早提醒讓用戶主動回來重刷一次。**

---

## 目標

1. 全站文案、UI、資料模型都誠實標示「**手動續訂**」，不再誤導用戶以為會自動扣款
2. 到期前 7 / 3 / 1 天主動提醒（LINE + Email + App 內紅點），帶**一鍵續訂連結**回原方案 checkout
3. 過期當下立即斷權（沒寬限期），但保留 30 天「快速續訂」入口，續訂走全新一筆 checkout、續期從新付款日重新起算（或接續前到期日，二選一—見技術細節）
4. 移除 / 停用所有跟「自動扣款失敗重試」相關的死碼，避免後台噪音

---

## 範圍盤點（不准偷懶 — 完整列表）

### 前端（4 個檔）
- `src/pages/Checkout.tsx` — 移除「每月/每年自動續訂」文案，改「需手動續訂」
- `src/pages/CheckupCheckout.tsx` — 同上
- `src/pages/app/AppCheckout.tsx` — 同上
- `src/pages/app/Account.tsx` — 「自動續訂 / 手動續訂」文案改為「到期日：YYYY/MM/DD（手動續訂）」+ 一鍵續訂按鈕；目前到期前 7 天顯示提醒 banner
- `src/pages/company/Subscribers.tsx` / `Dashboard.tsx` / `Revenue.tsx` — `auto_renew` 欄位顯示改為「續訂方式：手動」；MRR 計算邏輯需重新審視（見技術細節）

### Edge Functions
| Function | 動作 |
|---|---|
| `expire-subscriptions` | **保留**——這就是新模型的核心，到期即標 expired |
| `line-push-renewal-reminder` | **改寫**——文案從「即將自動扣款」改為「即將到期，請重新訂閱」，CTA 改為一鍵續訂連結（帶 plan_id + slug 直達 checkout） |
| `auto-cancel-failed-renewals` | **停用 cron + 從程式碼下架**——沒有自動扣，就不會有「扣款失敗」 |
| `notify-payment-failure` | 保留，但只在「使用者主動付款失敗」時觸發，移除 isRenewal 分支 |
| `acpay-recurring-manage` / `acpay-recurring-notify` | 你已移除 ACpay 入口，這兩個功能仍保留，但加 audit log 標記「不再使用」；不刪檔避免歷史訂閱 webhook 進來時 500 |
| `create-acpay-order` | 移除 `remember=Y / period_type / period_frequency` 三行，改為純單筆扣款（避免後台仍把它當 recurring 處理） |
| `create-ecpay-order` / `create-linepay-order` | 不動（本來就是單筆） |
| 新增 `subscribe-renew-link` | 接 `?plan_id=&user_id=&token=` 驗證後 302 到正確 checkout 路徑，給 LINE/Email CTA 用 |

### Cron（pg_cron）
- 停掉 `auto-cancel-failed-renewals` 排程
- 確認 `expire-subscriptions` 仍在跑（現況確認後保留）
- `line-push-renewal-reminder` 排程改為每天 09:00 UTC+8 掃 7/3/1 天到期者

### 資料庫
- `member_subscriptions.auto_renew` / `checkup_subscriptions.auto_renew`：**保留欄位**但語意改為「使用者偏好（未來若上自動扣再用）」，新訂閱預設改 `false`
- 新增 migration：把所有現有 active 訂閱的 `auto_renew` 一次設為 `false`（資料誠實化）
- `audit_logs` 新增 action 標籤：`subscription.expired_no_renewal`、`subscription.renewal_reminder_sent`

### Memory 更新
- `mem://billing/renewal-policy-and-notifications` — 改寫為「手動續訂模型」
- `mem://logic/billing/mrr-calculation-logic` — MRR 改用 active+expires_at>now 計算，不再依賴 auto_renew
- 新增 `mem://billing/manual-renewal-model` — 記錄此次決策原因與規格

---

## 技術細節

### 一鍵續訂 token
為了 LINE/Email 連結點下去能直接帶用戶到 checkout 並預選方案，新增 edge function `subscribe-renew-link`：
- 收 `?sub_id=&t=<HMAC>`，HMAC = `sha256(sub_id + user_id + secret)`
- 驗證後查 `member_subscriptions` / `checkup_subscriptions`，根據 `plan_id` 找到 `expert.slug` → 302 到 `/{slug}/checkout?plan={plan_id}&billing={cycle}` 或 `/checkup/checkout?plan=...`
- LINE Flex / Email 模板中的「立即續訂」按鈕改用此短連結

### 續訂日期接續規則（決策點）
兩種選擇任一即可，建議走 **B**：
- A. 新付款日為新週期起點（純粹乾淨，但會「吃掉」幾天剩餘權益）
- B. 若使用者在到期前完成續訂 → 新週期從原 `expires_at` 接續；若已過期才回來 → 從付款當下起算
  - 實作位置：`ecpay-callback` / `confirm-linepay` / `confirm-remittance` 在建立新 subscription 時判斷舊 sub 是否還沒過期

### MRR / Dashboard
舊邏輯：`auto_renew=true AND status=active` 才算 MRR。改為：
- MRR = 所有 `status='active' AND expires_at > now()` 的當期月化金額
- 新增「即將到期未續訂」KPI（7 天內 expires 且 30 天內無新訂閱者）取代舊的「續訂失敗」

### 過期斷權（無寬限）
`expire-subscriptions` 現行已會在 `expires_at <= now()` 時把狀態改 `expired` + 解除 LINE 綁定，符合需求；只需確認 cron 頻率夠高（建議每 15 分鐘），避免使用者過期還能多用幾小時。

### 一鍵續訂 UI 入口
- `Account.tsx`：到期前 14 天起顯示橘色 banner「訂閱將於 X/X 到期，立即續訂 →」
- 已過期但 ≤30 天：顯示灰色 banner「已於 X/X 到期，重新訂閱 →」
- ≤30 天提供原方案直連，>30 天回方案頁讓使用者重新挑

### Checkout 文案修正
- 「每月自動續訂 NT$ X / 月」→ 「**單次扣款 NT$ X，效期 1 個月，到期需手動續訂**」
- 增加同意條款項：「我了解此為**單次扣款**，到期後不會自動扣款，如需延續需主動重新付款」

---

## 實作步驟（建議順序）

```text
1. DB migration: auto_renew 全部設 false + 預設改 false
2. expire-subscriptions: 確認 cron 為 15 分鐘一次（讀現況決定）
3. 新增 subscribe-renew-link edge function + HMAC 機制
4. 改寫 line-push-renewal-reminder（文案 + CTA + 排程）
5. 停用 auto-cancel-failed-renewals (cron + 函式 stub 改回 410 Gone)
6. create-acpay-order 拿掉 recurring 三行
7. 前端 4 個 checkout / Account 頁文案 + banner
8. 後台 Subscribers / Dashboard / Revenue 欄位語意重整
9. 更新 3 份 memory
```

---

## 不在範圍內（此次不做）
- 真正的自動扣款（ECPay 定期定額、ACpay ACREC）——你日後若要上，再補
- 退款流程不動
- 跨產品折扣 / 升級邏輯不動

確認後我就照這份開工。
