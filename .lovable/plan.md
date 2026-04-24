

# 補齊分析師後台前台內容編輯能力

## 範圍

### 1. 個人檔案頁擴充（`src/pages/admin/Profile.tsx`）
新增「策略與回測」卡片，欄位皆寫入 `experts` 既有欄位：
- 策略摘要 `strategy_summary`（Textarea，3 行）
- 回測 1 年報酬率 `backtest_1y_return`（百分比 number）
- 回測最大回撤 `backtest_max_drawdown`（百分比 number）
- 回測年化報酬率 `backtest_annual_return`（百分比 number）
- 與既有「儲存變更」按鈕同步存檔，沿用現有 `experts` UPDATE RLS

### 2. 新增「訂閱方案管理」頁
新檔 `src/pages/admin/Plans.tsx`，路徑 `/admin/:expertSlug/plans`：
- 列表顯示該分析師所有 `expert_plans`（含未啟用），欄位：名稱／類型 badge／月費／年費／啟用狀態／訂閱人數
- 「新增方案」按鈕 → Dialog 表單：
  - 方案名稱、描述、`plan_type`（依角色限制：advisor 只可選 `analyst_signal_l1`/`analyst_signal_diag_l2`，mentor 只可選 `mentor_weekly_journal`）
  - 月費、年費（年費可空）
  - 方案亮點 `features`（動態多筆字串陣列，存 jsonb）
  - 啟用 switch
- 列表每筆「編輯」「停用／啟用」按鈕；停用後前台立即下架（沿用 RLS `is_active = true`）
- 已有訂閱者的方案不可刪除（僅停用），改價時顯示警告：現有訂閱維持原價直到下次續扣
- `AdminLayout` 側邊欄新增「訂閱方案」項目（Wallet icon），位於「訊號管理／週記管理」下方
- `App.tsx` 註冊路由

### 3. 前台讀取自訂 `features`（`src/pages/ExpertProfile.tsx`）
- 當 `plan.features` 為非空陣列時改顯示 DB 內容，否則 fallback 到目前的 `getPlanFeatures(planType)` 寫死清單
- 維持向下相容，現有方案無需 backfill

### 4. 公司管理員視角 read-only
- 新增的「策略與回測」與「訂閱方案管理」頁，當 `hasRole('company_admin') && !isOwner` 時所有輸入 disabled、按鈕隱藏（沿用 Profile.tsx 既有 `isReadOnly` 模式）

## 技術細節

- **無 schema 變更**：所有欄位（`strategy_summary`、`backtest_*`、`expert_plans.features`）已存在
- **RLS**：`expert_plans` 已有 analyst 自助 INSERT/UPDATE/SELECT policy，無需新增
- **驗證**：前端強制 `price_monthly >= 0`，年費若填則須 ≥ 月費 × 6（合理折扣區間）
- **訂閱人數**：用 `member_subscriptions` count `status='active'` join `plan_id`
- **不引入新依賴**：沿用 shadcn `Dialog`、`Switch`、`Table`、`Badge`

## 不在範圍

- 績效圖表的數據編輯（自動由 `trade_records` 計算，不開放手改）
- LINE 推播設定（已另有頁面或公司端管理）
- 起始資金修改（既有設計：一次鎖定）
- 方案實體刪除（合規上保留歷史紀錄）

## 預期成果

- 分析師可在後台自助維護「前台 Hero 區策略摘要」「績效區回測 KPI」「訂閱方案完整內容（名稱/價格/亮點/上下架）」
- 改動 2 檔（Profile.tsx、ExpertProfile.tsx、AdminLayout.tsx、App.tsx）+ 新增 1 檔（Plans.tsx），共 5 檔
- 無 DB migration、無 edge function 變更

