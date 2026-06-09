# GTM dataLayer 事件字典

GTM 容器：`GTM-PBH8J4VD`（已在 `index.html` 載入）

所有事件透過 `gtmPush()` 推送，定義在 `src/lib/analytics/gtm.ts`。

| 事件 | 觸發點 | 參數 |
|---|---|---|
| `Login` | 登入成功（email / LINE） | `method: 'email' \| 'line'` |
| `SignUp` | 註冊成功（email 註冊 / LINE 首次登入） | `method: 'email' \| 'line'` |
| `Function` | 進入主要功能頁（首次/路由變更，每 session 每 feature 一次） | `feature: app \| checkup \| research \| signals \| journals \| holdings \| learning \| account \| subscribed_experts \| pricing \| experts \| leaderboard \| home` |
| `ViewExpert` | 進入專家檔案頁 | `expert_slug` |
| `ViewPricing` | 進入訂閱方案頁 | — |
| `SubscribeExpertClick` | 點訂閱專家 CTA | `expert_slug, plan_id?` |
| `BeginCheckout` | 結帳頁按「確認付款」當下（Checkout / CheckupCheckout / AppCheckout） | `plan_id, value, currency, method, billing_cycle` |
| `Purchase` | 結帳成功 dialog 開啟（Checkout / CheckupCheckout / AppCheckout，含信用卡 / LINE Pay / 轉帳 confirm 成功） | `plan_id, currency:'TWD', billing_cycle, method?` |
| `LineBindStart` | 點 LINE 綁定按鈕 | `expert_slug?` |
| `LineBindSuccess` | LINE 綁定成功回前端 | `expert_slug?` |
| `CheckupAnalysisRun` | 收盤分析 / 個股 / 深度 / 事件預測成功 | `kind` |
| `QuotaBlocked` | 額度耗盡提示出現 | `reason` |
| `UpgradeClick` | 任何升級 / 解鎖 / 續訂 CTA（pricing_pill_* / renewal_banner / app_home_*_lock / …） | `from` |

## 與內部 analytics 的關係

- `track('event_name', props)`（`src/lib/analytics/events.ts`）：寫入自家 `traffic_events` DB。
- `gtmPush('PascalEvent', params)`：送 GTM → Meta / Google Ads / GA4。
- `track()` 內部會自動把 `expert_profile_view / pricing_view / expert_subscribe_click / line_binding_* / checkup_analysis_run / checkup_quota_blocked / checkup_upgrade_click` **同步鏡像**到 GTM，呼叫端不需再多寫一行。
- `Login / SignUp / Function / BeginCheckout / Purchase` 直接在 AuthContext、LineCallback、PerfMetricsTracker、Checkout、CheckupCheckout 內呼叫 `gtmPush()`。

## GTM 設定建議

在 GTM 內為每個事件建立 **Custom Event Trigger**（Event name = 上表名稱），對應到：

- Meta Pixel：`Login` → CompleteRegistration / `Purchase` → Purchase（含 value / currency）
- Google Ads：`Purchase`、`BeginCheckout` 設為 Conversion
- GA4：以原名上報，Conversion 勾選 `Login / SignUp / Purchase / BeginCheckout`

## 加新事件

1. 在 `src/lib/analytics/gtm.ts` 的 `GtmEvent` 加上 PascalCase 名稱。
2. 若要透過 internal `track()` 自動鏡像，再到 `events.ts` 的 `GTM_MIRROR` 加映射。
3. 更新本檔表格，通知行銷團隊在 GTM 加 trigger。
4. 補單元測試在 `src/test/unit/gtm-events.test.ts`。
