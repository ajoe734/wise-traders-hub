# 全站效能 / 維護性審計報告

日期：2026-05-18 ｜ 來源：RUM perf_metrics 30 天 + edge logs 24 h + 源碼靜態分析 + DB schema/index

> 本報告為純評估，無任何 code change / migration / edge deploy。

---

## 1. 真實數據摘要（RUM 過去 30 天）

| 路由 | samples | p75 LCP | p95 LCP | 狀態 |
|---|---:|---:|---:|---|
| `/free-checkup` | 6 | **45,114 ms** | **55,263 ms** | 🔴 P0 災難級 |
| `/` | 15 | 3,114 ms | **11,817 ms** | 🟠 P1 長尾差 |
| `/auth/register` | 1 | 5,119 ms | 5,119 ms | 🟠 P1（樣本少待確認） |
| `/legal` | 9 | 1,780 ms | 1,865 ms | ✅ 好 |
| `/experts` | 4 | 174 ms | 244 ms | ✅ 已優化 |
| `/pricing` | 2 | 93 ms | 93 ms | ✅ 已優化 |
| `/app` | 1 | — | — | sample 不足 |
| 其餘 100+ 路由 | 0 | — | — | ⚠️ RUM 未覆蓋（流量稀疏 / RUM 剛啟用） |

**Edge functions 24 h**：只有 5 個 cron function 有呼叫（cleanup-announcements、expire-subscriptions、backfill-daily-snapshots、stock-price-sync、+1 unknown），最高 avg 986 ms，**user-facing 流程 0 樣本**——表示前端對 edge functions 的依賴幾乎都被 react-query 24 h persister 命中，或 logs 24 h 視窗太短。

**Postgres 24 h**：1 個 ERROR、147 LOG、2855 WARNING（全部是 Supabase 內部 grant/revoke 噪音，與業務無關）。

---

## 2. 全站頁面盤點（100+ 頁，無採樣）

### 2.1 Public（5 頁）

| 路由 | 行數 | useEffect | supabase.from | RUM p95 LCP | 評級 |
|---|---:|---:|---:|---:|---|
| `/` Index.tsx | 1,049 | — | — | 11,817 ms | 🟠 **P1** |
| `/free-checkup` FreeCheckup.jsx | **3,595** | **29** | 5 | **55,263 ms** | 🔴 **P0** |
| `/experts` Experts.tsx | 150 | — | 0 | 244 ms | ✅ |
| `/expert/:slug` ExpertProfile.tsx | 388 | — | 0 | — | 🟡 待量測 |
| `/pricing` Pricing.tsx | 283 | — | 0 | 93 ms | ✅ |
| `/legal` Legal.tsx | — | — | 0 | 1,865 ms | ✅ |
| `/plan/:slug/:planId` PlanDetail.tsx | — | — | — | — | 🟡 |

### 2.2 Member App（13 頁）

| 路由 | 行數 | 評級 | 主要問題 |
|---|---:|---|---|
| `/app/account` Account.tsx | 562 | 🟡 P2 | 中型，需檢查是否多次串接 |
| `/app/checkout` AppCheckout.tsx | 562 | 🟡 P2 | 已有 useExpert/useExpertPlans/usePricingBundle，OK |
| `/app/journals` Journals.tsx | 226 | ✅ | 用 hook |
| `/app/journal/:id` JournalDetail.tsx | 260 | 🟡 P2 | 有 useEffect+supabase |
| `/app/signals` Signals.tsx | — | 🟡 P2 | 有 useEffect+supabase |
| `/app/signal/:id` SignalDetail.tsx | — | 🟡 P2 | 有 useEffect+supabase |
| `/app/explore` Explore.tsx | — | ✅ | 應已用 hook |
| `/app/expert/:slug` ExpertDetail.tsx | 230 | 🟡 P2 | 有 useEffect+supabase |
| `/app/home` AppHome.tsx | 244 | ✅ | |
| 其餘 App 頁 | 各 < 250 | ✅ | |

