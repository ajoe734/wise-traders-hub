# 全站效能 / 維護性審計報告 v2（窮舉版）

日期：2026-05-18 ｜ 來源：RUM perf_metrics 30 天 + edge logs 7 天 + 全部 60 個頁面靜態分析 + DB schema/index
範圍：依 `src/App.tsx` 路由表全部 60+ 路由，純評估、無 code change / migration / deploy。

> 統計指令：`useEffect / supabase.from|rpc|functions / useQuery|useMutation / enabled:` 全 grep。
> 每個 [Px] tag 都是針對該頁的可執行行動，不混合「全站建議」與「單頁建議」。

---

## 1. 真實數據摘要

### 1.1 RUM 路由（過去 30 天，p95）

| 路由 | samples | p50 LCP | p75 LCP | **p95 LCP** | p95 FCP | p95 CLS | 評級 |
|---|---:|---:|---:|---:|---:|---:|---|
| `/free-checkup` | 6 | 32,428 | 45,114 | **55,263 ms** | 72,489 | — | 🔴 P0 |
| `/` | 16 | 2,351 | 3,074 | **10,818 ms** | 73,504 | **1.28** | 🟠 P1（含 CLS） |
| `/auth/register` | 1 | 5,119 | 5,119 | **5,119 ms** | 5,119 | — | 🟡 樣本少 |
| `/legal` | 9 | 1,721 | 1,780 | 1,865 | 58,604 | — | ✅ |
| `/experts` | 4 | 87 | 174 | 244 | 62,491 | — | ✅ |
| `/pricing` | 2 | 93 | 93 | 93 | 69,942 | — | ✅ |
| `/app` | 1 | — | — | — | 100,140 | — | ⚠️ 1 sample 異常 |
| 其餘 55+ 路由 | 0 | — | — | — | — | — | ⚠️ RUM 未覆蓋 |

**註**：p95 FCP 全部都 50-100s 是 RUM 在頁面背景化時 `PerformanceObserver` 持續累積造成的虛假尾端，**不可採信**；以 LCP 為準。CLS 1.28 是 Index.tsx 嚴重 layout shift。

### 1.2 Edge functions（7 天）

| function_id | calls | avg ms | max ms | errors |
|---|---:|---:|---:|---:|
| cleanup-announcements | 5 | 531 | 649 | 0 |
| backfill-daily-snapshots | 2 | 906 | 1,034 | 0 |
| stock-price-sync | 2 | 308 | 353 | 0 |
| (unknown) | 1 | 434 | 434 | 0 |

**結論**：user-facing edge function 0 樣本，全部命中前端 react-query 24h persister 或從未被呼叫。**這是測量盲點**，不是真的沒有問題；建議延長為 30 天再看一次。

### 1.3 慢 SQL

`postgres_logs` 24h 內僅 1 ERROR + 噪音 grant/revoke，**無慢 query 樣本**（同樣是低流量盲點）。

---

## 2. 各頁問題清單（窮舉 60 個路由）

> 格式：路由 / 行數 / `ue` useEffect / `sb` supabase 直查 / `rq` useQuery 數 / 等級
> [P0] 影響首屏或大量用戶；[P1] 大檔/熱頁；[P2] 後台小檔/低風險

### 2.1 公開 Portal（9）

#### `/` Index.tsx — 921 行 / ue 0 / sb 0 / rq 0
- 🟠 **[P1]** RUM p95 LCP 10.8s + **CLS 1.28**（極差）：below-the-fold section 改 `LazyOnVisible`，hero image 強制宣告 `width/height` + `aspect-ratio`，**首要修 CLS**。
- 🟡 **[P2]** 921 行單檔可拆 4-5 個 section component。

#### `/experts` Experts.tsx — 150 行 / ue 0 / sb 0 / rq 0
- ✅ p95 244ms，已用 hook，無動作。

#### `/expert/:slug` ExpertProfile.tsx — 388 行 / ue 0 / sb 0 / rq 0
- 🟡 **[P2]** RUM 0 sample 待量測；結構已用 hook，先觀察。

#### `/plan/:slug/:planId` PlanDetail.tsx — 167 行 / ue 0 / sb 0 / rq 0
- ✅ 用 hook，無動作。

