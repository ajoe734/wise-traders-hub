# 統一 Expert Holdings/Performance 讀取來源

## 目標
消除目前 4 個 hook 各自讀 `trade_records / user_performances / current_prices / RPC` 的分歧，改為單一 source-of-truth hook，所有頁面共用同一份資料 + 同一條 realtime channel。

## 新增

**`src/hooks/useExpertHoldingsBundle.ts`**
- 輸入：`expertId`
- 內部：用 React Query 同時呼叫
  - `get_expert_capital_status(_expert_id)` → capital + open_positions
  - `calculate_expert_performance(_expert_id)` → total_return_pct / avg_pnl_pct / win_rate …
- 輸出：`{ capital, openPositions: PerfRow[], performance, totalPnlPercent, avgPnlPercent, loading, refetch }`
- `open_positions` 直接 map 成現有 `PerfRow` 形狀（沿用 useAdminPerformanceData 內既有 mapper，抽成 `mapOpenPositionToRow`）
- queryKey: `['expert-holdings-bundle', expertId]`，staleTime 30s
- 內建單一 realtime channel `expert-bundle-${expertId}`：
  - `trade_records (expert_id=eq.X) *` → invalidate bundle + `['period-performance-v3', expertId]` + `['admin-signals-bundle', slug]`（後者用 predicate match）
  - `user_performances (user_id=eq.ownerUserId) *` → invalidate bundle（cover 5 分鐘 cron 推現價）
- 需要 `expertOwnerUserId`，由 hook 內部 fetch experts 一次（或接受 optional 參數避免重抓）

## 改造（消費者改用 bundle）

1. **`src/hooks/admin/useAdminPerformanceData.ts`**
   - 移除自身的 capital RPC / perf RPC / open positions RPC / 兩條 trade_records channel / user_performances channel
   - 改用 `useExpertHoldingsBundle(expertId)`，把 `capital / totalPnlPercent / avgPnlPercent / rows` 全部 derive 自 bundle
   - 保留：expert 基本資料 fetch、realizedRows + realizedPeriod（realized 仍直讀 `trade_records status=closed`），realized 的刷新改成監聽同一 bundle invalidation（用 queryClient.subscribe 或多加一條 invalidation key）
   - public API（return shape）完全不變

2. **`src/hooks/admin/useSignalEditorData.ts`**
   - 把現有 `reloadCapital` + trade_records realtime 改為 `useExpertHoldingsBundle`
   - `capital` 由 bundle 提供，移除自己的 channel

3. **`src/hooks/useAdminSignals.ts`**
   - 刪除 L52-56 直讀 `trade_records` 取 `openInstruments`
   - 改從 bundle `openPositions` derive `openInstruments = new Set(openPositions.map(p => p.instrument))`
   - 移除上一輪加的 trade_records channel（bundle 已處理）

4. **`src/hooks/usePerformance.ts`**
   - `useExpertPerformance` 內部改為「若 bundle 已 cache 則回傳 bundle.performance，否則 fallback 呼叫 RPC」——或更簡單：標記為 deprecated，新增 `useExpertPerformanceFromBundle` 讓 ExpertProfile / ExpertDetail / AppHome 改用
   - `useExpertPerformanceRealtime` 整個刪除（bundle 已涵蓋）；改在 ExpertProfile / ExpertDetail / AppHome mount `useExpertHoldingsBundle(expertId)` 取代

   **保守做法（採用）**：保留 `useExpertPerformance` 的 API 不動，內部改成 thin wrapper 讀 bundle queryKey；`useExpertPerformanceRealtime` 改為 no-op 並標 deprecated，原呼叫端在後續 PR 移除。本次計畫先把資料源統一，呼叫端不動。

## Memory

新增 `mem://architecture/expert-holdings-single-source`（core rule）：
> 任何頁面需要 expert capital / open positions / total_return / avg_pnl，**只准**呼叫 `useExpertHoldingsBundle(expertId)`。禁止新檔案直接 `from('trade_records')` / `from('user_performances')` / `rpc('get_expert_capital_status')` / `rpc('calculate_expert_performance')`。新增 realized 類查詢請走 bundle 的衍生 hook。

並在 index.md Core 加一行引用。

## 不在範圍
- `usePeriodPerformance` 維持自己讀 trade_records 畫圖；由 bundle realtime 順手 invalidate
- Checkup / demo 系列不動
- realized rows 仍各自 fetch（period 條件不同，不適合塞 bundle）

## 驗證
- 改完後 build pass
- 手動：發布新週記頁出場一檔 → admin/Performance、admin/Signals、ExpertProfile 三處數字同步刷新（不必等 30 秒）
- 既有測試 `expert-cache-continuity.test.tsx` / `1.21-expert-performance-rpc.test.ts` 應仍綠

## 風險
- `useAdminPerformanceData` 的 user_performances patch（單列現價更新避免閃爍）會被 bundle 的整體 invalidate 取代，可能有短暫 re-render；可接受（資料量小）。若實測閃爍明顯，再回補 patch 邏輯到 bundle 內。
