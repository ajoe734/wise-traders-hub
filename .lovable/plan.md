## 目標
在 `/company/plans`（方案管理）新增「健檢方案」分頁，讓 admin 直接管理 `checkup_plans`（持股健檢的 Basic / Pro），目前只能在資料庫手動改。

## 現況
- 方案管理頁僅有兩個 Tab：**方案審核 / 分潤**（分析師方案 `expert_plans`）、**跨產品折扣**（`payment_settings`）。
- `checkup_plans` 表（Basic 699 / Pro 1299）已有 RLS：`Admins full access checkup plans`，可直接以 supabase client 操作。
- 前端 `useCheckupPlans` 已在使用（健檢購買頁）。

## 規劃內容

### 1. 新增 Tab：健檢方案
位置：`src/pages/company/Plans.tsx` 外層 `Tabs` 內，新增第三個 TabsTrigger「健檢方案」（icon: `HeartPulse` 或 `Stethoscope`）。

### 2. 健檢方案管理 UI（Card 列表）
每個 plan 卡片顯示並可編輯：
- `name`（名稱）、`description`（描述）
- `tier`（basic / pro，下拉）
- `price_monthly` / `price_yearly`（NTD）
- `monthly_quota` + `quota_period`（month / week，下拉）
- `features`（字串陣列，逐行輸入 Textarea）
- `sort_order`（排序）
- `is_active`（Switch）

操作：
- **編輯**：點擊 Pencil 開 Sheet 編輯，存檔 `update`
- **新增**：右上「新增健檢方案」按鈕（保留彈性，雖然目前只用 Basic/Pro）
- **刪除**：Trash 圖示 + Confirm Dialog（保險起見禁止刪除有 active 訂閱者的 plan，先 count `checkup_subscriptions` 再 delete）
- **狀態切換**：Switch 直接 toggle `is_active`

所有寫入後：
- `queryClient.invalidateQueries(['checkup-plans'])`
- 呼叫 `logAdminAction('checkup_plan.update' / 'create' / 'delete', ...)` 寫入 audit_logs

### 3. 不動的部分
- 不改 schema，沿用現有欄位
- 不改 RLS（admin 已有 full access）
- 不影響購買流程與 `useCheckupPlans` hook

## 受影響檔案
- `src/pages/company/Plans.tsx`（新增 Tab + 整段健檢方案管理區塊；同檔內處理 list/edit/save/delete）

## 驗收
1. `/company/plans` 出現第三個分頁「健檢方案」
2. 看得到目前 Basic / Pro 兩筆，可改價、改額度、切換上下架
3. 改完後健檢購買頁立即反映新價格
4. 操作會記到 audit_logs
