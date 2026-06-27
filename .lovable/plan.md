
# 後台分析報表審計（流量 / 點擊 / 轉換）

我審視了 `/company` 下 5 個分析頁與底層事件埋點，整體骨架完整（traffic / paywall / funnel / revenue 四套都有），但仍有 6 類缺口讓「看數據→做決策」斷裂。下面分「現況」「缺口」「優化方案」三段，最後列出可分階段執行的工單。

---

## 1. 現況盤點

| 頁面 | 角色 | 資料來源 |
|---|---|---|
| `/company`（Dashboard） | 全平台 KPI 卡 | 直接 `count(*)`，無趨勢 |
| `/company/traffic` | 流量總覽 + 自訂漏斗 + 廣告 ROAS | `get_traffic_overview` / `get_funnel_overview` RPC |
| `/company/funnel-analytics` | 廣告事件漏斗（ViewPricing→Purchase） | `traffic_events` + `paywall_events` |
| `/company/paywall-analytics` | Paywall 觸發→升級→付款 | `paywall_events` |
| `/company/revenue` | MRR / 分潤 / 退款 | `payment_transactions` + `revenue_splits` |

事件層 (`src/lib/analytics/events.ts`) 已定 80+ 命名事件、GTM 鏡像、auto `page_view`、`PerfMetricsTracker`、`TrackOnVisible`。

---

## 2. 缺口（嚴重→次要）

### A. Dashboard 是「靜態快照」，看不到動能
- 只有當下 count，沒有 WoW / MoM / 趨勢線；
- MRR、新增/取消、營收都缺「上週同期」對照；
- 沒有「最近 24 小時 active users / signups / orders」即時欄；
- 「快捷操作」只是 5 個 link，沒有顯示各模組未處理事項（退款、待匯款、訊號待審）。

### B. 點擊事件覆蓋有破洞
- `signal_card_click`、`journal_card_click`、`expert_card_click`、`leaderboard_card_click` 都有定義，**但只有部分有實際呼叫**（grep 顯示 leaderboard / journal 多處用 `<Link>` 直接導，沒 wrap track）。
- `home_cta_click` 只埋了 1-2 個 hero CTA，footer / 中段 CTA、定價頁滑入 CTA 沒事件。
- App 內部關鍵互動沒事件：`subscribed_experts` 切換、`/app/holdings` 排序變更、`signal_publish` 在後台但「點開 detail 看訊號」沒事件。
- 結果：funnel 中段（profile→subscribe→checkout）斷層無法歸因。

### C. 轉換報表三套各算各的，沒有「會員→ARPU→Cohort」視角
- FunnelAnalytics 只看 ViewPricing→Purchase 單一通道；
- PaywallAnalytics 只看修煉派；
- 兩者都用 unique actor，**沒 cohort（按註冊週／首次來源分群的留存與付費）**；
- Revenue 沒「LTV / churn rate / ARPU by source」；
- 無「廣告活動 → 付費」端到端歸因（Traffic.tsx 有 RoasScatter 但需 `ad_spend` 手動匯入，且沒接 funnel）。

### D. 無單一用戶 Journey 視圖
- `useAutoPageView` + `traffic_events` 已存 visitor / user 級時序資料；
- 但後台沒有「輸入 user_id → 看他完整 session 軌跡」的 drill-down；
- 客訴與付款失敗排查只能跨表 SQL，反應慢。

### E. 異常告警只在 Funnel 頁靜態渲染
- FunnelAnalytics 有「埋點失效告警」、PaywallAnalytics 有 WoW drop 告警，**但沒寫進 `system_alerts` / Email / LINE 推播**；
- 沒人打開頁面就不會發現；
- 沒「checkout_submit → checkout_success 同期失敗率 > X%」這類即時護欄。

### F. 效能 / 健康指標沒進主管視圖
- `PerfMetrics` 頁有 FCP/LCP，但 Dashboard 不顯示；
- `OpsHealth` / `SystemJobs` / `FunctionLogs` 散在多頁，無「紅黃綠」匯總燈號。

---

## 3. 優化方案（依價值排序）

### P0 — 一週可上線
1. **Dashboard v2：加 WoW/MoM + Sparkline + 待辦徽章**
   - 每張 KPI 卡加「vs 上週 ±X%」與 7 天小折線；
   - 「快捷操作」改成顯示徽章（`待退款 3｜待匯款 12｜待審訊號 2`）；
   - 加「24h 即時」一列：新訪客 / 新註冊 / 新訂單 / 失敗付款。
2. **點擊埋點補完（單一 PR）**
   - 跑 grep audit，把 `events.ts` 列出但無 call site 的事件全部回填；
   - 補 `home_cta_click`（hero / mid / footer）、`leaderboard_card_click`、`subscribed_experts_view`、`holdings_sort_change`；
   - 加 ESLint 規則：`<Link to="/pricing">` 等關鍵 CTA 必須包 `track()` 或 `TrackOnVisible`。

### P1 — 兩週
3. **新增「Conversion Center」聚合頁** `/company/conversions`
   - 三套漏斗統一（訂閱 / 修煉派 / 學習）並排，可切日期；
   - 顯示 `traffic_events` → `member_subscriptions` 的 attribution（首次來源、最終來源）；
   - 加 Cohort 表：按註冊週 × 7/14/30 天付費轉換率。
4. **User Journey Drill-down**
   - `/company/users/:userId/journey`：時序列 page_view + 命名事件 + 訂閱/付款/退款事件；
   - 從 `/company/subscribers` 與 `Members` 加「查 Journey」按鈕。

### P2 — 一個月
5. **即時護欄與告警**
   - `supabase/functions/alerts-watchdog`：每 5 分鐘掃 checkout 失敗率、webhook 失敗率、paywall drop；
   - 寫入 `system_alerts` + LINE 推播給營運群；
   - Dashboard 顯示紅黃綠燈號彙整。
6. **ROAS / LTV 整合**
   - `ad_spend` × attribution → 計算 CAC、payback、12 週 LTV；
   - 給每個 utm_campaign 一張卡：花費、訂單、ROAS、首付 ARPU、續訂率。

### P3 — 視需要
7. **A/B 與 Variant 報表**：已有 `paywall_events.variant` 欄但沒看板；做 surface×variant 升級轉換對照。
8. **行為熱圖**：補 `get_event_heatmap` 的 GA 風格 daypart × dayofweek 熱圖到 Traffic 頁。

---

## 4. 技術細節（給工程）

- 新增 RPC：
  - `get_dashboard_overview(_from, _to, _compare_from, _compare_to)` 回傳 KPI 與對照；
  - `get_cohort_conversion(_cohort_grain, _from, _to)`；
  - `get_user_journey(_user_id, _from, _to, _limit)`。
- 新增 edge function：`alerts-watchdog`（cron 5min）。
- 新增頁面：`src/pages/company/Conversions.tsx`、`UserJourney.tsx`，沿用 `CompanyLayout` 與 lazy `Charts`。
- 事件補埋只動 frontend；新規則：所有「導向付費路徑」的 `<Link>` / `<Button>` 必須呼叫 `track('xxx_click')`。
- 不動 `src/integrations/supabase/client.ts` / `types.ts`，新表/RPC 走 migration。

---

## 5. 我建議先做什麼

若只挑兩件：
1. **Dashboard v2（WoW + Sparkline + 待辦徽章）** — 立即提升每日打開的價值；
2. **點擊埋點補完 + ESLint 守門** — 讓現有三套 funnel 數字可信，否則後面做 cohort / LTV 都是錯的。

確認後我會先做這兩塊，其餘按 P1→P3 排程推進。
