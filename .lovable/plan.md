## 目標

1. **年訂閱「上線」**：DB / Checkout 已支援，但多處 edge function 與 UI 仍寫死月繳價，把所有沒讀到 `price_yearly` / `billing_cycle` 的端一次補齊。
2. **月訂閱續約提醒**：站內補上 banner、LINE / Email 提醒按金額正確、續訂連結（屬付費內容）能登入後回到 checkout。

---

## A. 年訂閱端到端 audit & 修正

| # | 檔案 | 現況 | 修正 |
|---|---|---|---|
| 1 | `supabase/functions/line-push-renewal-reminder/index.ts` L122/145 | 沒選 `price_yearly`、`billing_cycle`；金額永遠用 `plan.price_monthly` | join `member_subscriptions.billing_cycle` 並 select `price_yearly`；`amount = cycle==='yearly' ? price_yearly : price_monthly`；renewUrl 加 `&cycle=${billing_cycle}` |
| 2 | `supabase/functions/email-push-renewal-reminder/index.ts` L90/103 | 同上 | 同步修正 |
| 3 | `supabase/functions/subscribe-renew-link/index.ts` L113-138 | 重導 URL 沒帶 cycle | sub 讀 `billing_cycle`，附加到 checkout query |
| 4 | `src/pages/_appAccount/SubscriptionCard.tsx` L62/L88 + `types.ts` | `DbSubscription` 沒 `billing_cycle`；顯示寫死「NT$ X/月」；續訂 link 沒帶 cycle | 補 `billing_cycle` 欄位；依 cycle 顯示「NT$ X/月」或「NT$ Y/年」；續訂連結 `?plan=…&cycle=…` |
| 5 | `src/hooks/app/useAccountData.ts` | 確認 select 帶 `billing_cycle`、`price_yearly` | 補欄位 |
| 6 | `src/pages/Checkout.tsx` / `useCheckoutData` | 是否從 URL `?cycle=` 預選 | 讀 `searchParams.get('cycle')` 初始化 `billingCycle` state |
| 7 | 後台 `Subscribers.tsx` / `SubscriptionsTab.tsx` | 已顯示週期欄；確認 CSV 也帶 | 補檢查 |

新增 smoke test：建立年訂閱 → 觸發 reminder edge function → 斷言訊息含 `NT$ {price_yearly}` 與 `cycle=yearly`。

---

## B. 月訂閱續約提醒

### B1. 站內 banner（登入帳號頁 → 一鍵續訂）
- 現況：`Account.tsx` 已掛 `<RenewalBanner />`（看起來在前一輪已建立）。確認它：
  - 來源是 `useMemberSubscriptions` 而非自己查 DB（保持單一資料源）。
  - 條件：未取消 + `expires_at − now ≤ 7 天`（年訂閱放寬 30 天）。
  - 按鈕 navigate 到 `/{slug}/checkout?plan=…&cycle=…&utm_source=banner`。
  - 可關閉（`localStorage`，每個 sub 每天只關一次）。
- 若 `RenewalBanner` 內仍有舊邏輯（重複查 query / 沒帶 cycle / 寫死天數），一併修。

### B2. Email 提醒
- `email-push-renewal-reminder` 已存在（Resend 直連），完成 A2 修正後金額正確。
- **確認 pg_cron 排程**：搜尋現有 cron job，若還沒排，新增每日 09:10 UTC+8（與 LINE 那支錯開 10 分鐘）。
- `notification_preferences.renewal_email` 偏好保留；帳號頁若還沒有 toggle，補上「續約 Email 提醒」開關。

### B3. 續訂連結 → 登入後回 checkout（**僅付費內容**）
**範圍限定**：只針對「付款／訂閱相關路由」強制登入並回跳；免費內容（首頁、文章、free checkup、公開老師頁）一律不強制登入。

- 範圍清單（白名單，只有這些路徑會啟用 "mount-time 強制登入 + redirect_after_login"）：
  - `/{slug}/checkout`（`Checkout.tsx`）
  - `/checkup/checkout`（`CheckupCheckout.tsx`）
  - `/account/remittance`（補匯款資料）
- 實作：在這幾個頁面 mount 時 `if (!authLoading && !user) { sessionStorage.setItem('redirect_after_login', pathname+search); navigate('/auth/login', { replace: true }); }`。
- `Login.tsx` 已會讀 `redirect_after_login` 並回跳，**不需新增**全站登入攔截。
- 免費路由（首頁、`/free-checkup`、`/{slug}` 老師頁、文章等）**完全不動**，維持訪客可瀏覽。
- LINE / Email 提醒 + `subscribe-renew-link` 產出的連結，本來就指向 checkout 白名單路徑，所以未登入點擊會自動：到 checkout → 偵測未登入 → 跳登入 → 登入後自動回 checkout。

---

## C. 範圍外 / 不動
- 不改價格、不動 `expert_plans` schema、不動退款邏輯。
- 不改後台「分析師建立方案」表單（已能填 `price_yearly`）。
- 不重做 Email 基礎建設（沿用既有 Resend pipeline，符合 [Email notifications](mem://infrastructure/email-notifications-resend)）。
- 不對免費頁面新增任何登入攔截 / banner。

---

## 驗收
- 建立 `billing_cycle='yearly'` 的 `member_subscriptions`，到期日 +3 天 → 手動觸發 LINE / Email reminder：訊息顯示年費金額，URL 含 `cycle=yearly`。
- `/app/account` 年訂閱顯示「NT$ X/年」；點「立即續訂」進 checkout，年繳 tab 預選。
- 登出狀態：
  - 貼上 `/{slug}/checkout?plan=…&cycle=yearly` → 自動跳登入 → 登入後回到同 checkout 頁。
  - 貼上 `/`、`/free-checkup`、公開老師頁 → **不跳登入**，正常瀏覽。
- 月訂閱使用者登入後若 7 天內到期，帳號頁 banner 出現一鍵續訂。
- 帳號頁可關閉「續約 Email」。

---

## 更新記憶
更新 [Manual renewal model](mem://billing/manual-renewal-model)：
- 年訂閱已上線；提醒金額按 `billing_cycle` 取值
- 站內 banner 門檻：月 7 天 / 年 30 天
- 「強制登入＋回跳」只套用於 checkout / remittance 等付費路徑，免費內容不攔截
