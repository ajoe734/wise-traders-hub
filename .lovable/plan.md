## 目標

把目前分散在兩個側邊欄項目的「方案審核」（`/company/plan-review`）與「方案分潤」（`/company/plan-splits`）整併成單一頁 **「方案管理」** (`/company/plans`)，所有跟 expert plan 相關的後台操作集中一處。

## 現況問題

兩頁操作的是同一張 `expert_plans` 表的同一筆資料：

| 頁面 | 欄位 | 操作 |
|---|---|---|
| 方案審核 | `review_status`, `review_note`, `is_active` | 核准 / 退回 / 上下架 |
| 方案分潤 | `plan_split_overrides`（關聯表）| 設定平台/專家分潤% |

每次調整一個方案要在兩個側邊欄分頁切來切去，沒道理。

## 整合後的單一頁面

路由：`/company/plans`（保留舊兩個路由 redirect 過去，避免書籤失效）

側邊欄：移除「方案審核」「方案分潤」兩項，新增一項「**方案管理**」。

### 頁面結構

```text
┌─ 方案管理 ─────────────────────────────────────────────────┐
│ Tab: [待審核 (3)]  [全部方案]                               │
│                                                            │
│ 全站標準分潤：平台 55% / 專家 45%   [編輯預設]              │
├────────────────────────────────────────────────────────────┤
│ 方案表格（每列一個方案，欄位：）                            │
│  專家 | 方案名稱 | 類型 | 月費 | 上架 | 審核狀態 | 分潤    │
│                                                            │
│ 點任一列 → 右側展開詳情抽屜（Sheet）                        │
└────────────────────────────────────────────────────────────┘
```

### 詳情抽屜（單一方案的所有操作）

一個 Sheet 把該方案的全部資訊與動作集中：

1. **方案內容**：名稱、描述、類型、月/年費、features（唯讀展示）
2. **審核區塊**
   - 狀態 badge（草稿 / 待審核 / 已核准 / 已退回）
   - 動作：`核准` / `退回（填原因）` / `重新送審`
   - 顯示 `reviewed_at`、`review_note`
3. **上下架區塊**
   - `is_active` toggle
4. **分潤覆寫區塊**
   - 顯示「目前生效規則」：覆寫 `60/40` 或 fallback 到全站預設 `55/45`
   - 動作：`啟用覆寫` / `編輯比例` / `停用覆寫` / `刪除覆寫`
   - `pct_platform + pct_expert = 100` 驗證
   - 備註欄
5. **稽核軌跡**：建立時間、最後更新時間

### 列表上的快速指示

不用打開抽屜也能看到關鍵狀態：

- 審核狀態：彩色 badge
- 分潤欄：顯示 `55/45 (預設)` 灰字 或 `60/40 (覆寫)` 主色字，一眼分辨

## 技術細節

### 新增

- `src/pages/company/Plans.tsx`：合併版頁面（Tabs + Table + Sheet）
- 共用一次性查詢：`expert_plans` join `experts` + `plan_split_overrides` + `payment_settings(split_standard)`，避免重複請求

### 修改

- `src/components/layouts/CompanyLayout.tsx`：
  - 移除 `plan-review`、`plan-splits` 兩項
  - 新增一項 `{ path: '/company/plans', icon: Layers, label: '方案管理' }`
- `src/App.tsx`：
  - 新增 `/company/plans` 路由
  - 保留 `/company/plan-review`、`/company/plan-splits` 但改為 `<Navigate to="/company/plans" replace />`
- `src/pages/company/PaymentSettings.tsx` 第 76 行的提示連結：指向 `/company/plans`

### 刪除

- `src/pages/company/PlanReview.tsx`
- `src/pages/company/PlanSplits.tsx`

（程式碼裡的審核/分潤邏輯都搬進新的 `Plans.tsx`，沒有功能損失）

### 不動

- DB schema 不動（`expert_plans`、`plan_split_overrides`、`payment_settings.split_standard` 都維持）
- `calcSplit` 邏輯不動
- 全站預設分潤 (`split_standard`) 編輯入口仍保留在 `/company/payment-settings`，但本頁也可顯示+提供連結

## 驗收

1. 側邊欄只剩一個「方案管理」入口
2. 從列表點任一方案，可以在同一個抽屜完成「核准 / 退回 / 上下架 / 設定分潤覆寫」全套動作
3. 「待審核」分頁仍能一鍵看到所有 pending 方案
4. 舊網址 `/company/plan-review`、`/company/plan-splits` 自動導向新頁
5. 沒有任何功能遺失（既有測試 1.30 / 1.35 仍通過）
