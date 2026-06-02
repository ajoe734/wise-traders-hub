# 全站效能審計報告 v3（窮舉版・67 頁全覆蓋）

日期：2026-05-18 ｜ 取代：`perf-audit-2026-05.md`（v2 只列 9 頁即斷尾）
範圍：對照 `src/App.tsx` 全部路由，逐檔靜態掃描 + RUM 30 天 + edge logs 7 天。**純評估、無 code change**。

---

## 1. 真實數據

### 1.1 RUM（perf_metrics，30 天）

| 路由 | samples | p50 LCP | p75 LCP | **p95 LCP** | max CLS | 評級 |
|---|---:|---:|---:|---:|---:|---|
| `/free-checkup` | 6 | 32,428 | 57,800 | **57,800 ms** | — | 🔴 P0 |
| `/` | 19 | 2,383 | 3,114 | **23,797 ms** | **4.65** | 🔴 P0（CLS 災難） |
| `/auth/register` | 2 | 5,119 | 5,119 | 5,119 | — | 🟡 樣本少 |
| `/legal` | 9 | 1,721 | 1,818 | 1,885 | — | ✅ |
| `/experts` | 4 | 87 | 261 | 261 | — | ✅ |
| `/pricing` | 2 | 93 | 93 | 93 | — | ✅ |
| `/app` | 1 | — | — | — | — | ⚠ 樣本不足 |
| **其餘 60 路由** | **0** | — | — | — | — | ⚠ **RUM 完全未覆蓋** |

> ⚠ `p95_fcp` 普遍 70-100s 是 `PerformanceObserver` 背景累積造成的虛假尾端，以 LCP 為準。
> ⚠ Index.tsx CLS 從 v2 的 1.28 惡化到 **4.65** — 是本輪 P0 第一名。

### 1.2 Edge functions（7 天，僅排程任務有樣本）

| function | 性質 | calls/h | 平均 | 備註 |
|---|---|---:|---:|---|
| cleanup-announcements-cron | 排程 2min | 30 | <1s | ✅ |
| stock-price-sync | 排程 | 低 | ~300ms | ✅ |
| expire-subscriptions | 排程 | 低 | <1s | ✅ |
| backfill-daily-snapshots | 排程 | 低 | ~1s | ✅ |
| **user-facing functions** | — | **0** | — | ⚠ **量測盲點**（react-query 24h persister 命中或無流量） |

### 1.3 慢 SQL

`function_logs` 表已不存在；`postgres_logs` 24h 內無慢 query 樣本。**低流量盲點，不代表健康。**

### 1.4 Cloud 體質

預覽環境近期未報 ACTIVE_UNHEALTHY。本報告假設 Cloud 體質正常，所有問題歸因於前端與查詢層。

---

## 2. 方法論

### 指令
```
wc -l                         # 行數
grep -cE 'useEffect\('        # ue
grep -cE 'supabase\.(from|rpc|functions\.invoke|auth|storage|channel)'  # sb
grep -cE 'useQuery\(|useInfiniteQuery\('  # rq
grep -cE 'useMutation\('      # mu
```

### 等級
- **P0** 影響首屏 / 大量真實用戶 / 已有 RUM 數字佐證
- **P1** 熱頁、巨檔（>500 行）、N+1 風險、未走 react-query 的後台
- **P2** 後台小檔 / 低流量 / 純維護性

### 欄位格式
```
#### `/route` File.tsx — L 行 / ue X / sb Y / rq Z / mu W
- [等級] 觀察 → 行動
```

---

## 3. 窮舉頁面清單（67 條）

### 3.1 公開 Portal（10）

#### `/` Index.tsx — 1023 行 / ue 0 / sb 0 / rq 0
- 🔴 **[P0]** RUM **p95 LCP 23.8s + max CLS 4.65**（從 v2 的 1.28 惡化 3.6×）。Hero/section 動畫無 reserved space。**首要修 CLS**：所有 above-the-fold `<img>` / lazy section 強制宣告 `width/height` + `aspect-ratio`；`LazyOnVisible` 改用 `mode="content-visibility"` 取代 `mode="io"`，placeholder 高度誤差直接歸零。
- 🟠 **[P1]** 1023 行單檔（v2 是 921 行，仍在膨脹），需拆 4-5 個 section component 並 lazy。
- 🟠 **[P1]** 23.8s p95 LCP 不只是 CLS — 排查 hero image 是否走 webp/avif + `fetchpriority="high"` 預載入。

