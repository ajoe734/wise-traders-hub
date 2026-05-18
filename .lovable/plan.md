# 全站效能 / 維護性審計計畫

## 目標
產出**純審計報告**（不改 code），列出全站每一頁的效能瓶頸、維護性問題、優先級與預估收益，供你逐條核可後再分批執行。

## 範圍（窮舉，不抽樣）
依 `src/App.tsx` 路由表，全部納入：

**公開頁（5）**
`/`, `/experts`, `/expert/:slug`, `/pricing`, `/free-checkup`, `/legal`

**會員 App（10+）**
`/app`, `/app/explore`, `/app/holdings`, `/app/journals`, `/app/journal/:id`, `/app/signals`, `/app/signals-dashboard`, `/app/signal/:id`, `/app/system/:id`, `/app/learning`, `/app/expert/:slug`, `/app/checkout`, `/app/account`, `/app/notifications`, `/app/remittance-orders`

**結帳 / 付款（3）**
`/checkout`, `/checkup-checkout`, `/plan/:id`

**Admin 後台（10）**
`/admin/:slug` Dashboard, Signals, SignalEditor, SignalTemplates, ReasonTemplates, Plans, Subscribers, Performance, Announcements, Profile

**Company 後台（20）**
Dashboard, Analysts, Users, Plans, Subscribers, Revenue, Payments, PaymentSettings, Remittance, Announcements, AuditLogs, BacktestMonitor, CheckupUsage, FunctionLogs, KnowledgeBase, MetaOverrides, MissingPrices, PerfMetrics, ReferralChannels, SystemJobs

**Auth（5）** Login, Register, ForgotPassword, ResetPassword, LineCallback

## 審計維度（每頁逐項打勾）

1. **資料載入**
   - `useEffect` + `supabase.from(...)` 直查（未走 react-query）→ 無快取、重複請求
   - `enabled: !isAuthLoading` 阻塞公開資料
   - N+1（先撈父再 map 撈子）
   - `select *` vs 指定欄位
   - 缺 RPC bundle 機會（多次查詢可合併）
2. **DB 端**
   - 對應 query 是否有 index（join FK、order/filter 欄位）
   - RLS policy 是否觸發 sequential scan
3. **Bundle / 載入**
   - 是否 `lazy()`、route-level code split
   - 第三方大套件（recharts、tiptap、framer-motion…）是否只在需要時載入
   - 圖片 `loading="lazy"` / `decoding="async"` / 尺寸宣告
4. **Realtime**
   - 訂閱是否必要、是否清理、是否範圍過大
5. **維護性**
   - 重複 fetch 邏輯（同一張表多處直查）
   - QueryKey 命名一致性
   - 錯誤處理重複、缺 `errorMessage` util
   - 元件過長（>500 行）需要拆分
6. **真實 RUM 數據**
   - 用 `supabase--analytics_query` 拉最近 7 天 `function_edge_logs` 每個 edge function 的 p50/p95/error rate
   - 從 `perf_metrics_rum` 表抓前台路徑 p95 FCP/LCP
   - 從 `postgres_logs` 抓 slow query

## 交付物（單一 Markdown 報告）

存到 `.lovable/perf-audit-2026-05.md`，結構：

```text
# 全站效能審計 2026-05

## 1. 真實數據摘要
- 最慢前台路由（RUM p95 LCP top 10）
- 最慢 edge function（p95 top 10 + error rate）
- 最慢 SQL（postgres_logs top 10）

## 2. 各頁問題清單
### /app/holdings
- [P0] N+1：先撈 holdings 再逐筆撈 quote  → 預估省 1.2s
- [P1] 未走 react-query，切 tab 重撈
- [P2] 元件 820 行，建議拆 3 個
...（每頁同格式）

## 3. 跨頁共通問題
- 14 處 `useEffect` 直查 → 統一遷 react-query
- 8 處 `enabled: !isAuthLoading` 對公開資料 → 移除
- 缺 index 清單（5 個）

## 4. 建議執行批次
- Batch 1（最高 ROI，~3 PR）：…
- Batch 2（中 ROI，~5 PR）：…
- Batch 3（低 ROI / Admin 內部）：…
```

## 流程

1. 拉 RUM + edge logs + postgres logs（3 個並行 analytics query）
2. 對每頁掃描 source（grep `useEffect.*supabase`、`enabled: !isAuthLoading`、`select(`、`lazy(`）
3. 對應 DB schema 檢查 index
4. 整理成上述報告，**不動任何 source code**

## 不做（明確排除）
- 任何 code 修改、migration、edge function deploy
- 設計改動
- Admin/Company 頁的功能改動

報告交付後你逐條核可，我再分批實作（每批一個獨立 PR）。
