## 問題

彥愷（分析師）發布「賣出 / 減碼 / 平倉」訊號後，該股票仍出現在「目前持倉」清單中。

## Root Cause

`handle_signal_trade` trigger 寫得有缺陷：

```sql
-- handle_signal_trade (現況)
IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
IF NEW.status <> 'pending' THEN RETURN NEW; END IF;   -- ← 這行是 bug
```

但前端 `SignalEditor.tsx:330` 的寫入策略是：

```ts
const status = isMentor ? 'pending' : 'published';
```

也就是 **Advisor 發訊號直接 INSERT `status='published'`**，trigger 第二行就 `RETURN NEW`，完全不會去動 `trade_records`。結果：
- `buy/add` → 從不寫入 `trade_records`（持倉憑空消失）
- `sell/trim/exit` → 從不關閉 `trade_records`（持倉永遠殘留 ← 彥愷遇到的）

UPDATE 分支（pending → published）也只 `RETURN NEW`，沒有任何 trade_records 處理邏輯，所以 mentor 過審轉 published 時也不會處理。

實務上 advisor 的持倉之所以「看起來偶爾正確」，是因為某些訊號是手動透過 `trade_records` 表直接維護，或經由 `handle_signal_takedown`（這個 trigger 有完整邏輯）誤打誤撞處理掉。但賣出新訊號的正常路徑是壞的。

## 影響範圍

- `expert_signals` action ∈ `{buy, add, sell, trim, exit}` 的 advisor 訊號
- `trade_records.status='open'` 殘留 → `get_expert_capital_status` RPC、`CapitalPanel`、`/admin/performance`、`/admin/dashboard`、`useMyHoldings` 全部受影響
- `calculate_expert_performance` 算出來的 unrealized PnL 也錯（舊單沒關）

## 修復方案

只需改 trigger，前端不動：

### 1. Migration: 修 `handle_signal_trade`

把 INSERT 觸發條件放寬，讓 advisor 直接 `published` 的訊號也跑進 trade_records 處理；同時讓 UPDATE 分支（mentor 過審 pending→published）也跑同一套邏輯，避免 mentor 過審後持倉也殘留。

關鍵改動（pseudo）：

```sql
-- 改成「INSERT 且 status='published'」或「UPDATE 從 pending → published」都跑
should_apply boolean := false;
IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
  should_apply := true;
ELSIF TG_OP = 'UPDATE'
   AND OLD.status = 'pending' AND NEW.status = 'published' THEN
  should_apply := true;
END IF;

IF NOT should_apply THEN RETURN NEW; END IF;

-- 以下原本 buy/add/sell/trim/exit 的 trade_records 邏輯保持不變
```

附帶確認：
- 不要讓 pending 階段就動 trade_records（避免 mentor 草稿污染持倉）
- `handle_signal_takedown` 撤單邏輯不動，已經正確處理 published → taken_down
- `enforce_signal_capital_limit` 仍會在 INSERT 前擋資金，不受影響

### 2. 一次性修補既有壞資料

掃描所有「sell/trim/exit 訊號已 published 但對應 `trade_records` 仍 `status='open'` 沒 exit_date」的孤兒紀錄，依該訊號重跑同樣的關倉邏輯（計算 sell_qty、remaining_qty、exit_price、pnl_percent、status='closed'）。彥愷與其他 advisor 帳上目前殘留的舊持倉會在這一步清掉。

修補 SQL 會用 `expert_signals` 過去的 sell/trim/exit 紀錄重放到 trade_records，避免他要手動逐筆關倉。

### 3. 驗證

- 用彥愷的 expert_id 跑 `get_expert_capital_status` 看 open_positions 數量
- 撈幾筆最近的 sell signal 看 trade_records.status 是否變成 closed
- 跑 `calculate_expert_performance` 確認 unrealized 變正常

## 不做的事

- 不改前端 SignalEditor（advisor 維持直發 published，mentor 維持送審 pending）
- 不動 `handle_signal_takedown`（撤單流程是另一個 trigger，邏輯完整）
- 不動持倉 UI 與 RPC（資料對了 UI 自然對）

需要你確認後我才實際送 migration（會跳出審核），順便把彥愷帳上殘留的舊持倉一併補修。