#### `/pricing` Pricing.tsx — 283 行 / ue 3 / sb 0 / rq 0
- ✅ p95 93ms。useEffect 是 scroll/UI 副作用，無 fetch。

#### `/free-checkup` FreeCheckup.jsx — **3,595 行 / ue 29 / sb 7 / rq 0**
- 🔴 **[P0-1]** p95 LCP 55s：跑 `bunx vite build && du -h dist/assets/*FreeCheckup* | sort -h` 看 chunk 大小，profile 首屏 render。
- 🔴 **[P0-2]** 7 次 `supabase.from` 全走 `useEffect`，無 react-query、無 cache，tab 切回重抓。
- 🔴 **[P0-3]** 29 個 useEffect 在同一檔，狀態依賴極度複雜，需切 store/hook。
- 🟠 **[P1]** 3,595 行硬合約（`wb-hero-grid` / `.wb-card` 字面 CSS）無法外移，但可把 7 個 supabase 抽到 `useFreeCheckup*()` hook 群。

#### `/legal` Legal.tsx — 165 行
- ✅ p95 1.86s 可接受。

#### `/checkout/:slug/:planId` Checkout.tsx — 808 行 / ue 7 / sb 4 / rq 0
- 🟠 **[P1]** 7 個 useEffect + 4 個 supabase 直查，全 0 react-query。建議抽 `useCheckoutFlow()`。
- 🟡 **[P2]** 808 行可拆 PaymentForm / ConsentDialog / Summary。

#### `/checkout/checkup/:planId` CheckupCheckout.tsx — 363 行 / ue 3 / sb 3 / rq 0
- 🟠 **[P1]** 3 個 supabase 直查無 cache；結構與 Checkout 高度重疊，可共用 hook。

---

### 2.2 Portfolio /portfolio/:id（checkup 子路由 8 個）
8 條子路由全部在 `src/checkup/pages/`，由 `PortfolioLayout` + zustand stores 驅動，**無 RUM 樣本**。
- 🟡 **[P2]** 待 RUM 累積；store 架構已用 zustand selector，不在常規 supabase 直查問題範圍。

---

### 2.3 Auth（5）

| 路由 | 行 | ue | sb | rq | 評級 | 動作 |
|---|---:|---:|---:|---:|---|---|
| `/auth/login` | 186 | 2 | 0 | 0 | ✅ | 一次性，無動作 |
| `/auth/register` | 197 | 0 | 0 | 0 | 🟡 **[P2]** | p95 5.1s 但 1 sample，等多樣本再判斷 |
| `/auth/forgot-password` | 117 | 0 | 0 | 0 | ✅ | — |
| `/auth/reset-password` | 166 | 2 | 0 | 0 | ✅ | 一次性流程 |
| `/auth/line-callback` | 135 | 2 | 0 | 0 | ✅ | 一次性流程 |

---

### 2.4 Account（3）

| 路由 | 行 | ue | sb | rq | 評級 | 動作 |
|---|---:|---:|---:|---:|---|---|
| `/account/profile` | 214 | 0 | 0 | 0 | ✅ | 用 hook |
| `/account/remittance` MyRemittanceOrders | 166 | 0 | 1 | 3 | ✅ | 1 個 supabase 是 mutation OK |
| `/account/notifications` | 201 | 0 | 5 | 6 | 🟡 **[P2]** | 5 個直查可考慮抽 hook，但已搭 useQuery |

---

### 2.5 會員 App（11）

