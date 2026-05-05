目前錯誤我已經定位出來了，不是你看錯，是系統現在真的把兩種不同口徑混在一起顯示。

問題在哪裡

1. 後端計算公式本身就錯口徑
- 檔案：`supabase/migrations/20260410062402_46a61b2e-c8c1-49a7-b28e-971f72960382.sql`
- 函式：`public.calculate_expert_performance(_expert_id uuid)`
- 現況：
  - `cumulative_return` = 所有 `closed/stopped` 交易的 `pnl_percent` 直接加總
  - `current_asset` = 所有 `open` 部位的市值總和
  - 完全沒有引用 `experts.starting_capital`
- 結果：
  - 「總報酬率」其實是“已平倉報酬率加總”
  - 「目前資產」卻是“未平倉市值”
  - 兩者不是同一個基準，所以一定會出現你看到的矛盾

2. 前端把錯口徑直接拿來當總報酬率顯示
- 檔案：`src/components/strategy/PerformanceOverviewPanel.tsx`
- 現況：
  - `sinceInceptionReturn = perfData?.cumulative_return ?? 0`
  - UI 標成「總報酬率」
  - 同時把 `current_asset` 顯示成「目前資產」
- 這會造成最明顯的錯誤：
  - 若還沒平倉，`cumulative_return` 可能是 `0.00%`
  - 但 `current_asset` 已經很大
  - 畫面就變成「資產暴增，但總報酬 0%」這種明顯錯誤

3. 管理後台也同樣吃錯資料
- 檔案：
  - `src/pages/admin/Dashboard.tsx`
  - `src/pages/admin/Performance.tsx`
  - `src/pages/admin/Profile.tsx`
- 現況：都直接把 `calculate_expert_performance().cumulative_return` 當成「累計報酬率 / 累積總報酬 / 總報酬率」
- 所以錯誤不是單一頁面，是整條績效顯示鏈都錯

4. 這個缺口其實連測試都已經寫出來了
- 檔案：`src/test/integration/1.21-expert-performance-rpc.test.ts`
- 內容直接註明：
  - `⚠️ [生產缺口 5.3-7] starting_capital 為基準計算報酬率目前未實作`
  - `calculate_expert_performance 不引用 experts 表`
- 也就是說，程式裡早就知道這是缺口，但還沒補

我會怎麼修

1. 先把績效口徑統一成真正的投組報酬
- 新公式改成同一基準：`starting_capital`
- 定義：
  - `realized_pnl_amount` = 已平倉交易損益金額合計
  - `unrealized_pnl_amount` = 未平倉部位依現價計算的浮動損益合計
  - `current_asset` = `starting_capital + realized_pnl_amount + unrealized_pnl_amount`
  - `total_return_pct` = `((current_asset - starting_capital) / starting_capital) * 100`
- 這樣「目前資產」和「總報酬率」才會互相對得上

2. 不再用 `pnl_percent` 直接加總當總報酬
- `pnl_percent` 可以保留做：
  - 勝率
  - 平均單筆報酬
  - 已平倉交易統計
- 但不能再拿來當整體資產報酬率

3. 後端 RPC 補齊欄位，前端改用正確欄位
- 更新 `calculate_expert_performance`
- 讓它至少回傳：
  - `starting_capital`
  - `realized_pnl_amount`
  - `unrealized_pnl_amount`
  - `current_asset`
  - `total_return_pct`
  - 既有 `win_rate / avg_pnl / max_drawdown / profit_factor / return_1y`
- 前端所有「總報酬率 / 累計報酬率」改讀 `total_return_pct`
- 若還要保留原本口徑，就另標成「已實現累積報酬」

4. 一次把所有顯示點改完，避免同類錯誤殘留
- 必改檔案：
  - `src/components/strategy/PerformanceOverviewPanel.tsx`
  - `src/pages/admin/Dashboard.tsx`
  - `src/pages/admin/Performance.tsx`
  - `src/pages/admin/Profile.tsx`
  - `src/pages/app/AppHome.tsx`
  - 其他搜尋到 `cumulative_return` 當總績效顯示的地方

5. 補測試，鎖死正確口徑
- 更新 `src/test/integration/1.21-expert-performance-rpc.test.ts`
- 新增以下情境：
  - 有起始資金、無平倉、只有持倉浮盈時，總報酬率不可為 0
  - `current_asset` 與 `total_return_pct` 必須能互相反推
  - `starting_capital` 缺值時要有安全 fallback，不可產生假數字

技術細節

```text
現在錯誤公式
總報酬率 = sum(closed trades.pnl_percent)
目前資產   = sum(open positions market value)

修正後公式
目前資產 = 起始資金 + 已實現損益金額 + 未實現損益金額
總報酬率 = (目前資產 - 起始資金) / 起始資金
```

我判斷的根因
- 根因不是單純 UI 標錯字。
- 根因是後端 RPC 把「交易報酬百分比統計」誤當成「資產報酬率」，前端再把它包裝成總報酬顯示。
- 所以要修就要從 RPC + 所有消費端一起修，不能只改文案。

你一核准，我就直接把這整條修掉，連同所有顯示頁面一起統一。