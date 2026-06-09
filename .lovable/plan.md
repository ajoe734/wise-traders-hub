
# 補齊 GTM 事件追蹤完整盤點

目標：讓 `docs/gtm-events.md` 字典裡的 13 個事件**全部**在真實流程觸發，不再有「字典有、實際沒推」的缺口。

## 1. SignUp — 加上 LINE 註冊

`src/pages/auth/LineCallback.tsx`：目前只有 `gtmPush('Login', { method: 'line' })`。
- exchange-nonce 回傳會帶 `is_new_user`（若沒有，改用 `created_at === last_sign_in_at` 判斷，或讓 edge function 補回欄位）
- 新用戶時加推 `gtmPush('SignUp', { method: 'line' })`，再推 Login

## 2. Function — 補齊頁面 → feature 對應

`src/components/PerfMetricsTracker.tsx` 的 `pathToFeature` 加：
- `/app/account` → `account`
- `/app/subscribed-experts` → `subscribed_experts`
- `/pricing` → `pricing`
- `/experts`、`/expert/...` → `experts`
- `/leaderboard` → `leaderboard`
- `/`（首頁）→ `home`

每個 feature 仍維持「每 session 只推一次」。同步更新 `docs/gtm-events.md` 的 feature 列表。

## 3. BeginCheckout / Purchase — 補 `AppCheckout` 與轉帳成功路徑

- `src/pages/_appCheckout/*` 或 `AppCheckout.tsx`：對齊 `Checkout.tsx`／`CheckupCheckout.tsx`，在「按確認付款」推 `BeginCheckout`、在成功 dialog 開啟時推 `Purchase`（含 `plan_id, value, currency:'TWD', billing_cycle, method`）。
- 轉帳（remittance）流程：原本只有信用卡 dialog 開啟才推 Purchase；轉帳審核通過 / 訂閱啟用的那段也補 `Purchase`（在 confirm 成功 callback 內），參數同上但 `method='remittance'`。

## 4. UpgradeClick — 補散落的升級 CTA

統一用 `track('checkup_upgrade_click', { from })`（已自動鏡像到 GTM `UpgradeClick`），不重複寫 `gtmPush`。加在：

| 檔案 | from |
|---|---|
| `src/pages/Pricing.tsx` 各方案 CTA | `pricing_card` |
| `src/pages/ExpertProfile.tsx` 訂閱 CTA | `expert_profile` |
| `src/components/account/RenewalBanner.tsx` 立即續訂 | `renewal_banner` |
| `src/pages/app/AppHome.tsx` 升級提示 | `app_home` |
| `src/pages/app/SignalsDashboard.tsx`（或對應檔）升級提示 | `signals_dashboard` |
| `src/pages/learning/*` 升級提示 | `learning` |
| `src/pages/account/Account.tsx` 續訂／升級鈕 | `account` |

註：`expert_subscribe_click` 已經有獨立 `SubscribeExpertClick` 事件，這邊不重複推。

## 5. 文件與測試

- `docs/gtm-events.md`：更新 `Function` 的 feature 列表、`SignUp` 的 method 加 `'line'`、`UpgradeClick` 的 from 枚舉。
- `src/test/unit/gtm-events.test.ts`：原有 13 事件清單測試保留；補一筆 snapshot 測 `pathToFeature` 對 7 條 path 都回傳正確 feature；補 LineCallback SignUp 路徑的單元測試（mock exchange-nonce 回 `is_new_user`）。

## 技術備註

- `track('checkup_upgrade_click', { from })` 走 `events.ts` 的 `GTM_MIRROR`，自動推 `UpgradeClick`，**不要**在元件層手寫 `gtmPush('UpgradeClick')`。
- Function 事件採 session 內去重，避免重複進出同 feature 多次推送拉爆 GTM。
- AppCheckout 若內部用的是 `_checkout/` 共用 hook，優先改 hook 的 success/submit callback；若是獨立元件，就直接加在 component 內。
- 不更動 `paywall_events` 表結構與 PaywallAnalytics 邏輯；本次只動 GTM dataLayer。

## 驗收

1. 開 LINE 註冊一次新帳號 → dataLayer 同時看到 SignUp + Login。
2. 跑過 7 條 path → 每條第一次進入推一次 Function。
3. AppCheckout / 轉帳成功 → 各推一次 BeginCheckout + Purchase。
4. 點 Pricing/Account/RenewalBanner/AppHome 的升級鈕 → 各推一次 UpgradeClick，from 不同。
5. `bunx vitest run src/test/unit/gtm-events.test.ts` 綠燈。