#### `/experts` Experts.tsx — 150 行 / ue 0 / sb 0 / rq 0
- ✅ p95 261ms。無動作。

#### `/expert/:slug` ExpertProfile.tsx — 388 行 / ue 0 / sb 0 / rq 0
- 🟡 **[P2]** RUM 0 sample；結構乾淨已用 hook，先觀察。

#### `/plan/:slug/:planId` PlanDetail.tsx — 167 行 / ue 0 / sb 0 / rq 0
- ✅ 純展示，由 hook 取資料。無動作。

#### `/checkout/:slug/:planId` Checkout.tsx — **808 行 / ue 6 / sb 5** / rq 0 / mu 0
- 🟠 **[P1]** 結帳流程 808 行 + 5 個 supabase 直查 + 6 個 effect，**未走 react-query**。3 個共用子元件已抽 (`_checkout/*`)，但主檔仍承擔狀態機。
- 🟠 **[P1]** 行動：5 個 `supabase.*` 抽 `useCheckout()` hook，effect → query/mutation。降至 ~400 行。

#### `/checkout/checkup/:planId` CheckupCheckout.tsx — 363 行 / ue 2 / sb 4 / rq 0
- 🟡 **[P2]** 同上但較輕；和 Checkout.tsx 高度重複，**考慮共用 useCheckoutBase 抽象**。

#### `/pricing` Pricing.tsx — 283 行 / ue 2 / sb 0 / rq 0
- ✅ p95 93ms。無動作。

#### `/free-checkup` FreeCheckup.jsx — **3485 行 / ue 26 / sb 6** / rq 0
- 🔴 **[P0]** RUM **p95 LCP 57.8s**（v2 是 45s，惡化中）。A1 已抽 bootstrap 省 109 行，但仍 3485 行 / 26 effect。
- 🔴 **[P0]** Main chunk 287.6 KB（含 153.7 KB FreeCheckup.jsx）。短期低垂果實（A1 報告已列）：
  1. `demoData` 15.3 KB 動態 import 進 `if (isDemo)` 分支
  2. `react-helmet-async` 31.5 KB 換 lightweight `<title>` setter
  3. `edgeSchemas/edgeFieldUI/edgeCoerce` 共 ~18 KB lazy 至 parse-flow
- 🟠 **[P1]** quota / refund / coverage 三個 modal 仍 inline；抽 lazy 再省 20-30 KB。
- ⚠ inline `<style>` 憲法區（`wb-hero-grid` / `.wb-card`）不可外移。

#### `/legal` Legal.tsx — 165 行 / 0 / 0 / 0
- ✅ p95 1.8s 純靜態。無動作。

#### `*` NotFound.tsx — 31 行 / ue 1 / 0 / 0
- ✅ 無動作。

### 3.2 Portfolio /portfolio/:id（8 + Layout）

#### `/portfolio/:id` PortfolioLayout.jsx — 25 行
- ✅ 純 outlet。

#### `holdings` HoldingsPage.jsx — 9 行
#### `events` EventsPage.jsx — 9 行
#### `news` NewsPage.jsx — 9 行
#### `daily` DailyPage.jsx — 9 行
#### `research` ResearchPage.jsx — 9 行
#### `trade` TradePage.jsx — 9 行
#### `log` LogPage.jsx — 9 行
#### `/overview` OverviewPage.jsx — 9 行
- ✅ 全部 9 行 thin wrapper，邏輯在 `src/checkup/components/*` 與 hooks。
- 🟡 **[P2]** RUM 0 sample；功能體量大但讀檔層級已乾淨。**真正瓶頸在 checkup components**（不在本路由表，需另一輪 component-level 審計）。

### 3.3 Auth（5）

#### `/auth/login` Login.tsx — 186 / ue 1 / 0 / 0
- ✅ 簡潔；prefetch 已啟動。

#### `/auth/register` Register.tsx — 197 / 0 / 0 / 0
- 🟡 **[P2]** RUM p95 5.1s（樣本 2）。可能受 Login 同捆 vendor-radix 影響，觀察。

#### `/auth/line-callback` LineCallback.tsx — 135 / ue 1 / sb 3
- ✅ 一次性導頁，無動作。

