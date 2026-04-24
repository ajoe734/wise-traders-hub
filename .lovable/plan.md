

# 修正計畫：回測 KPI 改為系統自動計算

## 變更重點

撤回原計畫中「分析師可手動編輯回測 KPI」的設計。回測數據必須由系統根據 `trade_records` 自動計算，分析師與管理員皆不可手動修改，避免數據造假。

## 範圍

### 1. 個人檔案頁（`src/pages/admin/Profile.tsx`）
- 「策略與回測」卡片**只保留** `strategy_summary`（策略摘要）為可編輯欄位
- 移除 `backtest_1y_return` / `backtest_max_drawdown` / `backtest_annual_return` 的輸入欄位
- 改為**唯讀展示區塊**：顯示由 RPC 即時計算的數字，旁邊標註「系統依實際交易紀錄自動計算」

### 2. 資料來源
- 直接使用既有 `calculate_expert_performance(_expert_id)` RPC 回傳值：
  - `cumulative_return` → 1 年累積報酬
  - `max_drawdown` → 最大回撤
  - 年化報酬：以 `cumulative_return` 與最早 `entry_date` 推算（前端純函數），或新增 RPC 回傳欄位
- Profile 頁掛載 `usePerformance(expertId)` hook 取數

### 3. 訂閱方案管理頁（不變）
維持原計畫第 2 點 `src/pages/admin/Plans.tsx` 完整實作（名稱／價格／features／上下架）。

### 4. 前台讀取自訂 features（不變）
維持原計畫第 3 點 `ExpertProfile.tsx` 改為優先讀 DB `plan.features`。

### 5. 公司管理員 read-only（不變）
維持原計畫第 4 點，新增頁面對 `company_admin && !isOwner` 顯示 disabled。

## 資料庫處理

- **不新增 schema 欄位**
- `experts.backtest_1y_return` / `backtest_max_drawdown` / `backtest_annual_return` 三欄為「歷史殘留欄位」：
  - **保留欄位**避免破壞現有讀取點
  - 建立 migration **撤銷既有寫入權限**：在 `experts` UPDATE policy 加 `WITH CHECK` 阻擋這三欄變更，或新增 `BEFORE UPDATE` trigger 強制保持原值（推薦 trigger 方案，policy 不易表達單欄保護）
  - 後續可另案規劃由排程任務同步寫入

## 不在範圍

- 公司管理員手動覆寫回測數值的後門
- 自動排程把 RPC 結果寫回 `experts` 三欄（可後續另案）
- 年化報酬 RPC 欄位新增（若前端純函數計算可接受則不動 RPC）

## 預期成果

- 分析師後台「策略與回測」區只能改文字摘要，三項 KPI 為唯讀即時計算
- 即使透過 API 直接打 PATCH，trigger 也會擋下三欄變更
- 改動 4 檔（Profile.tsx、ExpertProfile.tsx、AdminLayout.tsx、App.tsx）+ 新增 2 檔（Plans.tsx、migration sql）