| 路由 | 行 | ue | sb | rq | 評級 | 動作 |
|---|---:|---:|---:|---:|---|---|
| `/app` AppHome | 244 | 0 | 0 | 2 | ✅ | 完全 react-query |
| `/app/signals` Signals | 175 | 2 | 0 | 2 | ✅ | useEffect 是 realtime 訂閱 |
| `/app/signal/:id` SignalDetail | 215 | 2 | 0 | 2 | ✅ | enabled !!id OK |
| `/app/journals` Journals | 226 | 2 | 0 | 2 | ✅ | |
| `/app/journal/:id` JournalDetail | 260 | 2 | 0 | 2 | ✅ | |
| `/app/explore` Explore | 113 | 0 | 0 | 0 | ✅ | |
| `/app/expert/:slug` ExpertDetail | 230 | 2 | 1 | 2 | 🟡 **[P2]** | 1 個直查可併入 useExpert |
| `/app/account` Account | 562 | 2 | 1 | 0 | 🟠 **[P1]** | 562 行 + 0 useQuery，純 useEffect+supabase；抽 `useAccountSubscriptions()` |
| `/app/checkout/:slug/:planId` AppCheckout | 562 | 4 | 8 | 0 | 🟠 **[P1]** | **8 個** supabase 直查，無 cache；與 `/checkout` 邏輯重疊嚴重 |
| `/app/explore` LearningDashboard | 154 | 0 | 0 | 0 | ✅ | |
| `/app/signals-dashboard` | 193 | 0 | 0 | 2 | ✅ | |

---

### 2.6 Admin 後台（10）

| 路由 | 行 | ue | sb | rq | 評級 | 動作 |
|---|---:|---:|---:|---:|---|---|
| `/admin/:slug` Dashboard | 248 | 2 | **10** | 3 | 🟠 **[P1]** | 10 個直查（+3 useQuery 混用），抽 `useAdminDashboard()` |
| `/admin/:slug/signals` Signals | **1,328** | 3 | **17** | 0 | 🔴 **[P0]** | **17 個** supabase 直查、0 useQuery；抽 `useAdminSignals()` + 拆列表/篩選/編輯子元件，主檔目標 < 500 |
| `/admin/:slug/signals/edit/:id` SignalEditor | 931 | 4 | 9 | 0 | 🟠 **[P1]** | 9 直查 + 0 useQuery，form 部份拆 sections |
| `/admin/:slug/subscribers` Subscribers | 188 | 0 | 1 | 2 | ✅ | |
| `/admin/:slug/profile` Profile | 610 | 2 | 4 | 4 | 🟡 **[P2]** | 已部份 useQuery，剩 4 個直查可抽 |
| `/admin/:slug/performance` Performance | 695 | 6 | 2 | 0 | 🟠 **[P1]** | **6 個** useEffect、0 useQuery；改 useQuery 可消除多次重抓 |
| `/admin/:slug/reason-templates` | 218 | 1 | 3 | 3 | ✅ | |
| `/admin/:slug/signal-templates` | 280 | 1 | 5 | 3 | 🟡 **[P2]** | 5 直查與 3 query 混用，統一 |
| `/admin/:slug/announcements` | 94 | 0 | 0 | 2 | ✅ | |
| `/admin/:slug/plans` Plans | 482 | 0 | 5 | 3 | 🟡 **[P2]** | 5 直查抽到 `useAdminPlans()` |

---

### 2.7 Company 後台（22）

| 路由 | 行 | ue | sb | rq | 評級 | 動作 |
|---|---:|---:|---:|---:|---|---|
| `/company` Dashboard | 122 | 0 | **9** | 2 | 🟠 **[P1]** | 9 直查抽 hook |
| `/company/users` Users | 435 | 2 | 2 | 3 | ✅ | 已有 keepPreviousData |
| `/company/analysts` Analysts | 619 | **16** | 7 | 3 | 🔴 **[P0]** | **16 個 useEffect**、7 直查；最該拆的 Company 頁 |
| `/company/subscribers` | 238 | 0 | 2 | 2 | ✅ | |
| `/company/revenue` Revenue | 968 | 1 | **17** | 3 | 🔴 **[P0]** | **17 個** supabase 直查、最嚴重；抽 `useRevenueData()` 統合 |
| `/company/payments` Payments | 864 | 2 | 7 | 3 | 🟠 **[P1]** | 7 直查 + 大檔 |
| `/company/payment-settings` | 176 | 2 | 3 | 3 | ✅ | |
| `/company/remittance` | 219 | 0 | 6 | 3 | 🟡 **[P2]** | 6 直查中應有部份 mutation；已 keyed |
| `/company/announcements` | 224 | 0 | 4 | 3 | ✅ | |
| `/company/audit-logs` | 402 | 0 | 0 | 3 | ✅ | 已完成 Batch 5b |
| `/company/backtest-monitor` | 664 | 0 | 3 | 3 | ✅ | |
| `/company/checkup-usage` | 223 | 0 | 1 | 2 | ✅ | |
| `/company/function-logs` | 163 | 0 | 1 | 2 | ✅ | |
| `/company/knowledge-base` | **1,130** | 1 | **14** | 3 | 🔴 **[P0]** | 14 直查 + 1,130 行；主檔再瘦身、抽 `useKnowledgeBase()` |
| `/company/knowledge-audit` | 子頁 | — | — | — | 🟡 **[P2]** | useEffect+supabase（見清單） |
| `/company/knowledge-scheduler` | 子頁 | — | — | — | 🟡 **[P2]** | |
| `/company/plans` Plans | 742 | 2 | 4 | 3 | 🟠 **[P1]** | 742 行可拆 PlanList/SplitsEditor |
| `/company/meta-overrides` | 222 | 0 | 0 | 3 | ✅ | |
| `/company/missing-prices` | 234 | 0 | 1 | 3 | ✅ | |
| `/company/perf-metrics` | 196 | 0 | 1 | 2 | ✅ | |
| `/company/referral-channels` | 25 | 0 | 0 | 0 | ✅ | stub |
| `/company/system-jobs` | 181 | 0 | 0 | 3 | ✅ | |

