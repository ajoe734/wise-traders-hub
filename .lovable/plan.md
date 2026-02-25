

# 方案管理權限調整計劃

## 需求理解

目前的設計是「分析師建立方案 → 送審 → 管理者核准」，需要調整為：

1. **分析師不能管理方案** — 移除分析師後台的「方案管理」頁面和導航
2. **公司後台不需要審核方案** — 移除 Review.tsx 中的「方案審核」Tab，因為方案由管理者直接建立，無需審核流程
3. **方案只有兩種固定訂閱制**（跟單派 / 修煉派），管理者可以新增新的訂閱制
4. **方案由管理者在公司後台直接建立和管理**

## 改動內容

### 1. 分析師後台 — 移除方案管理

**`src/components/layouts/AdminLayout.tsx`**
- 從 navItems 移除 `{ path: basePath/plans, icon: Package, label: '方案管理' }`

**`src/App.tsx`**
- 移除 `/admin/:expertSlug/plans` 路由
- 移除 `AdminPlans` 的 import

**`src/pages/admin/Plans.tsx`**
- 此檔案不再需要（可保留但不會被路由引用，或直接刪除）

### 2. 公司後台 — Review.tsx 簡化

由於方案由管理者直接建立，不存在「送審」流程，因此：

**`src/pages/company/Review.tsx`**
- 移除「方案審核」Tab，只保留「內容監管」（訊號事後下架）
- 頁面標題改為「內容監管」
- 移除方案審核相關的 state、函式（pendingPlans, approvePlan, rejectPlan, rejectingId 等）
- 移除退回方案的 Dialog

### 3. 公司後台 — 新增方案管理功能

管理者需要一個地方來建立和管理方案（為特定分析師建立訂閱方案）。有兩種放置方式：

- **方案一**：在「分析師管理」頁面（Analysts.tsx）中，點擊某個分析師後可以管理其方案
- **方案二**：在公司後台新增一個獨立的「方案管理」頁面

建議採用**方案一**，因為方案本來就是綁定在分析師身上的，在分析師管理頁面內操作最直覺。

**`src/pages/company/Analysts.tsx`**
- 每個分析師卡片新增「管理方案」按鈕
- 點擊後開啟 Dialog 或展開區塊，顯示該分析師目前的方案列表
- 管理者可新增方案（名稱、類型、月費、年費、描述）
- 新增的方案直接設為 `review_status: 'approved'`, `is_active: true`（無需審核流程）
- 可停用/啟用方案

### 4. 資料庫 — 簡化 review_status

由於方案不再需要審核流程，`expert_plans` 表的 `review_status` 欄位變得不必要。但為了避免破壞性變更，建議：
- 保留欄位但管理者建立方案時直接設為 `approved`
- 前端不再顯示審核狀態相關 UI

### 5. CompanyLayout 導航調整

**`src/components/layouts/CompanyLayout.tsx`**
- 將「內容審核」改名為「內容監管」（因為已不涉及審核，只有事後監管）

---

## 技術細節

### 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/components/layouts/AdminLayout.tsx` | 修改 | 移除「方案管理」導航項目 |
| `src/App.tsx` | 修改 | 移除 `/admin/:expertSlug/plans` 路由和 import |
| `src/pages/company/Review.tsx` | 修改 | 移除方案審核 Tab，只保留內容監管 |
| `src/pages/company/Analysts.tsx` | 修改 | 新增「管理方案」功能（Dialog 內可 CRUD 方案） |
| `src/components/layouts/CompanyLayout.tsx` | 修改 | 「內容審核」改為「內容監管」 |

### 方案建立邏輯

管理者在分析師管理頁建立方案時：
- `expert_id` 綁定該分析師
- `review_status` 直接設為 `approved`
- `is_active` 直接設為 `true`
- 無需送審流程

### 不需要資料庫變更

`expert_plans` 表結構不需修改，只是使用方式改變（管理者直接建立已核准的方案）。
