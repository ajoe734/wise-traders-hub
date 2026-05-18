## 目標

產出新版 `.lovable/perf-audit-2026-06.md`，**窮舉 src/App.tsx 全部 60+ 路由**每一頁的效能檢討，取代 v2（v2 標榜窮舉但實際只列了 9 個頁面標題即斷尾）。

## 不在範圍

- 任何 code change、migration、deploy
- 重複呈現 RUM/edge 真實數據以外的推測
- 改動既有檔案（v2 留作歷史對照）

## 蒐集步驟（read-only）

1. **真實數據**
   - `perf_metrics` 30 天每路由 p50/p75/p95 LCP / FCP / CLS / INP + samples
   - `function_logs` / edge logs 7 天 calls/avg/max/error
   - `postgres_logs` 24h 慢 query / ERROR
   - 執行 `supabase--cloud_status` 確認後端體質

2. **靜態指標逐頁掃描**（針對 App.tsx 每一個 `<Route>`）
   - 行數 (`wc -l`)
   - `useEffect` 數量
   - `supabase.from|rpc|functions.invoke` 直查次數
   - `useQuery` / `useMutation` 數量
   - 是否使用 React.lazy / Suspense 邊界
   - 是否有 inline `<style>` 巨石或 ≥1KB inline data
   - 重型相依（tiptap / recharts / framer-motion / d3）

3. **路由分群** 對照 App.tsx：
   - 公開 Portal (Index / Experts / ExpertProfile / PlanDetail / Pricing / Legal / Checkout / CheckupCheckout / FreeCheckup / NotFound)
   - Auth (Login / Register / LineCallback / ForgotPassword / ResetPassword)
   - Portfolio /portfolio/:id (8 子頁：Holdings / Events / Daily / Research / Trade / Log / News / Overview)
   - Account (Profile / MyRemittanceOrders / Notifications)
   - App /app (Home / Signals / Journals / SignalDetail / JournalDetail / Account / Explore / ExpertDetail / Checkout + Holdings / LearningDashboard / SignalsDashboard / SystemDetail)
   - Admin (Dashboard / Signals / SignalEditor / Subscribers / Profile / Performance / ReasonTemplates / SignalTemplates / Announcements / Plans)
   - Company (Dashboard / Analysts / Subscribers / Revenue / Payments / Announcements / AuditLogs / SystemJobs / FunctionLogs / KnowledgeBase / KnowledgeAudit / KnowledgeScheduler / BacktestMonitor / Plans / Remittance / PaymentSettings / ReferralChannels / CheckupUsage / MissingPrices / MetaOverrides / Users / PerfMetrics)

## 輸出檔案

`.lovable/perf-audit-2026-06.md`，章節：

1. **真實數據摘要**（RUM 表 + edge + SQL + cloud_status）
2. **方法論**（指令、判讀規則、警示等級定義 P0/P1/P2）
3. **窮舉頁面清單**（依分群，**每一個路由一條**，固定欄位）
   ```
   #### `/route` File.tsx — N 行 / ue X / sb Y / rq Z / lazy ✓
   - [等級] 觀察 → 行動
   ```
   缺一頁即視為未完成（依 Core「不准偷懶」條款）
4. **全站交叉議題**（vendor chunk、persister、CLS pattern、N+1）
5. **行動優先序**（P0/P1/P2 整理成可勾選 backlog）
6. **驗證清單**（如何回頭比對 v2 → v3 修了什麼）

## 交付確認

寫完後執行 `grep -c '^#### \`/' .lovable/perf-audit-2026-06.md`，數字需 ≥ App.tsx 路由總數，否則補完再交。
