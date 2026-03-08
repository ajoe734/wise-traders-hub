

## 全站審計報告：路由總表 + Mock 殘留 + SSOT 設計 + 待辦事項

---

### A. 路由總表

| # | Route | File | 功能模組 | 資料來源 | 保留? |
|---|-------|------|----------|----------|-------|
| **Portal (公開)** |
| 1 | `/` | `pages/Index.tsx` | 官網首頁 | 靜態 | ✅ |
| 2 | `/experts` | `pages/Experts.tsx` | 專家列表 | **mockData** | ✅ 需改 DB |
| 3 | `/expert/:slug` | `pages/ExpertProfile.tsx` | 專家檔案 | DB + **mockData fallback** | ✅ 需移除 fallback |
| 4 | `/plan/:slug/:planId` | `pages/PlanDetail.tsx` | 方案詳情 | **mockData** | ✅ 需改 DB |
| 5 | `/checkout/:slug/:planId` | `pages/Checkout.tsx` | 結帳 | DB (real) | ✅ |
| 6 | `/pricing` | `pages/Pricing.tsx` | 定價頁 | 靜態/hardcoded | ✅ |
| 7 | `/legal` | `pages/Legal.tsx` | 法律條款 | 靜態 | ✅ |
| **Auth** |
| 8 | `/auth/login` | `pages/auth/Login.tsx` | 登入 | DB | ✅ |
| 9 | `/auth/register` | `pages/auth/Register.tsx` | 註冊 | DB | ✅ |
| **Account** |
| 10 | `/account/profile` | `pages/account/Profile.tsx` | 個人檔案 | DB | ✅ |
| 11 | `/account/subscriptions` | → redirect `/app/account` | — | — | ✅ |
| **App (訂閱者前台)** |
| 12 | `/app` | `pages/app/AppHome.tsx` | 首頁 | DB (real) | ✅ |
| 13 | `/app/signals` | `pages/app/Signals.tsx` | 訊號牆 | DB (real) | ✅ |
| 14 | `/app/journals` | `pages/app/Journals.tsx` | 週記列表 | DB (real) | ✅ |
| 15 | `/app/signal/:id` | `pages/app/SignalDetail.tsx` | 訊號詳情 | DB (real) | ✅ |
| 16 | `/app/journal/:id` | `pages/app/JournalDetail.tsx` | 週記詳情 | DB (real) | ✅ |
| 17 | `/app/system/:id` | `pages/app/SystemDetail.tsx` | 策略系統 | **mockData** | ✅ 需改 DB |
| 18 | `/app/account` | `pages/app/Account.tsx` | 帳號管理 | DB (real) | ✅ |
| 19 | `/app/holdings` | → redirect `/app` | — | — | ✅ |
| 20 | `/app/performance` | `pages/app/Performance.tsx` | 績效 | **hardcoded mock** | ✅ 需改 DB |
| 21 | `/app/courses` | `pages/app/Courses.tsx` | 課程 | **hardcoded mock** | ✅ 需改 DB |
| 22 | `/app/library` | `pages/app/Library.tsx` | 資料庫 | **hardcoded mock** | ✅ 需改 DB |
| 23 | `/app/explore` | `pages/app/Explore.tsx` | 探索專家 | **mockData** + DB | ✅ 需改 DB |
| 24 | `/app/expert/:slug` | `pages/app/ExpertDetail.tsx` | 專家詳情 | **mockData** + DB | ✅ 需改 DB |
| 25 | `/app/checkout/:slug/:planId` | `pages/app/AppCheckout.tsx` | App結帳 | **mockData** + DB | ✅ 需移除 mock |
| **Admin (分析師/導師後台)** |
| 26 | `/admin/:slug` | `pages/admin/Dashboard.tsx` | 儀表板 | DB | ✅ |
| 27 | `/admin/:slug/signals` | `pages/admin/Signals.tsx` | 訊號管理 | DB | ✅ |
| 28 | `/admin/:slug/subscribers` | `pages/admin/Subscribers.tsx` | 訂閱者 | DB | ✅ |
| 29 | `/admin/:slug/profile` | `pages/admin/Profile.tsx` | 個人設定 | DB | ✅ |
| 30 | `/admin/:slug/performance` | `pages/admin/Performance.tsx` | 績效 | DB | ✅ |
| 31 | `/admin/:slug/reason-templates` | `pages/admin/ReasonTemplates.tsx` | 理由模板 | DB | ✅ (legacy, nav 已移除) |
| 32 | `/admin/:slug/signal-templates` | `pages/admin/SignalTemplates.tsx` | 訊號模板 | DB | ✅ |
| **Company (公司後台)** |
| 33 | `/company` | `pages/company/Dashboard.tsx` | 儀表板 | DB | ✅ |
| 34 | `/company/analysts` | `pages/company/Analysts.tsx` | 分析師管理 | DB | ✅ |
| 35 | `/company/subscribers` | `pages/company/Subscribers.tsx` | 訂閱者管理 | DB | ✅ |
| 36 | `/company/revenue` | `pages/company/Revenue.tsx` | 營收 | DB | ✅ |
| 37 | `/company/review` | `pages/company/Review.tsx` | 審核 | DB | ✅ |
| 38 | `/company/payments` | `pages/company/Payments.tsx` | 交易 | DB | ✅ |
| 39 | `/company/audit-logs` | `pages/company/AuditLogs.tsx` | 操作紀錄 | DB | ✅ |
| 40 | `/company/announcements` | `pages/company/Announcements.tsx` | 公告 | DB | ✅ |
| **LINE Mini-App (10 pages)** |
| 41 | `/line/:slug/home` | `pages/line/Home.tsx` | LINE 首頁 | **mockData** | ❌ 建議移除 |
| 42 | `/line/:slug/signals` | `pages/line/Signals.tsx` | LINE 訊號 | **mockData** | ❌ |
| 43 | `/line/:slug/signal/:id` | `pages/line/SignalDetail.tsx` | LINE 訊號詳情 | **mockData** | ❌ |
| 44 | `/line/:slug/teaching` | `pages/line/Teaching.tsx` | LINE 教學 | **mockData** | ❌ |
| 45 | `/line/:slug/trades` | `pages/line/Trades.tsx` | LINE 交易 | **mockData** | ❌ |
| 46 | `/line/:slug/performance` | `pages/line/Performance.tsx` | LINE 績效 | **mockData** | ❌ |
| 47 | `/line/:slug/xai` | `pages/line/Xai.tsx` | LINE XAI | **mockData** | ❌ |
| 48 | `/line/:slug/diagnosis` | `pages/line/Diagnosis.tsx` | LINE 診斷 | **mockData** | ❌ |
| 49 | `/line/:slug/history` | `pages/line/History.tsx` | LINE 歷史 | **mockData** | ❌ |
| 50 | `/line/:slug/account` | `pages/line/Account.tsx` | LINE 帳號 | **mockData** | ❌ |
| **Legacy Redirects** |
| 51 | `/explore` | → `/experts` | — | — | ✅ |
| 52 | `/people/:slug` | → `/experts` | — | — | ✅ |
| 53 | `/me`, `/me/*` | → `/account/subscriptions` | — | — | ✅ |

