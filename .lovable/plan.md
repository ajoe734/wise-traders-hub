## 根因
`public.trade_records` 的 anon RLS 只開放 `status IN ('closed','stopped')` 的紀錄。未登入造訪 `/expert/sharkgu` 時，**所有 open 部位被擋**，導致 `usePeriodPerformance` 拿到的資料缺現有持倉，圖表與最佳/最差全錯。登入版（admin policy）正常，所以 preview 看起來對。

## 修復（一個 migration）

新增 anon SELECT policy：對 `experts.status='active'` 的 `open` 紀錄也放行。

```sql
CREATE POLICY "Anyone can view open trades for active experts"
ON public.trade_records
FOR SELECT
TO public
USING (
  status = 'open'::trade_status
  AND expert_id IN (
    SELECT id FROM public.experts WHERE status = 'active'
  )
);
```

不刪除既有 closed policy，兩者並存涵蓋全部狀態。

## 驗證
1. 用 anon key 直接查 `trade_records WHERE expert_id=sharkgu` 應回傳所有紀錄（含 open）。
2. 無痕視窗開 `https://legendflow.tw/expert/sharkgu`，圖表、KPI、最佳/最差應與登入版一致。

## 安全考量
公開頁本來就要展示「目前資產／持倉貢獻最佳/最差」，open 部位的 instrument/qty/entry_price/current_price 已經是公開頁的設計需求。`trade_records` 不含使用者個資（只有 `expert_id`、合約、價格、數量），對應 active expert 公開展示策略一致，無新增資料外洩。
