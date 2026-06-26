# 前台用戶流程 e2e（讓後台儀表板的數字真的會動）

## 重新對齊問題

兩張截圖的真正意義不是「後台壞了」，而是：

- **OpsHealth = 0**：edge functions 過去 7 天沒有被前台/排程實際呼叫，或呼叫沒寫進 `function_run_logs`
- **Funnel = 0%**：訂閱漏斗每一步（pricing_view → upgrade_click → checkout_open → checkout_success）沒有事件落地到 `traffic_events` / `paywall_events`

所以我們真正缺的是**「前台用戶會走的關鍵流程」的端到端測試**，跑完之後後台儀表板的數字應該要從 0 變成 >0。這樣每次改動後，跑一次測試套件就能保證：
1. 前台流程沒壞
2. 流程過程中該寫的事件 / log 真的有寫
3. 後台儀表板讀得到資料

## 一、要覆蓋的前台關鍵流程（共 5 條）

### F1. 註冊 / 登入流程
- 訪客 → `/auth/register` → 註冊 → email 確認 → 登入 → 落地 `/app`
- 期待事件：`auth_signup`, `auth_login`，`profiles` 寫入一筆
- 期待 edge function：`send-welcome-email`（如有）有呼叫紀錄

### F2. 訂閱漏斗（最重要，就是截圖二的漏斗）
- 訪客 → `/`（首頁）→ `/pricing` → 點某個方案的「立即訂閱」→ `/checkout/:slug/:planId`（mock 付款 provider）→ 收到 active 訂閱 → 自動導回 `/app`
- 每一步 assert：
  - `/pricing` 載入時 `traffic_events.event_name=pricing_view` insert 一筆（GTM 對應 `ViewPricing`）
  - 點 CTA 時 `paywall_events.event_kind=click_upgrade` insert（對應 `UpgradeClick`）
  - 進入 checkout 時 `traffic_events.event_name=checkout_open`（對應 `BeginCheckout`）
  - 付款成功 callback 後 `traffic_events.event_name=checkout_success`（對應 `Purchase`）
  - `member_subscriptions` 有一筆 `status=active`
  - 對應 edge functions（create-ecpay-order / ecpay-callback / 或 acpay 等價物）寫進 `function_run_logs`
- 涵蓋 advisor 訊號方案、advisor 訊號+健檢、mentor 週記方案三種 plan_type

### F3. 訂閱續訂 / 取消
- 已訂閱用戶 → `/app/account` → 取消訂閱 → `member_subscriptions.status=cancelled`、`auto_renew=false`
- 反向：點「續訂」→ 走付款流程 → 新的 active 訂閱
- assert `cancel-subscription` edge function 有被呼叫

### F4. 訂閱者瀏覽付費內容
- F2 完成後的 session → `/app/expert/:slug` 顯示「已訂閱」橫幅（不再出現「訂閱方案」CTA）
- `/app/signals/:slug` 能看到訊號內容（非預覽水印）
- 點訊號 → `expert_signals` view count / `paywall_events.event_kind=view_content` 寫入
- 同時驗證**「視角檢視」** 功能：admin 模擬該 user → 看到一模一樣的畫面（修上一輪那個 bug 的回歸測試）

### F5. 持股健檢核心流程（freecheckup 已有部分覆蓋，補齊）
- 未登入訪客 `/holding-checkup-demo` → 看到 demo 資料 → 點付費 CTA → 進入訂閱流程（接 F2）
- 已訂閱用戶 → 上傳/新增持股 → 觸發分析 → `checkup_analysis_jobs` 有紀錄 → `checkup-analyze` edge function 有 log

## 二、實作策略

### 路線 A：mock 後端的快速 e2e（CI 每次跑）
沿用 `e2e/helpers/supabase-mock.ts` 模式：
- REST / functions / realtime 全 stub
- 驗證**前台行為 + 應送出的事件 payload**（攔 `fetch` / `sendBeacon` 看送了什麼）
- 不驗證 DB 真的寫進去，但保證「前端有送對的東西」
- 跑得快、放每個 PR