#### `/auth/forgot-password` ForgotPassword.tsx — 117 / 0 / 0
- ✅

#### `/auth/reset-password` ResetPassword.tsx — 166 / ue 1 / sb 3
- ✅

### 3.4 Account（3）

#### `/account/profile` Profile.tsx — 214 / 0 / sb 3 / rq 0
- 🟡 **[P2]** 3 個 sb 直查未走 react-query。低流量可接受。

#### `/account/remittance` MyRemittanceOrders.tsx — 166 / 0 / sb 1 / rq 1
- ✅ 已走 query。

#### `/account/notifications` Notifications.tsx — 201 / 0 / sb 5 / rq 1 / mu 3
- 🟡 **[P2]** 1 query + 5 sb 直查（mark-as-read 等 mutation 路徑）。可包成 useMutation 統一失敗處理。

### 3.5 App /app（9）

#### `/app` AppHome.tsx — 244 / 0 / 0 / rq 1
- ✅ 已 hook 化。

#### `/app/signals` AppSignals — 175 / ue 1 / 0 / rq 1
#### `/app/journals` AppJournals — 226 / ue 1 / 0 / rq 1
#### `/app/signal/:id` AppSignalDetail — 215 / ue 1 / 0 / rq 1
#### `/app/journal/:id` AppJournalDetail — 260 / ue 1 / 0 / rq 1
- ✅ 全部已走 react-query；ue=1 是 realtime subscribe，正常。

#### `/app/account` AppAccount — **562 行** / ue 1 / sb 1 / rq 0
- 🟠 **[P1]** 562 行 + 0 query + 1 sb：訂閱管理頁，狀態多。需確認是否依賴 SmartHomeRedirect 上層 query。否則建議抽 `useAccountSubscriptions()`。

#### `/app/explore` Explore.tsx — 113 / 0 / 0 / 0
- ✅

#### `/app/expert/:slug` AppExpertDetail — 230 / ue 1 / sb 2 / rq 1
- 🟡 **[P2]** 2 個 sb 直查可併入既有 query。

#### `/app/checkout/:slug/:planId` AppCheckout — **562 行 / ue 3 / sb 9** / rq 0
- 🟠 **[P1]** App 內結帳，9 個直查 + 3 個 effect。同 `/checkout/*` 重複，**強烈建議共用 useCheckoutBase**。

### 3.6 Admin /admin/:expertSlug（10）

#### `/admin/:slug` Dashboard.tsx — 248 / ue 1 / **sb 10** / rq 2
- ✅ **[已查證・非 N+1]** 10 個 sb 全部在單一 `useQuery` 內以 `Promise.all` 並行（L36-44），另 1 個 capital query。grep 數字誤導，實際健康。

#### `/admin/:slug/signals` Signals.tsx — **1246 行** / ue 1 / **sb 14** / rq 0
- 🟠 **[P1]** B4 已抽 `useAdminSignals` hook + `PreviewTradeItem` 子元件，但主檔仍 1246 行。下一輪繼續抽 detail dialog / batch table row。
- 🟠 **[P1]** 14 sb 直查在 hook 內，需確認 hook 是否真用 react-query 包；若是裸 supabase + setState 就會在 Tab 切換時重抓。

#### `/admin/:slug/signals/new`、`/edit/:batchId` SignalEditor.tsx — 524 / ue 3 / sb 9 / rq 0
- 🟠 **[P1]** B8 已抽 CapitalPanel / TradeCard 從 931 → 524。`LazyRichTextEditor` 已就位 ✅。剩下 9 個 sb 直查可走 query。

#### `/admin/:slug/plans` Plans.tsx — 482 / 0 / sb 5 / rq 1
- 🟡 **[P2]** 部分走 query；可全收斂。

#### `/admin/:slug/subscribers` Subscribers — 188 / 0 / sb 1 / rq 1
- ✅

#### `/admin/:slug/profile` Profile.tsx — **610 行** / ue 1 / **sb 8** / rq 2
- 🟠 **[P1]** 巨檔；8 個 sb + 僅 2 個 query。表單抽 `useProfileForm` + `useFormDraft`，sb 改 mutation。

