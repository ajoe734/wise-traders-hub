

# 計畫：週記功能串接真實數據 + TWSE API + 移除方案管理

## 要做的事

### 1. 移除分析師管理頁的「方案」按鈕和彈窗
從 `src/pages/company/Analysts.tsx` 移除：
- 操作欄的「方案」按鈕（第 334-336 行）
- Plan Management Dialog（第 357-393 行）
- Add Plan Dialog（第 395-435 行）
- 所有方案相關 state 和函數（`planExpert`, `plans`, `openPlans`, `closePlans`, `togglePlanActive`, `handleAddPlan`, `getPlanTypeOptions`, `planTypeLabel` 等，第 31-40 行、91-140 行、220-239 行）

保留：LINE 設定、後台連結、啟用/停用。

### 2. 建立 `twse-proxy` Edge Function
建立 `supabase/functions/twse-proxy/index.ts`，代理 TWSE OpenAPI 呼叫：

- 支援查詢參數 `endpoint`（如 `STOCK_DAY_ALL`, `BWIBBU_ALL`）和 `code`（股票代碼篩選）
- 從 TWSE 拿完整資料後依 `code` 過濾，只回傳需要的個股
- 加上 `config.toml` 設定 `verify_jwt = false`

已確認的 TWSE API 回傳格式：
- `STOCK_DAY_ALL`：`{Code, Name, ClosingPrice, Change, TradeVolume, OpeningPrice, HighestPrice, LowestPrice, Transaction}`
- `BWIBBU_ALL`：`{Code, Name, PEratio, DividendYield, PBratio}`

### 3. 週記列表頁串接真實資料（`app/Journals.tsx`）
- 移除 `getJournalsForUser` mock 呼叫
- 改為查詢 `expert_signals` 表，篩選條件：
  - 使用者有訂閱的 mentor 的 expert_id（透過 `member_subscriptions` + `expert_plans` + `experts WHERE role='mentor'`）
  - `status = 'published'`
  - `published_at <= now() - 7 days`（T+7 延遲）
- 按 `published_at` 降序排列
- 以週為單位分組顯示（用 `date-fns` 的 `startOfWeek`/`endOfWeek`）

### 4. 週記詳情頁串接真實資料（`app/JournalDetail.tsx`）
- 移除 `getJournalById` mock
- 改為查詢單一 `expert_signals` 記錄（by id），同時 join `experts` 取得導師資訊
- 查詢同一 expert 同一週的 `trade_records` 作為「本週操作列表」
- 呼叫 `twse-proxy` Edge Function，傳入該週操作的股票代碼，取得本益比、殖利率等基本面資料，附在週記下方作為「市場數據參考」區塊

### 5. 週記詳情新增「TWSE 市場數據」區塊
在 `JournalDetail` 頁面底部（disclaimer 之前），新增一個卡片：
- 標題：「本週相關個股數據（TWSE）」
- 顯示該週記涉及的每檔股票的：收盤價、漲跌、本益比、殖利率、股價淨值比
- 資料來自 `twse-proxy` Edge Function

### 6. 更新 JournalCard 元件
- 調整 `JournalCard` 接受 DB 格式的資料（`expert_signals` 欄位），不再依賴 mock 的 `JournalWithPerson` 型別
- 或建立一個轉換層將 DB 資料映射為 JournalCard 所需的格式

## 技術細節

### TWSE Proxy Edge Function 架構
```text
GET /twse-proxy?endpoint=STOCK_DAY_ALL&codes=2330,2317
GET /twse-proxy?endpoint=BWIBBU_ALL&codes=2330,2317

回傳：過濾後的 JSON 陣列
快取：同一交易日內的資料可重複使用（TWSE 每日收盤後更新一次）
```

### 資料庫查詢邏輯（Journals 頁面）
```text
1. 取得使用者訂閱的 mentor expert_ids
   member_subscriptions (active) → expert_plans → experts (role=mentor)

2. 查詢 expert_signals
   WHERE expert_id IN (mentor_ids)
   AND status = 'published'
   AND published_at <= now() - 7 days
   ORDER BY published_at DESC

3. 前端按週分組顯示
```

### 不需要新增資料庫表格
現有的 `expert_signals` + `trade_records` + `experts` 已足夠支撐所有週記功能。

