## 目標

分析師後台的「發訊號」頁面要把資金當真錢管：超過剩餘現金不准送出，並讓分析師清楚看到目前持倉與最近交易。

---

## 一、剩餘資金（可用現金）定義

```text
available_cash =
    starting_capital
  + Σ realized_pnl_amount        (status IN closed/stopped 的已實現損益)
  − Σ open_cost_value             (status = open 的 entry_price × quantity)
```

買進／加碼會佔用現金；賣出／減碼／平損會釋放現金 + 結算損益。
單位一律以「股」為基準（沿用上一輪修正後的 trade_records.quantity = 股數）。

---

## 二、新增 RPC：`get_expert_capital_status(_expert_id)`

回傳：
- `starting_capital`
- `realized_pnl_amount`
- `open_cost_value`
- `available_cash`
- `open_positions`：JSON array `[{ symbol, instrument, quantity_shares, entry_price, current_price, market_value, unrealized_pnl, unrealized_pct }]`
- `recent_trades`：最近 20 筆 trade_records（含 buy/sell、entry/exit、pnl）

SECURITY DEFINER；前端 admin 頁面用一次呼叫拿齊所有資料。

---

## 三、SignalEditor 改造（`src/pages/admin/SignalEditor.tsx`）

### 1. 頂部新增「資金看板」區塊

```text
起始資金  $X,XXX,XXX
可用現金  $X,XXX,XXX   ← 大字、紅字若 <0
未平倉成本 $X,XXX,XXX
已實現損益 +/− $X,XXX
```

### 2. 「目前持倉」表格（折疊面板，預設展開）

欄位：股票｜股數｜均價｜現價｜市值｜未實現損益（紅漲綠跌）。
點任一列 → 自動帶入新交易草稿（股票代碼 + 對應的 add/trim/sell 動作）。

### 3. 「最近交易紀錄」表格（折疊，預設收合）

最近 20 筆：日期｜股票｜動作｜股數｜進價／出價｜損益%。

### 4. 即時資金模擬與硬擋

在原本 `simulatePositions` 之外新增 `simulateCash`：

```text
remaining = available_cash
for each trade in trades:
  shares = qty * (unit==='張' ? 1000 : 1)
  if action in (buy, add):  remaining -= price * shares
  if action in (sell, trim, exit):
     remaining += price * shares           (粗估現金釋放)
```

驗證規則（`validate()` 內）：
- 任一筆 `buy/add` 導致 `remaining < 0` → 回傳「第 N 檔：本筆需 $Y，剩餘僅 $X，已超過操作金額上限」並 **block 送出**。
- `sell/trim` 數量不得超過模擬持倉股數（沿用既有檢查）。
- `exit` 一律平掉該檔全部持倉。

UI 上即時顯示「本批送出後可用現金 $X,XXX」，紅字代表超額。

### 5. 快捷鍵

每筆交易卡片旁加「最大可買股數」按鈕：依 `floor(remaining_cash / price)` 自動帶數量；單位預設「股」以避開單位混淆。

---

## 四、其他後台頁面同步顯示資金狀況

- **`src/pages/admin/Dashboard.tsx`**：頂部 KPI 加「可用現金」卡。
- **`src/pages/admin/Performance.tsx`**：右側面板顯示 `starting_capital / available_cash / open_cost / realized`。
- **`src/pages/admin/Profile.tsx`**：`starting_capital` 欄位旁標註「目前可用現金 $X」當參考，但起始資金仍由 company_admin 鎖定編輯。

---

## 五、後端保險（防止前端被繞過）

新增 trigger `enforce_signal_capital_limit` on `expert_signals` BEFORE INSERT/UPDATE：
- 只對 `action IN ('buy','add')` 檢查。
- 計算當下 `available_cash`，若 `price_hint × normalized_shares > available_cash` → `RAISE EXCEPTION 'CAPITAL_EXCEEDED'`。
- `company_admin` 角色不檢查（豁免）。

> 注意：同一批多筆訊號需依序檢查，trigger 自然按 row 依序執行，因為買進後會立刻寫入 trade_records，下一 row 重新查 available_cash 就會反映前一筆。

---

## 六、檔案異動清單

- `supabase/migrations/<new>.sql`
  - 新 RPC `get_expert_capital_status`
  - 新 trigger `enforce_signal_capital_limit` + function
- `src/pages/admin/SignalEditor.tsx`：資金看板、持倉/交易表、`simulateCash`、硬擋、最大可買按鈕
- `src/pages/admin/Dashboard.tsx`：可用現金 KPI
- `src/pages/admin/Performance.tsx`：資金摘要
- `src/pages/admin/Profile.tsx`：起始資金旁顯示可用現金
- `src/lib/signalTradeLogic.ts`：新增 `calcAvailableCash`、`simulateCashAfterTrades` 純函式
- `src/test/unit/1.27-signal-trade-logic.test.ts`：補資金模擬單元測試
- `src/test/integration/1.16-signal-trade-trigger.test.ts`：補 `CAPITAL_EXCEEDED` 行為測試