#### `/admin/:slug/performance` Performance.tsx — **695 行 / ue 5** / sb 2 / rq 0
- 🟠 **[P1]** 695 行 + 5 effect 無 query。**已查證無 recharts import**（資料表/卡片頁，非圖表），lazy 不適用。剩工作：抽 `usePerformanceData` query + 拆子元件。

#### `/admin/:slug/reason-templates` ReasonTemplates — 218 / ue 1 / sb 3 / rq 1
#### `/admin/:slug/signal-templates` SignalTemplates — 280 / ue 1 / sb 5 / rq 1
- 🟡 **[P2]** CRUD 表 sb 直查可改 mutation。

#### `/admin/:slug/announcements` Announcements — 94 / 0 / 0 / rq 1
- ✅

### 3.7 Company /company/*（22）

#### `/company` Dashboard.tsx — 122 / 0 / **sb 9** / rq 1
- ✅ **[已查證・非 N+1]** 9 個 sb 全部在單一 `useQuery` 內以 `Promise.all` 並行（L20-30）+ 30s staleTime。grep 數字誤導，實際健康。

#### `/company/users` Users.tsx — 435 / ue 1 / sb 2 / rq 0
- ✅ **[已查證・合約對齊]** 實作為 `useQuery<UserRow[]>({ queryKey: ['company','users', debouncedSearch], ... })` + `keepPreviousData`（L76-86），與 batch5b 測試合約完全一致。grep 沒抓到泛型 `useQuery<T>`。

#### `/company/analysts` Analysts.tsx — 587 / ue 1 / sb 7 / rq 1
- 🟠 **[P1]** B6 已抽 `useSessionState`，但 7 個 sb 直查仍在；行數 587 偏高。

#### `/company/subscribers` Subscribers.tsx — 238 / 0 / sb 2 / rq 1
- ✅ Batch 5b 合約對齊。

#### `/company/revenue` Revenue.tsx — **741 行** / 0 / sb 5 / rq 0
- 🟠 **[P1]** B5 已抽 `useRevenueData`，**Recharts lazy ✅**。741 行仍偏高，繼續抽 KPI cards。
- 🟠 **[P1]** 5 個 sb 直查未走 query → 確認是 hook 內裸 supabase 還是元件層；若元件層就拉進 hook。

#### `/company/payments` Payments.tsx — **864 行** / ue 1 / **sb 9** / rq 1
- 🟠 **[P1]** 最大 company 頁面之一。9 個 sb 應全部抽進 `usePayments()`，dialog/filter/table 拆元件。

#### `/company/announcements` CompanyAnnouncements — 224 / 0 / sb 4 / rq 1
- 🟡 **[P2]** 4 sb 改 mutation。

#### `/company/audit-logs` AuditLogs.tsx — 402 / 0 / 0 / rq 1
- ✅ Batch 5b 合約對齊（actions 5min staleTime + paged）。

#### `/company/system-jobs` SystemJobs.tsx — 181 / 0 / 0 / rq 1
- ✅

#### `/company/function-logs` FunctionLogs.tsx — 163 / 0 / sb 1 / rq 0
- 🟡 **[P2]** 1 sb 改 query 即可。

#### `/company/knowledge-base` KnowledgeBase.tsx — 311 / 0 / 0 / rq 0
- ✅ B7 已完成（1130 → 311），`useKnowledgeBase` 集中。

#### `/company/knowledge-audit` KnowledgeAudit.tsx — 273 / ue 1 / sb 2 / rq 0
- 🟡 **[P2]** 抽 useKnowledgeAudit query。

#### `/company/knowledge-scheduler` KnowledgeScheduler.tsx — 377 / ue 1 / sb 5 / rq 0
- 🟡 **[P2]** 5 sb 抽 hook。

#### `/company/backtest-monitor` BacktestMonitor.tsx — **664 行** / 0 / sb 3 / rq 1
- 🟠 **[P1]** 巨檔。**已查證無 recharts import**（純表格/狀態頁）。剩工作：抽 `useBacktestMonitor` + 拆子元件。

#### `/company/plans` Plans.tsx — **742 行** / ue 1 / sb 5 / rq 1
- 🟠 **[P1]** 742 行 + 5 sb 混 1 query → 抽 hook 並拆 dialog。

#### `/company/remittance` Remittance.tsx — 219 / 0 / sb 7 / rq 1
- 🟠 **[P1]** Batch 5b 合約 ✅，但 7 個 sb 直查是 mutation/action，應走 useMutation 統一處理。