---

## 3. 跨頁共通問題（彙整）

### C1. 🔴 `useEffect+supabase` 無 react-query — 完整命中清單

```
[P0]  src/pages/FreeCheckup.jsx                ue=29 sb=7  rq=0
[P0]  src/pages/admin/Signals.tsx              ue=3  sb=17 rq=0
[P0]  src/pages/company/Analysts.tsx           ue=16 sb=7  rq=3   ← useEffect 最爆
[P0]  src/pages/company/Revenue.tsx            ue=1  sb=17 rq=3
[P0]  src/pages/company/KnowledgeBase.tsx      ue=1  sb=14 rq=3
[P1]  src/pages/Checkout.tsx                   ue=7  sb=4  rq=0
[P1]  src/pages/app/AppCheckout.tsx            ue=4  sb=8  rq=0
[P1]  src/pages/app/Account.tsx                ue=2  sb=1  rq=0
[P1]  src/pages/admin/Dashboard.tsx            ue=2  sb=10 rq=3
[P1]  src/pages/admin/SignalEditor.tsx        ue=4  sb=9  rq=0
[P1]  src/pages/admin/Performance.tsx          ue=6  sb=2  rq=0
[P1]  src/pages/company/Dashboard.tsx          ue=0  sb=9  rq=2
[P1]  src/pages/company/Payments.tsx           ue=2  sb=7  rq=3
[P2]  src/pages/CheckupCheckout.tsx            ue=3  sb=3  rq=0
[P2]  src/pages/account/Notifications.tsx      ue=0  sb=5  rq=6
[P2]  src/pages/admin/Plans.tsx                ue=0  sb=5  rq=3
[P2]  src/pages/admin/Profile.tsx              ue=2  sb=4  rq=4
[P2]  src/pages/admin/SignalTemplates.tsx      ue=1  sb=5  rq=3
[P2]  src/pages/company/Plans.tsx              ue=2  sb=4  rq=3
[P2]  src/pages/company/Remittance.tsx         ue=0  sb=6  rq=3
[P2]  src/pages/app/ExpertDetail.tsx           ue=2  sb=1  rq=2
[P2]  src/pages/company/knowledge-base/*       見原報告 4 個子 panel
```
**共 22 個熱點檔 + 4 個 KB 子 panel，共 26 檔**。

### C2. 🟠 `enabled: !isAuthLoading` 公開資料阻塞
僅命中 `src/hooks/useExpert.ts`（4 處）與 `usePricingBundle.ts`（1 處）。
- `useExpert.ts:166` **已正確處理**（visibilityMode default 時 true）。
- 其餘 3 處 `enabled: !!slug && !isAuthLoading` 與 `useExpertPlans / useExpertWeeklyPerformance` 把公開資料卡在 auth resolve 後才送請求，**對未登入訪客增加 100-400ms 阻塞**。
- **[P1]** 移除這 3 處 `&& !isAuthLoading` 條件，改為純 `!!slug`。

