## 全面盤點：與「績效總覽 vs 發布新週記」同類的問題

我搜尋了所有讀 `trade_records / trade_signals / user_performances / get_expert_capital_status / calculate_expert_performance` 的檔案，分三類盤點。

### A. 已修（上一輪）
| 檔案 | 狀態 |
|---|---|
| `src/hooks/admin/useAdminPerformanceData.ts` | ✅ 改用 `get_expert_capital_status`，trade_records realtime 全量 re-fetch |
| `src/hooks/admin/useSignalEditorData.ts` | ✅ 加上 trade_records realtime → reloadCapital |
| `src/pages/admin/Dashboard.tsx` | ✅ 自己原本就有 trade_records realtime |

### B. 仍有問題（要修）

**B1. `src/hooks/useAdminSignals.ts` L52-56**
```ts
supabase.from('trade_records').select('instrument').eq('expert_id', exp.id).eq('status','open')
```
- 結果 `openInstruments` 給 `admin/Signals.tsx` 顯示每筆訊號的「持倉中／已平倉／減碼」標記（`_adminSignals/derive.ts`、`SignalRow.tsx` L95）
- `staleTime: 30_000`，**完全沒有 realtime invalidation**
- 後果：在 SignalEditor 出場一檔後，回到 Signals 列表頁，原本「持倉中」標籤要等 30 秒才更新；和績效總覽顯示狀態不一致

**B2. `src/hooks/usePerformance.ts` L62-72 `useExpertPerformanceRealtime`**
```ts
.on('postgres_changes', { event:'UPDATE', schema:'public', table:'user_performances' }, …)
```
- 只訂閱 `user_performances UPDATE`（每 5 分鐘 cron 才動）
- **完全沒訂閱 `trade_records`** ⇒ expert 平倉/加碼後，`calculate_expert_performance` 的 total_return、累積報酬會變，但這個 hook 不會 invalidate
- 影響範圍：
  - `src/pages/ExpertProfile.tsx`（公開老師頁）
  - `src/pages/app/ExpertDetail.tsx`（訂閱者老師詳細頁）
  - `src/pages/app/AppHome.tsx`（訂閱者首頁的老師卡片）
  - 都透過 `PerformanceOverviewPanel` / `useExpertPerformance` 取績效
- 後果：訂閱者最在乎的「老師最新總報酬」可能延遲到下一次 cron 才反映

**B3. `src/hooks/usePeriodPerformance.ts` L297-**
- 直讀 `trade_records` 畫期間圖表，沒任何 realtime / invalidation
- 跟 B2 同一個 panel 一起使用，B2 invalidate 時順便把它也 invalidate 才會同步

### C. 確認沒問題（已驗證）
- `src/hooks/useMyTradeRecordHoldings.ts`：唯一呼叫者 `app/SignalsDashboard.tsx` 已停用（強制空陣列），無實際影響
- `src/lib/analystDataAccess.ts` `fetchAnalystTradeRecords`：被 `fetchAnalystSignals` 鏈使用，列表用途，已被 B1 fix 覆蓋
- `src/pages/_adminSignals/SignalCreateDialog.tsx`：純 insert/update 寫入端
- `src/hooks/admin/useAdminProfile.ts`：用 RPC，正確

---

## 實作計畫

### 1) `src/hooks/useAdminSignals.ts` — 加 trade_records realtime invalidation
- 新增 `useEffect`：當 `expert?.id` 出現時，訂閱 `trade_records (expert_id=eq.X)`，任何事件 → `queryClient.invalidateQueries({ queryKey: ['admin-signals-bundle', expertSlug] })`
- 用 ref 持有 expertSlug 以避免重新訂閱
- 卸載時 `removeChannel`

### 2) `src/hooks/usePerformance.ts` — `useExpertPerformanceRealtime` 補訂閱 `trade_records`
- 在現有 idle-start 的 channel 內，加第二個 `.on('postgres_changes', { event:'*', schema:'public', table:'trade_records', filter: `expert_id=eq.${expertId}` }, …)`
- callback 同樣 invalidate `['expert-performance', expertId]`，並順手 invalidate `['period-performance-v3', expertId]`（修掉 B3）
- 保留現有 user_performances UPDATE 訂閱（cover 5 分鐘 cron 推現價）

### 技術細節
- 兩處皆採「事件 → invalidate query」模式，跟前一輪 `useSignalRealtimeInvalidation` 一致
- 不改公開 API、不改任何 UI、不改業務邏輯
- 不動 `usePeriodPerformance` 本身（保持單純 React Query），改由 B2 hook 順手 invalidate

### 影響面
- admin Signals 列表頁：出場後標籤即時刷新
- ExpertProfile / app/ExpertDetail / AppHome：老師交易後總報酬即時刷新
- 不影響：Dashboard（已正確）、CapitalPanel（已正確）、績效總覽（已正確）

### 不在本次範圍
- `usePeriodPerformance` 自己加 realtime（會多開 channel；改由 B2 順手 invalidate 已足夠）
- Demo / checkup 系列（不用 trade_records）