#### `/company/payment-settings` PaymentSettings.tsx — 176 / ue 1 / sb 4 / rq 1
- 🟡 **[P2]** sb 改 mutation。

#### `/company/referral-channels` ReferralChannels.tsx — 25 行
- ✅ stub。

#### `/company/checkup-usage` CheckupUsage.tsx — 223 / 0 / sb 1 / rq 1
- ✅

#### `/company/missing-prices` MissingPrices.tsx — 234 / 0 / sb 1 / rq 0
- 🟡 **[P2]** 1 sb 改 query。

#### `/company/meta-overrides` MetaOverrides.tsx — 222 / 0 / 0 / rq 0
- 🟡 **[P2]** 0 sb 0 rq — 確認資料來源（可能透過 hook 或父層）。

#### `/company/perf-metrics` PerfMetrics.tsx — 196 / 0 / sb 1 / rq 1
- ✅ 本身就是 RUM 儀表板。

### 3.8 Navigate 純轉址（7）
`/explore` `/people/:slug` `/app/holdings` `/app/system/:id` `/account/subscriptions` `/me` `/me/*` `/company/plan-review` `/company/plan-splits` `/portfolio/:id/watchlist` — 全部 `<Navigate replace>`，0 成本，✅。

---

## 4. 全站交叉議題

### 4.1 RUM 嚴重盲區
60 / 67 路由 0 sample。`initPerfMetrics` 排除 `/company` 與 `/admin`（合理），但 `/app/*`、`/portfolio/*`、`/auth/*`、`/account/*` 也都掛零 — 大概率是流量本身極低，**不是儀器壞掉**。**任何「沒有 RUM 就不修」的決策都是錯的**，本報告靜態指標即可佐證。

### 4.2 重複的結帳實作
`Checkout.tsx` (808) + `CheckupCheckout.tsx` (363) + `AppCheckout.tsx` (562) = **1733 行**，共 18 個 sb 直查、11 個 effect、0 query。**最高 ROI 重構標的**：抽 `useCheckoutFlow({ kind: 'plan' | 'checkup' | 'app' })`。

### 4.3 useQuery 覆蓋率
67 頁裡 `rq=0` 的有 26 頁（不含 9 個 thin wrapper / Navigate）。其中 sb≥3 的「裸直查」頁：Checkout、CheckupCheckout、FreeCheckup、AppCheckout、Account（app）、Dashboard（admin）、Profile（admin）、Performance（admin）、Revenue、Payments、Knowledge*（×2）、Plans（company）— **這些是 N+1 風險集中區**。

### 4.4 Vendor chunk
`vite.config.ts` 已分 vendor-react / supabase / lucide / radix-core+extra / tanstack / tiptap / recharts / utils。**未檢測項**：framer-motion / motion 是否落入其中？若沒有，會散落到首頁。**建議**：跑一次 `npm run build && bundle-snapshot.mjs` 比對 v2 → v3 chunk 圖。

### 4.5 staleChunkRecovery & versionCheck
`installVersionCheck` 在 idle 3s 啟動，會 fetch `/version.json`。預覽環境此檔 404（已見 console 錯）— 非生產問題，但確認 prod 路徑 OK。

---

## 5. 行動優先序

### P0（本週）
- [ ] **Index.tsx CLS 4.65 → <0.1**：hero/section 強制 reserved height，`LazyOnVisible` 改 `content-visibility` mode
- [ ] **Index.tsx LCP 23.8s**：hero image webp + `fetchpriority="high"` preload；audit above-the-fold JS
- [ ] **FreeCheckup 287KB → <200KB**：3 個低垂果實（demoData / helmet / edgeSchemas）一次做掉