### C3. 🟠 巨型檔（>700 行）

| 檔案 | 行 | 行動 |
|---|---:|---|
| FreeCheckup.jsx | 3,595 | 抽 hook 群（不動 CSS 字面） |
| admin/Signals.tsx | 1,328 | P0 拆 |
| company/KnowledgeBase.tsx | 1,130 | P0 主檔瘦身 |
| Index.tsx | 921 | P1 lazy below-the-fold |
| company/Revenue.tsx | 968 | P0 hook + 子元件 |
| admin/SignalEditor.tsx | 931 | P1 form sections |
| company/Payments.tsx | 864 | P1 |
| Checkout.tsx | 808 | P1 |
| company/Plans.tsx | 742 | P1 |
| company/BacktestMonitor.tsx | 664 | P2 |
| company/Analysts.tsx | 619 | P0（useEffect 16 個） |
| admin/Profile.tsx | 610 | P2 |
| app/Account.tsx | 562 | P1 |
| app/AppCheckout.tsx | 562 | P1 |

### C4. 🟡 未使用 DB indexes — **41 個 non-pkey**（完整列）

```
checkup_knowledge_candidates: uq_kb_candidates_pending_item_id, idx_kb_candidates_status, idx_kb_candidates_category
checkup_knowledge_hits:       idx_knowledge_hits_item
checkup_knowledge_items:      idx_knowledge_items_parent
checkup_plans:                checkup_plans_tier_key
checkup_prediction_accuracy:  idx_pred_accuracy_event_type, idx_pred_accuracy_reviewed_at
checkup_price_misses:         checkup_price_misses_user_symbol_idx
checkup_usage:                idx_checkup_usage_user_time
daily_price_snapshots:        idx_snapshots_limit_up
expert_limit_up_hits:         idx_hits_expert_date, idx_hits_expert, expert_limit_up_hits_expert_id_symbol_trade_date_key
expert_plans:                 idx_expert_plans_expert_active
expert_signals:               idx_expert_signals_batch_id, idx_expert_signals_executed_at
experts:                      idx_experts_status_created
function_run_logs:            idx_function_run_logs_level
holding_meta_override_history:idx_meta_override_history_user_code
knowledge_backfill_progress:  idx_backfill_symbol, knowledge_backfill_progress_symbol_yyyymm_key
knowledge_grid_search_results:idx_grid_results_item_best
line_binding_codes:           idx_binding_code_active
member_line_bindings:         member_line_bindings_user_id_expert_id_key
payment_intents:              idx_payment_intents_trade_no, payment_intents_trade_no_key, idx_payment_intents_user
payment_transactions:         idx_payment_tx_provider_tx_id_unique
plan_split_overrides:         plan_split_overrides_plan_id_key
profiles:                     profiles_line_user_id_unique
referral_attributions:        idx_ref_attr_visitor, idx_ref_attr_user
referral_channels:            referral_channels_source_key
remittance_orders:            idx_remittance_user
revenue_splits:               idx_splits_expert, idx_splits_tx
system_jobs_log:              idx_system_jobs_log_ran_at, idx_system_jobs_log_job_name
target_price_history:         idx_tph_batch, idx_tph_user_code
warrant_expiry:               idx_warrant_expiry_parent
```
**注意**：含 6 個 unique constraint（`*_key`、`*_unique`）— **不可 drop**（功能上保證唯一）。其餘 35 個是純效能 index，drop 安全但需確認查詢計畫沒退化。

### C5. 🟠 Index.tsx CLS 1.28
單一可量化的最大 UX 損失。修正方案：
1. Hero `<img>` 加 `width / height / aspect-ratio`
2. Webfont 用 `font-display: optional`（已 swap）
3. 動態插入的 section/grid 用佔位高度

### C6. ✅ 已確認 OK
- 全路由 lazy（除 Index、Legal）
- Vite manualChunks 已分群
- queryClient 24h persister + persist prefix 已配
- console.log prod drop
- critical CSS inline + font swap
- `useEffect+supabase` Batch 5b 完成（audit-logs, remittance, subscribers, users, backtest-monitor）

