# 重寫對帳中心（取代假的「營收數據」頁）

## 為什麼要做

目前 `/company/revenue` 是「假對帳」：
- 只加總 `payment_transactions.amount`，**完全沒讀 `revenue_splits`**（真正的會計口徑表）
- 看不到「每位專家每月應分多少」「健檢營收佔多少」「折扣吃掉多少」「平台應得多少」
- `/company/payments` 的交易紀錄也只有交易編號／金額／狀態，不知道是誰買、買哪個方案、屬於哪位專家

結果：你**根本沒辦法回答** — 「這個月收了多少？要分給某分析師多少？健檢賺多少？」

## 範圍（你已選：階段 A，會計口徑為主，健檢獨立頁籤）

把 `/company/revenue` 整頁重寫成「對帳中心」，**全部數字以 `revenue_splits` 為主**（不再加總 `payment_transactions`）。撥款流程（payouts 表）這次不做。

## 四個頁籤

### 1. 總覽
期間選擇器（本月／上月／自訂區間，預設本月，台北時區）。八張卡片＋兩張圖：
- 毛收 `SUM(gross)`
- 折扣 `SUM(discount)`
- 淨收 `SUM(net)`
- 平台應得 `SUM(platform_amount)`
- 專家應分總額 `SUM(expert_amount)`
- 訂閱營收（`expert_plan` 拆分）
- 健檢營收（`checkup` 拆分）
- 退款金額（從 `payment_transactions.status='refunded'` 取，獨立顯示，因為 `revenue_splits` 不會回沖）
- 月趨勢折線圖（按月聚合 `gross / platform_amount / expert_amount`）
- 來源拆分長條圖（信用卡 / 匯款 / LINE Pay / 健檢）

### 2. 訂閱明細
列出 `member_subscriptions` 全部紀錄（不限 active，含 cancelled/expired）：
- 訂閱者（join `profiles.display_name`、email）
- 方案（join `expert_plans.name`）
- 專家（join `experts.name`、role badge）
- 月費 / 年費、`billing_cycle`、`status`、`auto_renew`
- `started_at` / `expires_at`、下次扣款日（active+auto_renew 才算）
- 篩選：專家、方案類型（advisor/mentor）、狀態、auto_renew
- 匯出 CSV

### 3. 金流明細
合併 `payment_transactions` ＋ `remittance_orders` 為單一視角：
- 訂閱者、產品（訂閱方案/健檢方案，從 join 推斷）、金額、原價、折扣、折扣原因
- 來源金流（信用卡/匯款/LINE Pay/ACpay）
- 狀態（含 refunded）、建立時間、付款時間
- 退款入口（沿用現有 `Payments.tsx` 的退款 dialog 邏輯）
- 篩選 + CSV 匯出

### 4. 專家分潤對帳（核心新功能）
從 `revenue_splits` join `experts` 聚合：
- 表 1：本期每位專家應分總額（按 `expert_amount` 從大到小，含筆數、毛收、折扣、淨收）
- 表 2：點專家展開該期所有 split 明細（交易日、訂閱者、方案、毛收、折扣、淨收、平台、專家、`rule_source`）
- 期間切換、CSV 匯出

### 5. 健檢營收（獨立頁籤）
篩 `revenue_splits.expert_id IS NULL AND plan_id IS NULL`（健檢平台 100%）＋ join `checkup_subscriptions`：
- 健檢方案毛收 / 折扣 / 淨收（全進平台口袋）
- 訂閱明細：用戶、方案、週期、起訖、auto_renew
- 月趨勢圖、CSV 匯出

## 必須先解決的兩個資料盲點

這兩個盲點如果不處理，對帳數字會錯。Plan 裡會一併修。

### 盲點 1：匯款退款不會反映在會計口徑
`acpay-refund` 只 update `payment_transactions.status='refunded'`，但 `revenue_splits` 沒有反向沖銷紀錄。  
**處理**：對帳中心顯示「退款」時，獨立從 `payment_transactions` 取，**不從 splits 扣**。在 UI 明確標示「淨收 ＝ revenue_splits 加總（不含退款）」，「實際淨收 ＝ 淨收 − 退款」分兩行呈現。會計師才不會被誤導。

### 盲點 2：早期遺留交易可能沒寫 splits
`writeRevenueSplit` 是後加的（測試 1.34 才補上），歷史 `payment_transactions` 不一定都有對應 `revenue_splits`。  
**處理**：總覽頁加一張「**對帳健康度**」小卡：`COUNT(payment_transactions WHERE status='paid') vs COUNT(revenue_splits)`，若不等顯示警示與「修補」按鈕（這次不實作修補，只先暴露問題）。

## 側邊欄與檔案動作

- `CompanyLayout.tsx`：「營收數據」改名「**對帳中心**」（Receipt 圖示）
- `src/pages/company/Revenue.tsx`：整檔重寫
- `src/pages/company/Payments.tsx`：移除「交易紀錄」tab（搬到對帳中心金流明細頁籤），只保留「金流工具」管理。頁名改為「**金流工具**」
- `App.tsx` route `/company/payments` 保留，內容瘦身

## 不做的（明確劃掉）
- 不建 `payouts` 撥款表、不做撥款流程（你說只做 A）
- 不改 `revenue_splits` schema、不改 `paymentProcessor.ts` 寫入邏輯
- 不補寫歷史缺漏的 splits（先暴露、不修）
- 不改 `Subscribers.tsx`（那是會員視角，不是對帳）

## 技術細節

- 全部用 `supabase.from(...).select(... join ...)`，不寫 RPC（資料量初期不大）
- 期間 default：當月 1 號 00:00 (UTC+8) 到現在
- 列表分頁：每頁 50 筆，前端排序＋篩選
- CSV 匯出沿用現有 BOM + `encodeURIComponent` 模式（Revenue.tsx 已有範本）
- 顏色：金額正向 → primary；退款 → destructive；專家欄 mentor 用 `bg-mentor`、advisor 用 primary（依 Core memory）
- 日期統一 `YYYY/MM/DD`（依 Core memory）
- RLS 已就緒：`revenue_splits` / `payment_transactions` / `member_subscriptions` 都有 `company_admin full access`，不需新 policy