---

### B. Mock/Hardcoded 殘留清單

**22 files** importing from `@/data/mockData` or `@/data/strategyMockData`:

| # | File | Imported Functions | 嚴重度 |
|---|------|--------------------|--------|
| **LINE pages (全部 mock，建議整體刪除)** |
| 1 | `pages/line/Home.tsx` | getPersonBySlug, getUserSubscriptions, getSignalsForUser, getJournalsForUser + strategyMock | 高 |
| 2 | `pages/line/Signals.tsx` | getPersonBySlug, getSignalsForUser, getJournalsForUser | 高 |
| 3 | `pages/line/SignalDetail.tsx` | getSignalById, getPersonBySlug | 高 |
| 4 | `pages/line/Teaching.tsx` | getPersonBySlug + strategyMock | 高 |
| 5 | `pages/line/Performance.tsx` | getPersonBySlug + strategyMock | 高 |
| 6 | `pages/line/Trades.tsx` | getPersonBySlug, getSignalsForUser | 高 |
| 7 | `pages/line/Account.tsx` | getPersonBySlug, getUserSubscriptions | 高 |
| 8 | `pages/line/Xai.tsx` | getPersonBySlug, getSignalById | 高 |
| 9 | `pages/line/Diagnosis.tsx` | getPersonBySlug, getUserSubscriptions | 高 |
| 10 | `pages/line/History.tsx` | getPersonBySlug | 高 |
| **Layouts (被 LINE pages 使用)** |
| 11 | `components/layouts/LineLayout.tsx` | getPersonBySlug, getSignalsForUser, getJournalsForUser | 高 |
| 12 | `components/layouts/AdminLayout.tsx` | getPersonBySlug | 中 |
| 13 | `components/layouts/SignalsLayout.tsx` | getSignalsForUser | 中 |
| 14 | `components/layouts/LearningLayout.tsx` | getJournalsForUser | 中 |
| **Portal pages** |
| 15 | `pages/Experts.tsx` | getAllPeopleWithPlans | 高 |
| 16 | `pages/ExpertProfile.tsx` | getPersonBySlug (fallback) | 中 |
| 17 | `pages/PlanDetail.tsx` | getPersonBySlug, getPlanById | 高 |
| **App pages** |
| 18 | `pages/app/Explore.tsx` | getAllPeopleWithPlans | 高 |
| 19 | `pages/app/ExpertDetail.tsx` | getPersonBySlug | 高 |
| 20 | `pages/app/AppCheckout.tsx` | getPersonBySlug, plans | 高 |
| 21 | `pages/app/SystemDetail.tsx` | getSystemWithPerson | 高 |
| 22 | `pages/app/SignalsDashboard.tsx` | getUserSubscriptions, getSignalsForUser + mockHoldings | 高 |
| 23 | `pages/app/LearningDashboard.tsx` | getJournalsForUser | 高 |
| **Inline hardcoded mock (no import but embedded data)** |
| 24 | `pages/app/Performance.tsx` | Inline mock stats, monthly returns, trades | 高 |
| 25 | `pages/app/Courses.tsx` | Inline hardcoded course list | 中 |
| 26 | `pages/app/Library.tsx` | Inline hardcoded article list | 中 |