### C7. ⚠️ 測量盲點
- RUM 只覆蓋 7 條路由，其餘 55+ 路由零樣本
- Edge logs 7 天只 4 個 cron function、無 user-facing 樣本
- Postgres slow query 24h 無業務樣本
- **行動**：再開 30 天 RUM 回看；或把 `PerfMetricsTracker` 對 member app / admin 路由開啟（目前 internal 路由被略過）

---

## 4. 建議批次（ROI 排序）

### Batch A — P0 災難（3 PR、最高 ROI）
1. **`/free-checkup` LCP 修復**（chunk profile + 抽 supabase 為 hook）— 預期 p95 55s → 5-8s
2. **`/` Index.tsx CLS 修復**（hero img 尺寸 + lazy section）— 預期 CLS 1.28 → < 0.1、p95 LCP 10.8s → < 4s
3. **`useExpert` 3 處移除 `&& !isAuthLoading`** — 公開 expert 頁 -100~400ms

### Batch B — P0 巨型 + supabase 直查（5 PR）
4. `admin/Signals.tsx` 1,328 → 抽 `useAdminSignals()` + 拆 3 子元件
5. `company/Revenue.tsx` 968 → 抽 `useRevenueData()` 統合 17 直查
6. `company/Analysts.tsx` 619 → 拆 16 useEffect 為 hook 群
7. `company/KnowledgeBase.tsx` 1,130 → 主檔瘦身 + 抽 hook
8. `admin/SignalEditor.tsx` 931 → 拆 form sections

### Batch C — P1 useEffect→useQuery 批次（4 PR）
9. Checkout + AppCheckout + CheckupCheckout 共用 `useCheckoutFlow()`
10. admin/Dashboard + admin/Performance 改 useQuery
11. company/Dashboard + company/Payments + company/Plans 改 useQuery
12. app/Account 抽 `useAccountSubscriptions()`

### Batch D — DB 清理（1 migration、低風險）
13. Drop 35 個純 idx_scan=0 效能 index（保留 6 個 unique constraint）
14. 列入 `mem://infrastructure/database/unused-indexes` 持續監控

### Batch E — 觀測（與 A 同步）
15. 開放 `PerfMetricsTracker` 對 `/app/*` 路由（目前 internal skip）
16. 30 天後重跑本報告 §1

---

## 5. 不在範圍

- 任何 code change / migration / edge deploy
- 設計改動
- Admin/Company 功能改動
- RLS / 安全性審計（用 `security--run_security_scan`）
- SEO 審計（用 `seo_chat--trigger_scan`）

---

## 附錄 A：本次審計查詢

```sql
-- RUM 30 天
SELECT route, count(*) samples,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY lcp_ms) p50_lcp,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp_ms) p75_lcp,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY lcp_ms) p95_lcp,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY fcp_ms) p95_fcp,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY cls_score) p95_cls,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY inp_ms) p95_inp
FROM perf_metrics WHERE created_at > now() - interval '30 days'
GROUP BY route ORDER BY count(*) DESC;

-- 未使用 index（不含 pkey）
SELECT relname, indexrelname FROM pg_stat_user_indexes
WHERE schemaname='public' AND idx_scan = 0 AND indexrelname NOT LIKE '%_pkey'
ORDER BY relname;

-- Edge functions 7 天
select m.function_id, count(*) calls, avg(m.execution_time_ms) avg_ms,
  max(m.execution_time_ms) max_ms,
  sum(case when response.status_code >= 400 then 1 else 0 end) errors
from function_edge_logs
  cross join unnest(metadata) as m
  cross join unnest(m.response) as response
  cross join unnest(m.request) as request
where timestamp > timestamp_sub(current_timestamp(), interval 7 day)
group by m.function_id order by calls desc;
```

## 附錄 B：每頁 grep 統計指令
```bash
for f in $(find src/pages -name '*.tsx' -o -name '*.jsx'); do
  ue=$(grep -c useEffect "$f")
  sb=$(grep -cE 'supabase\.(from|rpc|functions)' "$f")
  rq=$(grep -cE 'useQuery|useMutation' "$f")
  echo "$f ue=$ue sb=$sb rq=$rq"
done
```
