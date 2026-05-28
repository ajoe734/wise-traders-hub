## 目標

在公司後台建立一套完整流量監控，涵蓋：
1. **流量來源**（直接、自然搜尋、社群、推薦）
2. **廣告來源**（utm_source / utm_medium / utm_campaign / utm_content / ref_code）
3. **廣告轉換營收**（哪一個 campaign 帶來多少註冊、多少訂單、多少實收）

目前已有：
- `referral_attributions`（30 天 first-touch 鎖定，但只在登入後寫入；匿名流量未被儲存）
- `payment_transactions`、`checkout_subscriptions`、`member_subscriptions`、`revenue_splits`（營收側資料完整）
- `perfMetrics`（純效能 RUM，無流量歸因）

缺口：
- 沒有匿名 page view／session 紀錄
- 沒有 referrer / 流量分類
- 沒有「campaign → 訂單」歸因表
- 後台沒有任何流量儀表板

---

## 設計

### 1. 資料層（新增 3 張表）

**`traffic_visits`** — 每次匿名造訪的 first-touch（一個 visitor_id 一筆，每 30 天可重置）
- `visitor_id`、`first_landing_path`、`first_referrer`、`first_referrer_host`
- `utm_source / medium / campaign / content / term / ref_code`
- `channel`（direct / organic / social / referral / paid / email，後端 trigger 由 utm + referrer 推導）
- `device_kind`（mobile / desktop）、`country`（可選，後續再補）
- `first_seen_at`、`last_seen_at`、`page_views`、`user_id`（登入後 backfill）

**`traffic_events`** — 輕量 page view 事件流（保留 90 天）
- `visitor_id`、`route`（normalize 過）、`occurred_at`、`user_id?`

**`conversions`** — 訂單成立時寫入，鎖定當下 attribution
- `visitor_id`、`user_id`、`order_kind`（expert_sub / checkup_sub / one_off）、`order_id`
- `utm_source / medium / campaign / content / ref_code`、`channel`
- `gross_amount`、`platform_amount`、`expert_amount`、`occurred_at`
- 由 edge function（`confirm-linepay` / `ecpay-callback` / `acpay-notify`）在付款成功時 insert

所有表加 `GRANT` + RLS（admin full、user 自己唯讀自己的列）。

### 2. 前端埋點（最小侵入）

新增 `src/lib/trafficTracker.ts`：
- 在 `App.tsx`（或 `PerfMetricsTracker` 同層）初始化
- 首次造訪：解析 `document.referrer` + URL params → POST 到新 edge function `traffic-ingest` 寫 `traffic_visits` upsert
- 每次 route change：寫 `traffic_events`（debounce、batch、`navigator.sendBeacon` on hide）
- 登入後：backfill `user_id` 到 `traffic_visits` 與 `traffic_events`
- 沿用既有 `lf_visitor_id` localStorage key，與 `useAttributionTracking` 整合（不重複埋點）

### 3. 轉換寫入（後端）

在三個付款成功的 edge function（`confirm-linepay`、`ecpay-callback`、`acpay-notify`）成功 branch 加入：
```ts
// 讀 user 最近 30 天 first-touch attribution
// 與訂單金額一起 insert conversions
```
封裝成 `supabase/functions/_shared/recordConversion.ts`。

### 4. 後台 UI（新增 `/company/traffic`）

於 `CompanyLayout` 側欄新增「流量監控」入口。頁面分三個 tab：

**Tab A：總覽**
- KPI 卡：本月 visitors / sessions / page views / 註冊數 / 訂單數 / 總營收 / 平均 CVR / 平均 CAC（若有手動輸入廣告花費）
- 折線圖：每日訪客 vs 註冊 vs 訂單

**Tab B：流量來源**
- channel 分布甜甜圈 / 表格（direct / organic / social / referral / paid / email）
- referrer host top 20 表格
- landing page top 20 表格

**Tab C：廣告與轉換營收**
- 以 `utm_campaign` 為主鍵的彙總表：
  | campaign | source/medium | visits | signups | orders | gross | platform | CVR | ARPU |
- 可下鑽到單一 campaign 看 utm_content 細分
- 可手動於每個 campaign 輸入「廣告花費」（新表 `ad_spend`：campaign + month + spend）→ 算 ROAS / CAC
- 日期區間：本月 / 上月 / 近 3 月 / 自訂

所有圖表沿用既有 `RevenueCharts.tsx` lazy pattern，避免膨脹 company entry。

### 5. 排程與資料保留

新增 `traffic-cleanup` cron（每日）：
- `traffic_events` 保留 90 天
- `traffic_visits` 保留 365 天
- 從 `supabase/config.toml` 註冊 `verify_jwt = false`

### 6. 美學

維持後台一致風格（`hsl(var(--company))` 系列），不套用江湖卷軸樣式（這是內部後台）。

---

## 技術細節

**Channel 推導規則**（DB function 或 edge function）：
```
if utm_medium in (cpc, paid, ppc, display) → paid
elif utm_source 存在 → 依 source（fb/ig/line → social；google_search → organic 等）
elif referrer host 屬於搜尋引擎 → organic
elif referrer host 屬於社群 → social
elif referrer 存在 → referral
else → direct
```

**`traffic_visits` 不會過度寫入**：
- 前端先判斷 localStorage 是否已有 visit_logged 標記（24h TTL），有就 skip ingest
- ingest edge function upsert by visitor_id，increment `page_views`、更新 `last_seen_at`

**Page view 量級控制**：
- `traffic_events` 只寫 route，不寫 query string，避免 PII
- 內部路由（/company、/admin）不追蹤

**與既有 `referral_attributions` 的關係**：
- 保留現表（不破壞既有歸因），但新版 `traffic_visits` 為主資料源
- 在 migration 中將舊資料 backfill 到 `traffic_visits`

---

## 交付步驟

1. Migration：建立 `traffic_visits` / `traffic_events` / `conversions` / `ad_spend` + RLS + GRANT + channel 推導 function + cleanup cron 註冊
2. Edge functions：`traffic-ingest`、`traffic-cleanup`、`_shared/recordConversion.ts`
3. 修改三個付款 callback 寫入 `conversions`
4. 新增 `src/lib/trafficTracker.ts` + 在 `App.tsx` 初始化
5. 新增 `src/pages/company/Traffic.tsx`（三個 tab）+ 圖表 lazy chunk
6. 在 `CompanyLayout` 側欄加入口、`App.tsx` 註冊 route
7. 文件：在 `mem://infrastructure/traffic-monitoring` 紀錄 schema 與保留政策

不修改首頁、不動 Index.tsx，不影響既有江湖視覺。
