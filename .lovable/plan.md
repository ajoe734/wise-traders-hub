## 為什麼之前像土法煉鋼

之前是想到一個埋一個，沒對齊任何業界 schema。這次照 **GA4 + PostHog + Mixpanel 三家共通的 Event Taxonomy** 重做：

- **命名規範**：`object_action`（`signal_view`、`holding_card_click`、`checkout_submit`）
- **必帶 props**：`page_path`、`page_section`、`source_module`、`user_role`（visitor/member/expert/admin）、`is_internal`
- **語義分類**：`page_view` / `feature_view`（曝光）/ `feature_interact`（互動）/ `conversion_step`（漏斗）/ `content_engagement`（內容）
- **個股 props**：`instrument` / `symbol` 進 `event_props`，可看「哪些股票最常被點開」
- **內部隔離**：Admin/Mentor/Company 全收 `is_internal=true`，KPI 預設 `WHERE NOT is_internal`，分析頁加開關才看得到
- **保留期**：traffic_events 從 90 天 → **180 天**（已採納個股粒度）

---

## 全站埋點清單（窮舉）

### A. 公開頁
| 事件 | 觸發 | 狀態 |
|---|---|---|
| `home_view` / `home_section_view` / `home_cta_click` | `/` 各區塊 | 新增 |
| `experts_list_view` / `expert_card_click` | `/experts` | 新增 |
| `expert_profile_view` | `/experts/:slug` | ✅ 已有 |
| `leaderboard_view` / `leaderboard_card_click` | 漲停榜 | 部分 |
| `pricing_view` | `/pricing` | ✅ 已有 |

### B. 修煉派 FreeCheckup
`checkup_view` / `checkup_tab_change` / `checkup_holding_expand`（帶 `code`）/ `checkup_holding_target_update` / `checkup_holding_alert_update` / `checkup_holdings_sort_change` / `checkup_demo_click` / `checkup_analysis_run` / `checkup_quota_blocked` / `checkup_upgrade_click`

### C. 跟單派 App
`app_dashboard_view` / `signal_view`（帶 `instrument`）/ `signal_card_click` / `holdings_dashboard_view` / `holding_card_click`（帶 `instrument`、`pnl_bucket`）/ `journal_view` / `journal_card_click` / `subscribed_experts_view` / `expert_detail_view`

### D. 訂閱／結帳漏斗
`expert_subscribe_click` ✅ / `checkout_open` ✅ / `checkout_consent_accept` 新增 / `checkout_payment_method_select`（含 `method`）新增 / `checkout_submit` 新增 / `checkout_success` ✅ / `checkout_failure`（含 `reason`）新增 / `subscription_cancel_click` / `subscription_renew_click`

### E. 學習中心
`learning_view` / `system_detail_view` / `learning_card_click`

### F. 帳號／通知
`notifications_open` / `notification_click` / `profile_view` / `line_binding_start` / `line_binding_success`

### G. 內部後台（`is_internal=true`，預設不看）
`admin_page_view` / `signal_publish` / `signal_recall` / `journal_publish` / `mentor_dashboard_view` / `company_page_view`

---

## 分析頁 `/company/traffic` 重寫成 6 tab（PostHog 風格）

1. **總覽**：KPI 卡 + 趨勢圖 + Top 來源/落地頁
2. **產品線拆解**：修煉派 / 跟單派 / 學習中心 三條 DAU、停留、回訪
3. **漏斗（4 條並列）**：
   - 訂閱：`pricing_view → expert_profile_view → expert_subscribe_click → checkout_open → checkout_success`
   - 修煉派轉付費：`checkup_view → checkup_analysis_run → checkup_quota_blocked → checkup_upgrade_click → checkout_success`
   - 跟單派回訪：`app_dashboard_view → signal_view → expert_detail_view → expert_subscribe_click`
   - 持股看板深度：`app_dashboard_view → holdings_dashboard_view → holding_card_click → signal_view`
4. **功能熱度**：event_name 排序，含 unique users / 次數 / 人均次數，可依 `user_role` 切片
5. **頁面**：path × PV/UV/停留/跳出/下一步
6. **使用者旅程**：選 `visitor_id` 看時序

頂部固定控制：日期範圍、`is_internal` 開關、`user_role` 篩選、UTM source 篩選、**熱門個股 Top 20**（從 event_props 的 `instrument` 聚合）。

---

## 技術實作

### 1. 集中事件 schema
新增 `src/lib/analytics/events.ts`，TypeScript 型別鎖死事件名 + 必填 props，呼叫端傳錯會編譯失敗。

### 2. 自動 `page_view`
`App.tsx` 加 `useLocation` 監聽，每次路由變化自動發 `page_view`，全站零改動就有 PV。

### 3. 曝光自動化
新增 `<TrackOnVisible event="..." props={...}>` 用 IntersectionObserver，section 滾入畫面自動發 `*_view`。

### 4. 後端
- traffic_events 保留期 migration：90 天 → **180 天**（改 `cleanup_old_traffic`）
- traffic_events 加 `is_internal boolean DEFAULT false` 欄位 + 索引
- 新增 RPC：
  - `get_product_breakdown(_from, _to, _include_internal)` — 三產品線指標
  - `get_page_analytics(_from, _to, _include_internal)` — 每 path 的 PV/UV/停留/下一步
  - `get_user_journey(_visitor_id, _from, _to)` — 時序事件流
  - `get_top_instruments(_from, _to, _limit)` — 從 event_props->>'instrument' 聚合熱門個股
- 既有 `get_traffic_overview` / `get_funnel_overview` 加上 `_include_internal` 參數

### 5. 取樣與成本
- 曝光 / 互動 100% 收
- 滾動深度事件取樣 25%（量太大）
- 180 天自動清理

---

## 執行順序（4 commit 分次驗收）

| # | 範圍 | 驗收 |
|---|---|---|
| **1** | `analytics/events.ts` 型別 + 自動 `page_view` + `TrackOnVisible` + migration（保留期改 180 天 + `is_internal` 欄位） | 隨便逛 5 頁，看 traffic_events 5 筆 PV |
| **2** | 修煉派 + 跟單派 + 持股看板全部事件埋上（含 `instrument` props） | demo 跑一輪，事件 tab 出對應事件 + 個股名 |
| **3** | 訂閱漏斗補完 + 學習 + 帳號 + 後台 `is_internal=true` 全埋 | 走完訂閱流程，4 條漏斗每步都有數 |
| **4** | 重寫 `/company/traffic` 6 tab + 4 個新 RPC + 熱門個股 Top 20 | 開頁看到產品線拆解、4 漏斗、頁面熱度、旅程、個股榜 |

你按「Implement plan」我就從 commit 1 開始。