**Mock data files to delete:**
- `src/data/mockData.ts` (1308 lines)
- `src/data/strategyMockData.ts` (1137 lines)

---

### C. SSOT 設計建議

統一資料存取層，所有頁面透過 shared query hooks 取得資料，不再直接 import mock。

| 資料 | 來源 | 建議 Hook | 使用頁面 |
|------|------|-----------|----------|
| **Experts** (by slug / list) | `experts` table | `useExpert(slug)`, `useExperts()` | Experts, ExpertProfile, ExpertDetail, Explore, AdminLayout, PlanDetail, AppCheckout |
| **Plans** (by expert / by id) | `expert_plans` table | `useExpertPlans(expertId)`, `usePlan(planId)` | PlanDetail, Checkout, AppCheckout, ExpertDetail |
| **Subscriptions** (active only) | `member_subscriptions` WHERE status='active' | `useMySubscriptions()` | AppHome, Account, Explore (已訂閱標記) |
| **Signals** (advisor published) | `expert_signals` WHERE status='published' | `useMySignals()` (已在 Signals.tsx 實作) | Signals, SignalDetail |
| **Journals** (mentor, T+7 可見) | 目前無 journals table | 需建 table 或確認是否存在 | Journals, JournalDetail, LearningDashboard |
| **Holdings** (open trades) | `trade_records` WHERE status='open' | `useMyHoldings()` | AppHome, SignalsDashboard |
| **Performance** (RPC) | `calculate_expert_performance` RPC | `useExpertPerformance(expertId)` | Performance pages |
| **Trading Systems** | 目前只在 mockData | 需建 `trading_systems` table 或 inline in experts | SystemDetail |

**建議架構：**

```
src/hooks/
  useExpert.ts        — useExpert(slug), useExperts()
  useExpertPlans.ts   — useExpertPlans(expertId), usePlan(planId)  
  useSubscriptions.ts — useMySubscriptions()
  useHoldings.ts      — useMyHoldings()
  usePerformance.ts   — useExpertPerformance(expertId)
```

每個 hook 使用 `useQuery` + `supabase` client，staleTime 30s，所有頁面共用同一 queryKey。

---

### D. 未完成事項 Checklist

#### D1. LINE 整體移除（10 pages + 1 layout + routes）

- [ ] **刪除 `src/pages/line/` 整個目錄** (10 files)
  - 涉及：Home, Signals, SignalDetail, Teaching, Trades, Performance, Xai, Diagnosis, History, Account
  - 驗收：`/line/zhao-pengbo/home` 返回 404
- [ ] **刪除 `src/components/layouts/LineLayout.tsx`**
  - 驗收：build 無 import 錯誤
- [ ] **移除 App.tsx 中所有 `/line/*` 路由與 imports**（lines 66-76, 151-162）
  - 驗收：App.tsx 不再 import 任何 Line* 頁面