新增檔案：
- `e2e/subscription-funnel.spec.ts`（F2 主線 × 3 plan_type）
- `e2e/subscription-cancel-renew.spec.ts`（F3）
- `e2e/subscribed-content-access.spec.ts`（F4，含 view-as 對照）
- `e2e/auth-flow.spec.ts`（F1）

### 路線 B：打真實後端的 smoke e2e（每日 + pre-publish 跑）
新增 `e2e/live/`（與既有 mock spec 隔離）：
- 用一組固定的測試帳號 + sandbox 付款 provider
- 跑完整 F2 一次，跑完 query DB 驗證：
  - `member_subscriptions` 有新 row
  - `traffic_events` 有完整 4 個事件
  - `function_run_logs` 有對應 edge function
  - **回頭打 `ops-health` 與 funnel analytics API**，斷言數字 > 0
- 跑完做 cleanup：刪測試訂閱、events 標記為 test
- GitHub Actions `daily-live-smoke.yml`，每天 03:00 UTC 跑

這條才是真正「保證後台儀表板會動」的測試。

### 路線 C：事件管線契約測試（Deno test，超快）
針對「埋點」這層的單元測試：
- `src/lib/analytics/events.ts` + `paywallTracking.ts` 的 unit test，斷言觸發 `trackPricingView()` 時 fetch payload 等於 `{ event_name: 'pricing_view', ... }`
- 已有 `src/test/unit/gtm-events.test.ts`，擴充覆蓋全部 4 個漏斗事件

## 三、每次改動的驗證 SOP

寫入 `docs/qa/subscription-funnel-e2e.md`：

| 改到什麼 | 必跑 |
|---|---|
| `/pricing`、`PricingPage`、`ExpertDetail` CTA | A 的 F2 + C |
| `/checkout/*`、`useCheckoutData`、`useSubscriptionConfirmation`、付款 edge function | A 的 F2 + F3 + B（live smoke） |
| `member_subscriptions` schema / RLS / hooks | A 的 F2 + F4 + 既有 1.17 / 1.24 integration test |
| GTM `events.ts` / `paywallTracking.ts` / `trafficTracker.ts` | C 全跑 |
| `useMemberSubscriptions` / view-as | A 的 F4 |

CI workflow：
- `.github/workflows/test.yml` 既有 → 加跑 A 全部 + C
- 新增 `.github/workflows/live-smoke.yml` → cron 跑 B，失敗發 Slack

## 四、交付清單

1. `e2e/subscription-funnel.spec.ts`（含 3 個 plan_type）
2. `e2e/subscription-cancel-renew.spec.ts`
3. `e2e/subscribed-content-access.spec.ts`
4. `e2e/auth-flow.spec.ts`
5. `e2e/live/subscription-end-to-end.spec.ts` + `e2e/live/cleanup.ts`
6. 擴充 `src/test/unit/gtm-events.test.ts` 覆蓋全 4 個漏斗事件 payload
7. `e2e/helpers/funnel-events.ts`（共用：攔 `fetch`/`sendBeacon`、解析 event payload）
8. `e2e/helpers/auth.ts`（共用：seed admin / 一般 user / view-as session）
9. `.github/workflows/live-smoke.yml`
10. `docs/qa/subscription-funnel-e2e.md`（上面的 SOP 表）

## 五、不做

- 不改現有 OpsHealth / FunnelAnalytics UI（除非 B 路線跑完發現查詢 SQL 本身錯）
- 不重寫埋點程式碼（先用測試蓋住，發現 bug 再分別修）
- 不接真實付款（live smoke 只用 sandbox provider）

## 確認

要先做哪幾條？建議順序：**F2 mock e2e（最痛）→ C 埋點 unit test → B live smoke → F3/F4/F1**。