### 2.3 Checkout / Auth（8 頁）

| 路由 | 行數 | 評級 | 主要問題 |
|---|---:|---|---|
| `/checkout/:slug/:planId` Checkout.tsx | **808** | 🟠 **P1** | 7 useEffect、間接 supabase fetch |
| `/checkout/checkup/:planId` CheckupCheckout.tsx | — | 🟡 P2 | 結構應與 Checkout 重疊 |
| `/auth/login`、`/auth/register`、`/auth/forgot-password`、`/auth/reset-password`、`/auth/line/callback` | 各 < 300 | 🟡 P2 | LineCallback 有 useEffect+supabase |

### 2.4 Admin（10 頁，分析師後台）

| 路由 | 行數 | useEffect | supabase.from | 評級 | 主要問題 |
|---|---:|---:|---:|---|---|
| `/admin/signals` Signals.tsx | **1,328** | 3 | **12** | 🟠 **P1** | 直接 12 個 supabase.from，無 react-query 抽象 |
| `/admin/signal/:id/edit` SignalEditor.tsx | **931** | — | 多 | 🟠 P1 | 大檔，需拆 |
| `/admin/performance` Performance.tsx | 695 | **6** | — | 🟠 P1 | 6 個 useEffect 可能造成 N 次 fetch |
| `/admin/profile` Profile.tsx | 610 | — | 3 | 🟡 P2 | |
| `/admin/plans` Plans.tsx | 482 | — | — | 🟡 P2 | |
| `/admin/signal-templates` SignalTemplates.tsx | 280 | — | — | 🟡 P2 | |
| `/admin/dashboard` Dashboard.tsx | 248 | 2 | **8** | 🟠 P1 | 8 個 supabase.from |
| `/admin/announcements` Announcements.tsx | — | — | — | 🟡 P2 | |
| `/admin/reason-templates` ReasonTemplates.tsx | — | — | — | 🟡 P2 | |
| `/admin/subscribers` Subscribers.tsx | — | — | — | 🟡 P2 | |

### 2.5 Company（21 頁，公司後台）

| 路由 | 行數 | supabase.from | 評級 | 主要問題 |
|---|---:|---:|---|---|
| `/company/knowledge-base` KnowledgeBase.tsx | **1,130** | **10** | 🟠 **P1** | 含 4 個子 panel/dialog（已分） |
| `/company/revenue` Revenue.tsx | **968** | **16** | 🟠 **P1** | 16 個直接 supabase.from，最嚴重 |
| `/company/payments` Payments.tsx | 864 | 5 | 🟠 P1 | |
| `/company/plans` Plans.tsx | 742 | — | 🟡 P2 | |
| `/company/backtest-monitor` BacktestMonitor.tsx | 664 | — | 🟡 P2 | |
| `/company/analysts` Analysts.tsx | 619 | — | 🟡 P2 | |
| `/company/users` Users.tsx | 435 | — | 🟡 P2 | |
| `/company/audit-logs` AuditLogs.tsx | 402 | — | 🟡 P2 | |
| `/company/subscribers` Subscribers.tsx | 238 | — | ✅ | |
| `/company/missing-prices` MissingPrices.tsx | 234 | — | ✅ | |
| `/company/announcements` Announcements.tsx | 224 | — | ✅ | |
| `/company/dashboard`、`/company/perf-metrics`、`/company/system-jobs`、`/company/function-logs`、`/company/remittance`、`/company/payment-settings`、`/company/referral-channels`、`/company/checkup-usage`、`/company/meta-overrides`、`/company/knowledge-base/*` (2 子頁) | 各 < 250 | — | ✅ | |

---

## 3. 跨頁共通問題

### C1. 🔴 巨型檔案無法維護（>700 行）