#### D2. Mock 資料清除（需先建 SSOT hooks）

- [ ] **建立 shared query hooks**：`useExpert`, `useExperts`, `useExpertPlans`, `useMySubscriptions`, `useMyHoldings`
  - 驗收：hooks 目錄有 5 個新檔案，均從 supabase client 取資料
- [ ] **Portal: Experts.tsx** — 改用 `useExperts()` 取代 `getAllPeopleWithPlans()`
  - 驗收：頁面顯示 DB 中的真實專家
- [ ] **Portal: ExpertProfile.tsx** — 移除 `getPersonBySlug` fallback，純用 DB
  - 驗收：刪除 mockData import
- [ ] **Portal: PlanDetail.tsx** — 改用 `useExpert` + `usePlan` 取代 mock
  - 驗收：顯示真實方案資料
- [ ] **App: Explore.tsx** — 改用 `useExperts()`
  - 驗收：探索頁顯示真實專家
- [ ] **App: ExpertDetail.tsx** — 改用 `useExpert(slug)` + DB plans
  - 驗收：專家詳情全部來自 DB
- [ ] **App: AppCheckout.tsx** — 改用 `useExpert` + `usePlan` 取代 mock
  - 驗收：結帳頁顯示真實方案名稱與價格
- [ ] **App: SystemDetail.tsx** — 改用 DB 或移除（trading_systems 無 table）
  - 驗收：決定是否建 table 或改路由
- [ ] **App: Performance.tsx** — 改用 `useExpertPerformance` RPC
  - 驗收：績效數據來自 DB
- [ ] **App: SignalsDashboard.tsx** — 移除 mockHoldings，改用 `useMyHoldings()`
  - 驗收：持倉來自 trade_records
- [ ] **App: LearningDashboard.tsx** — 改用 DB journals query
  - 驗收：週記來自 DB
- [ ] **Layout: AdminLayout.tsx** — 改用 DB expert query 取代 `getPersonBySlug`
  - 驗收：sidebar 專家名稱來自 DB
- [ ] **Layout: SignalsLayout.tsx** — 移除 `getSignalsForUser` mock
  - 驗收：unread badge 來自 DB
- [ ] **Layout: LearningLayout.tsx** — 移除 `getJournalsForUser` mock
  - 驗收：unread badge 來自 DB
- [ ] **App: Courses.tsx / Library.tsx** — 內嵌 hardcoded 資料需決定：建 table 或保留靜態
  - 驗收：確認方向

#### D3. 刪除 Mock 資料檔

- [ ] **刪除 `src/data/mockData.ts`**
- [ ] **刪除 `src/data/strategyMockData.ts`**
- [ ] **刪除 `src/types/index.ts` 中僅被 mock 使用的 types**（如 PersonRole enum 若已被 DB enum 取代）
  - 驗收：`npm run build` 成功，無任何 `@/data/` import

#### D4. 資料一致性待修

- [ ] **Canceled 訂閱排除**：確認所有 subscription query 都 filter `status = 'active'`，不計入 canceled
  - 涉及：AppHome, Dashboard, Subscribers 等
  - 驗收：canceled 訂閱不出現在統計數字中
- [ ] **Role 篩選**：確認 advisor signals vs mentor journals 在所有頁面正確分流
  - 涉及：Signals.tsx (已做), Journals.tsx
  - 驗收：訊號牆只顯示 advisor，週記只顯示 mentor
- [ ] **T+7 可見性**：mentor 週記需 `published_at <= now() - 7 days` 才對訂閱者可見
  - 涉及：Journals query
  - 驗收：7天內的週記不會出現在前台

---

### 建議實作順序

1. **Phase 1：刪除 LINE**（最大量 dead code，立即清除）
2. **Phase 2：建立 SSOT hooks**（5-6 個 hooks）
3. **Phase 3：逐頁替換 mock → hooks**（約 15 個檔案）
4. **Phase 4：刪除 mock 資料檔 + 驗證 build**
5. **Phase 5：資料一致性修正**（canceled/role/T+7）

請確認方向後我再開始執行。特別需要你決定：
1. LINE pages 是否全數刪除？
2. Courses / Library 的 hardcoded 資料要建 table 還是先保留靜態？
3. SystemDetail（策略系統詳情）要建 `trading_systems` table 還是暫時移除此路由？

