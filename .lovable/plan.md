# /expert/sharkgu 問題修正計畫

## 我看到的真問題

不是只有「要不要計入未實現損益」而已，現在至少還有 4 個明確問題：

1. **同一頁重抓了兩次專家資料**
   - `ExpertProfile.tsx` 自己查一次 `experts`
   - `PerformanceOverviewPanel.tsx` 又用 `useExpert(expertSlug)` 再查一次 `experts + expert_plans(*)`
   - 實際網路紀錄已看到兩筆：
     - `experts?select=id,name,bio...&slug=eq.sharkgu`
     - `experts?select=*,expert_plans(*)&slug=eq.sharkgu`

2. **方案資料也重抓了兩次**
   - `ExpertProfile.tsx` 已查 `expert_plans`
   - `useExpert()` 又把 `expert_plans(*)` 一起撈回來
   - 這代表一個頁面 render 要多付一筆沒必要的關聯查詢

3. **績效圖的時間序列邏輯確實還有 bug**
   - 目前 `usePeriodPerformance.ts` 在 `snapshotPnL()` / `perStockPnLAt()` 對「非當日的未平倉部位」直接套 **最新 `current_price`**
   - 這會把過去每一天都用今天價格重算，週/月曲線都被污染
   - 同時 `perStockSnapshot()` 又在非 today 回退成 `entryPrice`，造成：
     - 總曲線一套算法
     - 個股排行另一套算法
     - 兩邊互相對不起來

4. **目前圖表資料與 KPI 來源拆成兩套，存在漂移風險**
   - KPI 走 `calculate_expert_performance` RPC
   - 圖表走前端自行從 `trade_records` 重算
   - 只要估值規則、fallback 規則、日期切點有一點不同，就會再出現「KPI 對，圖表錯」或反過來

## 我確認過的現況

- `/expert/sharkgu` 目前頁面請求主要是：
  - 1 次專家主資料
  - 1 次方案
  - 1 次我的訂閱
  - 1 次訂閱人數
  - 1 次 RPC 績效 KPI
  - 1 次 `trade_records`
  - 1 次 `starting_capital`
  - 再加 **重複的 expert + expert_plans 查詢**
- 瀏覽器量測顯示：
  - `DOMContentLoaded` 約 **8.3s**
  - `FCP` 約 **14.1s**
- JS 很重，但對這頁來說，**先要砍的是重複資料流與錯誤的前端重算**

## 修正方案

### 1) 先把專家頁資料流去重
- 改 `PerformanceOverviewPanel` API，不再吃 `expertSlug` 後自己查 `useExpert()`
- 由 `ExpertProfile.tsx` 直接把已拿到的 `expertId` / `startingCapital` / `variant` 傳進去
- 這樣可以直接砍掉：
  - 重複的 `experts` 查詢
  - 連帶重複的 `expert_plans(*)` 查詢
  - 額外的 `experts?select=starting_capital` 查詢

### 2) 修正績效圖估值規則，保留未實現損益
- **未實現損益要保留**，但要用正確時間點的價格
- 在 `usePeriodPerformance.ts` 補抓 `daily_price_snapshots`
- 統一規則為：
  - 若 D 當天有日收盤快照 → 用 `close_price`
  - 若 D 是今天且有 `current_price` → 用 `current_price`
  - 若都沒有 → fallback `entry_price`
- 同一套規則共用到：
  - `snapshotPnL`
  - `perStockPnLAt`
  - `perStockSnapshot`
  - `perStockRangeReturn`

### 3) 讓圖表和 KPI 對齊
- 圖表終點（最後一個 bucket 的累積值）必須與 RPC 的 `total_return_pct` 對得起來
- 若最後一天是 today，終點應與目前 KPI 一致
- 週/月/年的中間點則依歷史快照計算，不再拿今天價格回填過去

### 4) 順手清掉一個小噪音
- `member_subscriptions` 的 `HEAD` count request 在瀏覽器被標成 `ERR_ABORTED`
- 雖然不是主因，但會讓網路面板看起來像壞掉；我會順手確認是否需要改成較穩定的計數方式或避免重複觸發

## 會改到的檔案

- `src/pages/ExpertProfile.tsx`
- `src/components/strategy/PerformanceOverviewPanel.tsx`
- `src/hooks/usePeriodPerformance.ts`

## 驗證方式

1. 重開 `/expert/sharkgu`，確認 expert / plans 查詢次數下降
2. 確認圖表終點 = KPI `total_return_pct`
3. 確認 5/5、5/8、5/13、5/14 這些節點不再拿今天價格污染過去
4. 確認個股 best/worst 與整體曲線使用同一套估值規則

## 技術細節

- 這次不改資料庫 schema
- 只改前端查詢結構與圖表計算邏輯
- 核心原則是：
  - **未實現損益要算**
  - **但只能算到當時那一天的價格，不是拿今天價格灌回過去**
  - **同一頁不要重查同一份 expert / plans 資料**