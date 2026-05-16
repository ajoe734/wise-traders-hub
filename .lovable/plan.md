# 全頁面效能稽核計畫

排除：`src/pages/app/Holdings.tsx`、`src/checkup/pages/HoldingsPage.jsx` 及其底下 `holdings/` 元件。

## 範圍（共 56 個頁面 + 5 個 layout + shared components）

**Public**: Index, Experts, ExpertProfile, PlanDetail, Pricing, Checkout, CheckupCheckout, FreeCheckup, Legal, NotFound
**Auth**: Login, Register, ForgotPassword, ResetPassword, LineCallback
**Account**: Profile, Notifications, MyRemittanceOrders
**App**: AppHome, Signals, SignalsDashboard, SignalDetail, Journals, JournalDetail, SystemDetail, Account, Explore, ExpertDetail, AppCheckout, LearningDashboard
**Admin**: Dashboard, Signals, SignalEditor, Subscribers, Profile, Performance, ReasonTemplates, SignalTemplates, Announcements, Plans
**Company**: Dashboard, Analysts, Subscribers, Revenue, Payments, Announcements, AuditLogs, SystemJobs, FunctionLogs, KnowledgeBase + 2 子頁, BacktestMonitor, Plans, Remittance, PaymentSettings, ReferralChannels, CheckupUsage, MissingPrices, MetaOverrides, Users
**Checkup**: Daily, Events, Log, News, Overview, Research, Trade（含 PortfolioLayout）
**Layouts**: PortalLayout, AppLayout, UnifiedAppLayout, AdminLayout, CompanyLayout, LearningLayout, SignalsLayout

## 每頁檢查清單（5 項，缺一不可）

1. **首屏 chunk 重量** — 是否直接 import recharts / tiptap / 大型第三方（應走 lazy + Suspense）
2. **資料抓取模式** — useEffect+supabase 是否該改 React Query / 是否序列瀑布（該 `Promise.all`）/ 是否在每次 render 重抓
3. **重複請求** — 同一份 profile/roles/subscriptions 是否在頁面 + layout 各抓一次
4. **記憶化** — 大表 `.map`/`.filter`/排序是否在每次 render 重算（缺 `useMemo`），事件 handler 是否每次 render 新建（缺 `useCallback`）導致子元件 re-render
5. **CLS / LCP** — 首屏圖片是否有 width/height、骨架是否撐住高度、字型 `font-display`

## 產出

一份分頁清單表格：
```
頁面 | 問題類型 | 嚴重度(高/中/低) | 修法 | 預估省 KB or ms
```

呈現後等你拍板修哪些（避免一次改 56 個頁面把 PR 變成地雷）。

## 不會做（避免 scope creep）

- 不會在這輪改 Holdings 相關檔案
- 不會修改業務邏輯，只動載入策略 / 記憶化 / 查詢合併
- 不會動 supabase schema / edge functions

## 預估時間

稽核本身約需 50–80 次檔案讀取（每頁 1–2 次 + layout）。會分批回報，不會一次塞 56 個頁面的結論給你。
