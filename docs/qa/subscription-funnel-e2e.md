# 訂閱漏斗 e2e / 後台儀表板防護網

對應後台兩張儀表板：
- `/company/ops-health`（edge function + 排程 7d 統計）
- `/company/funnel`（ViewPricing → UpgradeClick → BeginCheckout → Purchase）

它們的數字來源是**前台用戶實際走過的流程**寫入 `traffic_events` / `paywall_events` /
`function_run_logs`。所以要保證儀表板「會動」，必須保證前台流程＋埋點不壞。

## 三層測試

| 層 | 目的 | 檔案 | 何時跑 |
|---|---|---|---|
| **A 前台流程 mock e2e** | 驗證用戶 click path + 該送的事件真的有送 | `e2e/auth-funnel.spec.ts`（F1 登入/註冊）<br>`e2e/subscription-funnel.spec.ts`（F2 購買漏斗）<br>`e2e/subscription-cancel-renew.spec.ts`（F3 取消 / 續訂）<br>`e2e/view-as-content-access.spec.ts`（F4 view-as 訂閱判斷） | PR / 每次推 |
| **B 埋點契約 unit test** | 鎖住 `event_name` 字串與 GTM mirror，避免 silent rename | `src/test/unit/funnel-events.test.ts`、`src/test/unit/gtm-events.test.ts` | PR / 每次推 |
| **C live smoke** | 真的打 sandbox 後端，跑完查 DB 確認後台儀表板 >0 | `e2e/live/subscription-end-to-end.spec.ts`<br>`.github/workflows/live-smoke.yml`（cron 03:00 UTC+8 / 手動） | daily cron |

## 改到什麼 → 必跑哪些

| 動到的檔案 / 區塊 | 必跑 |
|---|---|
| `src/contexts/AuthContext.tsx`、`src/pages/auth/Login.tsx`、`Register.tsx` | A（auth-funnel）+ B |
| `src/pages/Pricing.tsx`、`src/pages/_pricing/**`、`PricingPlanCard` CTA | A + B |
| `src/pages/Checkout.tsx`、`src/pages/app/AppCheckout.tsx`、`CheckupCheckout.tsx` | A + B |
| `src/hooks/checkout/useSubscriptionConfirmation.ts`、`useCheckoutData.ts` | A + B |
| `src/lib/analytics/events.ts`、`src/lib/analytics/gtm.ts`（GTM_MIRROR） | B 全跑 |
| `src/lib/trafficTracker.ts`、`src/lib/paywallTracking.ts` | B + A（觀察 sendBeacon payload） |
| `member_subscriptions` schema / RLS / `useMemberSubscriptions` | A + 既有 `src/test/integration/1.17-subscription-lifecycle.test.ts`、`1.24-route-guard-rls.test.tsx` |
| 後台 `OpsHealth.tsx` / `FunnelAnalytics.tsx` SQL 查詢 | C（live smoke，未實作前手動於 preview 驗證） |

## 命令

```bash
# A: e2e
bunx playwright test e2e/subscription-funnel.spec.ts

# B: 埋點契約
bun vitest run src/test/unit/funnel-events.test.ts src/test/unit/gtm-events.test.ts
```

## 三條 plan_type 覆蓋

`subscription-funnel.spec.ts` 對下列 plan_type 各跑一次：
- `analyst_signal_l1`（跟單派）
- `analyst_signal_diag_l2`（跟單 + 健檢）
- `mentor_weekly_journal`（修煉派）

任何 plan 路徑斷掉就會擋住 PR。

## 為何儀表板顯示 0？

兩種可能，跑完上述測試可以分離：
1. **流程壞了** → A 測試 fail（事件沒送出 / 沒導回 /app / supabase REST 報錯）
2. **流程沒人走** → A 全綠，但 production `traffic_events` 仍空：純粹「沒人下單」，
   等同 0 訂閱、是商業面而非技術面問題。

OpsHealth 顯示 `Failed to send a request to the Edge Function` 屬於另一種：
edge function 部署狀態 / CORS。修這條走「reproduce → deploy → recheck」，不在
本 doc 範圍，後續會於 `docs/qa/admin-internal-pages.md`（live smoke 一起做）補上。

## Route B live smoke — 已可執行

實作在 `e2e/live/subscription-end-to-end.spec.ts` + `e2e/live/cleanup.ts` +
edge function `supabase/functions/e2e-simulate-purchase/`。

流程：
1. tester 帳號登入 → 檢查 `/app`、`/pricing` 真實載入。
2. 呼叫 `e2e-simulate-purchase`（action=purchase）在真實後端寫入
   `member_subscriptions` + `payment_transactions` + `traffic_events.checkout_success`
   （provider_tx_id 前綴 `E2E_SIMULATED_`）。
3. spec 用同一 tester JWT 讀 `traffic_events` 驗證事件已進 DB。
4. `afterAll` 呼叫 `action=cleanup` 用前綴刪回本輪 tx / sub / event。

三層安全鎖（缺一 403）：
- edge fn 讀 env `E2E_ALLOW_SIMULATED_PURCHASE=1`（生產環境**不設**）
- 呼叫者 JWT 必須解得出 user_id
- `profiles.is_tester = true`

### 必備 secrets

GitHub Actions repo secrets（`.github/workflows/live-smoke.yml`）：
- `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` — tester 帳號
- `E2E_TEST_PLAN_ID`（可選）— 指定 plan；未設則挑第一個 active plan
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PROJECT_ID`

Lovable Cloud 後端 secret（Backend → Secrets）：
- `E2E_ALLOW_SIMULATED_PURCHASE=1` — **只在 dev / sandbox 環境設**，正式 prod 千萬不要設

### 本機跑法

```bash
E2E_LIVE=1 \
E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... \
VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... VITE_SUPABASE_PROJECT_ID=... \
bunx playwright test --project=desktop-live-smoke
```

### 後續強化（非阻塞）

- 觸發真正的 `create-ecpay-order` sandbox 流程（含 CheckMacValue 簽章），
  比目前 short-circuit 更接近真實 callback 路徑。
- `traffic_events` 對 tester 若 RLS 唯讀關閉，spec 目前只 warning 不 fail；
  加一個 `get_funnel_snapshot` RPC (SECURITY DEFINER) 讓 tester 明確拿聚合數。