| 檔案 | 行數 | 行動 |
|---|---:|---|
| FreeCheckup.jsx | 3,595 | 已抽 6 個 tab + constants，但主檔還是肥；剩餘 hero/orchestrator 拆不下來（硬合約） |
| admin/Signals.tsx | 1,328 | **P1** 抽 `useAdminSignals()` hook + 列表/編輯子元件 |
| company/KnowledgeBase.tsx | 1,130 | **P1** 已有子 panel，主檔再瘦身 |
| Index.tsx | 1,049 | **P1** 多 section，可懶載入 below-the-fold |
| company/Revenue.tsx | 968 | **P1** 抽 `useRevenueData()` hook 把 16 個 supabase.from 集中 |
| admin/SignalEditor.tsx | 931 | **P1** 拆 form sections |
| company/Payments.tsx | 864 | P2 |
| Checkout.tsx | 808 | P2 |
| company/Plans.tsx | 742 | P2 |

### C2. 🟠 直接 `supabase.from` 繞過 react-query（重複 fetch、無 cache）

熱點：admin/Signals (12)、company/Revenue (16)、company/KnowledgeBase (10)、admin/Dashboard (8)、Payments (5)、FreeCheckup (5)。  
**行動**：每個熱點頁建一支 hook（`useXxx()` 回 `useQuery`），把多支 query 收進去；同時加 `queryKey` 命名規範。

### C3. 🟠 useEffect + supabase 模式（30+ 檔）

每次 mount 都重抓、無 stale-while-revalidate、tab 切回也重抓。30 個檔案命中此模式（清單見第 4 節）。  
**行動**：批次改寫為 `useQuery`，受益於 24 h persister。

### C4. 🟡 未使用的 DB indexes（idx_scan=0，30+ 個）

```
expert_limit_up_hits: idx_hits_expert_date, idx_hits_expert, expert_limit_up_hits_expert_id_symbol_trade_date_key
experts: idx_experts_status_created
revenue_splits: idx_splits_tx
expert_signals: idx_expert_signals_batch_id, idx_expert_signals_executed_at
system_jobs_log: idx_system_jobs_log_ran_at, idx_system_jobs_log_job_name
function_run_logs: idx_function_run_logs_level
profiles: profiles_line_user_id_unique
checkup_knowledge_candidates: uq_kb_candidates_pending_item_id
+ 約 15 個 pkey（pkey 不可刪）
```
**行動**：drop 11 個 non-pkey 未使用 index（節省寫入 + 縮表）。pkey 保留。

### C5. 🟡 RUM 覆蓋率低（只 7 條路由有資料）

`PerfMetricsTracker` 只在路由變化時上報 FCP/LCP；後台與 member app 流量稀疏，多數路由連 1 sample 都沒有。  
**行動**：等流量累積，或調 `PerfMetricsTracker` 的取樣策略（目前不擋）。建議再開 30 天回看。

### C6. ✅ 已驗證 OK 的項目

- Vite manualChunks：lucide / supabase / react / tanstack / tiptap / recharts / radix-core / radix-extra / utils 已分群
- 全部 100+ 路由 lazy import（除 Index 與 Legal）
- queryClient 有 PersistQueryClientProvider + 24 h persister + `PERSISTED_QUERY_PREFIXES`
- console.log 在 prod 被 esbuild drop
- `index.html` 已有 critical CSS inline + async font/CSS swap

---

## 4. 直接 `useEffect+supabase` 檔案完整清單（30 檔）

