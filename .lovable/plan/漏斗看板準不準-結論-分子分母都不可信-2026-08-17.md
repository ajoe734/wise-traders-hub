# 漏斗看板準不準？結論：分子分母都不可信

## 查證結果（production 唯讀，近 7 天）

| 看板顯示 | 資料庫實況 |
|---|---|
| ViewPricing 681 actor / 689 事件 | `pricing_view` 689 筆，**689 筆 user_id 全為 NULL**，actor 一律是 visitor_id |
| UpgradeClick 55 / 61 | `checkup_upgrade_click` 61 筆；`paywall_events.click_upgrade` 近 7 天 **0 筆**（只有 view 15、hit_limit 13） |
| BeginCheckout 18 / 41 | `checkout_open` 34 + `checkout_submit` 7 = 41 |
| Purchase 2 / 2 | `checkout_success` 2 筆；但實際 `payment_intents` completed 2、`member_subscriptions` active **3**、`remittance_orders` confirmed 1 |

數字本身和事件表一致（沒有算錯），但**事件表本身無法代表真實漏斗**。四個問題：

1. **Purchase 少算**：匯款單要等管理員審核才開通，開通當下使用者不在前端，不會觸發 `checkout_success`。近 7 天有 3 筆訂閱生效、只記到 2 筆購買。
2. **轉換率是假的**：每階段各自算 unique actor，不檢查是否同一人走完上一階段。加上 `pricing_view` 全是匿名 visitor、結帳階段已登入用 user_id，同一人被算成兩個 actor → 8.1%、32.7%、11.1% 這三個數字沒有一個是真的階段轉換率。
3. **ViewPricing 分母偏窄**：只認 `/pricing` 的 `pricing_view`，專家頁看方案（`expert_profile_view` 274）與 App 內方案頁不計入。
4. **UpgradeClick 事件次數重複相加**：traffic 與 paywall 兩來源的 events 直接累加（actor 有去重、次數沒有）。目前 paywall 為 0 所以還沒現形。

## 修正方案

### A. Purchase 改用成交事實，不靠前端事件
以 `payment_intents.status='completed'` ∪ `member_subscriptions`（生效時間落在窗內）為 Purchase 來源，前端 `checkout_success` 只作為輔助（顯示為「前端回報」子指標）。匯款審核開通因此會被算進去。

### B. 轉換率改成真漏斗（依序子集）
把 actor 統一成 identity key：優先 user_id，並用 `traffic_visits` / `traffic_events` 把該 user 曾用過的 visitor_id 併入同一身分（登入前後合併）。每階段的集合改為「上一階段集合 ∩ 本階段有事件者」，轉換率才是階段轉換率。無法歸戶的匿名 actor 只計入 ViewPricing，並在卡片標註。

### C. ViewPricing 擴充來源
`pricing_view` ∪ `expert_profile_view` ∪ App 方案頁 view，並在卡片註明來源清單（`STEP_META.sources` 一併更新）。

### D. UpgradeClick 次數去重
兩來源合併時，events 也用 (actor, 秒級時間戳) 去重，避免同一次點擊被記兩次。

### E. 看板誠實標示
卡片下方加註「口徑」與資料延遲說明；當某階段來源事件近 7 天為 0（例如 paywall click_upgrade）時顯示「來源無資料」而不是靜默併入。

## 技術細節

- 全部在 `src/pages/company/FunnelAnalytics.tsx` 內處理；新增身分歸戶與階段子集的純函式抽到 `src/lib/analytics/funnel.ts`，配單元測試（含匿名→登入合併、匯款延後開通、雙來源去重三個案例）。
- Purchase 需讀 `payment_intents` 與 `member_subscriptions`，兩表已有 company_admin 讀取政策，不新增 migration。
- 不改任何埋點行為與既有事件名稱；`Traffic.tsx` / `ConversionCenter.tsx` / `PaywallAnalytics.tsx` 本次不動。