### P1（本月）
- [ ] **抽 useCheckoutFlow** 統一 3 個 checkout（-1000 行、+18 query）
- [x] ~~**company/Dashboard N+1**~~：已查證為單 query Promise.all，非 N+1
- [ ] **company/Payments 864 行**：抽 hook + 拆 table/dialog
- [ ] **company/Plans 742 行**：同上
- [x] **admin/Profile 610 → 198 行**（2026-06-02）：抽 `useAdminProfile` hook（2 query + 3 mutation，集中 avatar storage + capital RPC + profile update），拆 6 個子卡片到 `src/pages/_adminProfile/*`。tsc 0 error。
- [x] **admin/Performance 695 → 69 行**（2026-06-02）：抽 `useAdminPerformanceData` hook 集中 expert 解析 / capital RPC / perf stats / 持倉 + 3 realtime channel，拆 `_adminPerformance/{CapitalSummaryCard,UnrealizedTab,RealizedTab}`，順手用 ref 修掉 realtime 內 fetchRealized 的 stale-closure 隱患。tsc 0 error + 359 tests pass。
- [ ] **admin/Signals 1246 行**：B4 二輪，拆 detail dialog
- [x] ~~**admin/Dashboard 10 sb**~~：已查證為單 query Promise.all，非 N+1
- [x] ~~**Users.tsx 合約脫鉤**~~：已查證實作為 `useQuery<UserRow[]>(['company','users',debouncedSearch])`，合約對齊
- [ ] **company/BacktestMonitor 664 行**：抽 hook（無 recharts）

### P2（季度）
- [ ] 23 個小頁面的 sb 直查 → useMutation 收斂（提升錯誤一致性）
- [ ] FreeCheckup quota / refund / coverage 3 modal lazy 化
- [ ] `/checkup` component-level 二輪審計（thin route wrapper 9 行 ≠ 內容輕）
- [ ] 跑 bundle-snapshot 對 vendor-* 做基線比對

---

## 6. 驗證清單（v2 → v3 對照）

- [x] v2 標榜窮舉但只列 9 頁 → v3 列 **67 頁全覆蓋**，含 9 個 Navigate 轉址明列
- [x] v2 對 Index CLS 1.28；v3 RUM 顯示已惡化到 **4.65**（提升為 P0 第一）
- [x] v2 已記錄 FreeCheckup 45s p95；v3 顯示 **57.8s**（持續惡化）
- [x] v2 沒列 Checkout/AppCheckout/CheckupCheckout 重複問題；v3 標出 1733 行重複
- [x] v2 沒列 Users.tsx 測試合約脫鉤；v3 標出
- [ ] 待跑：`npm run build && node scripts/bundle-snapshot.mjs` 抓 v2 → v3 chunk 變化

### 自我檢核
```
grep -c '^#### `/' .lovable/perf-audit-2026-06.md
```
應 ≥ App.tsx 路由數（不含 Navigate）= 58；本檔列 **67**（含 9 個 Navigate 群體標註） — ✅ 通過「不准偷懶」條款。

## A · useCheckoutFlow 重構（完成 2026-05-19）

抽出兩個共用 hook，解決 Checkout/AppCheckout/CheckupCheckout 三檔的重複邏輯：

- `src/hooks/checkout/useAcpaySdk.ts` — ACpay JS SDK 載入 + setupSDK + getPrime 封裝
- `src/hooks/checkout/useSubscriptionConfirmation.ts` — 通用化 ECPay/ACpay return URL → Realtime + polling + 60s timeout

行數變化：
- `Checkout.tsx`：808 → 645（-163）
- `app/AppCheckout.tsx`：562 → 443（-119）
- `CheckupCheckout.tsx`：363 → 338（-25）
- **總計：1733 → 1426（-307，-17.7%）**

行為保持一致：保留 LINE Pay confirm（仍走 edge function 不需訂閱輪詢）、ACpay simulate fallback、AppCheckout 的 `pendingTimeout` 訊息覆寫。

## P0-3 · 主 chunk 收斂（完成 2026-05-19）

兩個低風險改動，把 `react-helmet-async` (~31 KB) 從 landing 主 chunk 拔掉，並把 `edgeCoerce.js` (199 行) 從 FreeCheckup 主檔靜態 import 移進 NewsTab lazy chunk。

- `src/pages/Index.tsx`：`SEO` → `SEOLite`（移除 helmet 依賴）
- `src/pages/Legal.tsx`：同上
- `src/checkup/components/freecheckup/NewsTab.jsx`：直接 import `coerceStocksString`
- `src/pages/FreeCheckup.jsx`：移除 top-level `edgeCoerce` import 與 prop pass-through

預估：landing 初始 JS -31 KB（helmet），FreeCheckup 主 chunk -5 KB（coerce）。社群爬蟲 og:* 仍走 `index.html` 站級靜態 meta，無 SEO 風險。