```
src/pages/FreeCheckup.jsx
src/pages/Checkout.tsx
src/pages/admin/Dashboard.tsx
src/pages/admin/Performance.tsx
src/pages/admin/ReasonTemplates.tsx
src/pages/admin/SignalEditor.tsx
src/pages/admin/SignalTemplates.tsx
src/pages/admin/Signals.tsx
src/pages/app/ExpertDetail.tsx
src/pages/app/JournalDetail.tsx
src/pages/app/Journals.tsx
src/pages/app/SignalDetail.tsx
src/pages/app/Signals.tsx
src/pages/auth/LineCallback.tsx
src/pages/auth/ResetPassword.tsx
src/pages/company/Analysts.tsx
src/pages/company/KnowledgeBase.tsx
src/pages/company/Payments.tsx
src/pages/company/Plans.tsx
src/pages/company/Revenue.tsx
src/pages/company/Users.tsx
src/pages/company/knowledge-base/AutoRulesPanel.tsx
src/pages/company/knowledge-base/BacktestRunDetailDialog.tsx
src/pages/company/knowledge-base/BackfillProgressPanel.tsx
src/pages/company/knowledge-base/CleanupCandidatesPanel.tsx
src/pages/company/knowledge-base/GridSearchDetailDialog.tsx
src/pages/company/knowledge-base/KnowledgeAudit.tsx
src/pages/company/knowledge-base/KnowledgeScheduler.tsx
src/components/layouts/SignalsLayout.tsx
src/components/layouts/UnifiedAppLayout.tsx
```

LineCallback / ResetPassword 是一次性流程，不需改；其餘 28 個都是長駐頁面，全部納入 C3 批次。

---

## 5. 建議批次執行（按 ROI 排序）

### Batch A — P0 災難（建議立刻）

1. **`/free-checkup` LCP 修復**  
   - p95 55 秒不是 fetch 慢，是 JS bundle / 初次渲染瓶頸  
   - 動作：跑一次 `bunx vite build && du -h dist/assets/*.js | sort -h | tail -20` 看 FreeCheckup chunk 大小；profile FreeCheckup.jsx 首屏 render time
   - 預期收益：p95 LCP 從 55s → 5-8s

### Batch B — P1 巨型檔 + 直接 supabase（建議第 2 週）

2. **admin/Signals.tsx 拆分**：抽 `useAdminSignals()`、`SignalListTable`、`SignalFilters`，主檔目標 < 500 行
3. **company/Revenue.tsx 拆分**：抽 `useRevenueData()` 統合 16 個 query，分 `RevenueOverview` / `RevenueByExpert` / `RevenueByPlan` 子元件
4. **admin/SignalEditor.tsx 拆 form sections**
5. **company/KnowledgeBase.tsx 主檔瘦身**
6. **Index.tsx 1049 行**：below-the-fold section 改 `LazyOnVisible`，目標壓 / p95 LCP 11.8s → < 4s

### Batch C — P1 useEffect→useQuery 批次（建議第 3 週）

7. 28 個檔案批次改寫，每個 PR 包 3-4 個檔案，共約 8 個 PR
8. 收益：tab 切回不重抓、share queryKey 命中 persister

### Batch D — DB 清理（任何時候，風險低）

9. Drop 11 個 idx_scan=0 的 non-pkey index（一支 migration 一次處理）
10. 列入 `mem://infrastructure/database/unused-indexes` 持續監控

### Batch E — 觀測補完（建議與 Batch A 同步）

11. RUM 補打：30 天後重跑本報告第 1 節 query，看 member app / admin 路由是否累積樣本
12. Edge logs 改 7 天窗口、看是否有 user-facing function 出現

---

## 6. 不在本報告範圍

- 業務邏輯正確性（看 mem 既有規範與 integration tests）
- RLS / 安全性（用 security--run_security_scan）
- SEO（用 seo_chat--trigger_scan）
- E2E 測試覆蓋率（看 .github/workflows）

---

## 附錄：本次審計用到的查詢

```sql
-- A. RUM 路由統計（30 天）
SELECT route, count(*) samples,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp_ms) p75_lcp,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY lcp_ms) p95_lcp
FROM perf_metrics
WHERE created_at > now() - interval '30 days'
GROUP BY route ORDER BY count(*) DESC;

-- B. 未使用 index
SELECT relname, indexrelname FROM pg_stat_user_indexes
WHERE schemaname='public' AND idx_scan = 0;

-- C. Edge function 24h
-- 見 supabase--analytics_query 區塊
```
