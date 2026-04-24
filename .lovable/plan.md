

# 補齊：方案審核流程 + 前台 features + 週記澄清 + 訂閱者預覽

針對你提出的 4 個缺口，逐項補上。

## 1. 訂閱方案管理 — 加回「公司審核」流程

### Schema 變更
重新加入 `expert_plans.review_status` 欄位（曾被移除）：
- 型別：`review_status` enum (`draft`, `pending`, `approved`, `rejected`)
- 預設值：`draft`
- 加 `review_note text`、`reviewed_by uuid`、`reviewed_at timestamptz`

### RLS 調整
- **公開可見條件**改為：`is_active = true AND review_status = 'approved'`（前台只看得到審核通過的方案）
- 分析師：可 SELECT/INSERT/UPDATE 自己的方案，但 UPDATE 時不得自行修改 `review_status`（用 trigger 強制：分析師更新會把 `review_status` 重設為 `pending`、清空審核註記）
- 公司管理員：可改 `review_status` 與 `review_note`

### 分析師後台（`Plans.tsx`）
- 列表新增「審核狀態」欄位：`draft`(灰)/`pending`(琥珀)/`approved`(綠)/`rejected`(紅+顯示退回原因)
- 「啟用」開關保留，但加註：「審核通過後啟用才會在前台上架」
- 編輯儲存後 toast 提示：「方案已送審，公司審核通過後即上架」
- 被退回的方案再次編輯送審時自動轉回 `pending`

### 公司後台（新檔 `src/pages/company/PlanReview.tsx`）
- 路徑 `/company/plan-review`，側欄新增「方案審核」項目
- Tab：待審核 / 全部
- 列表顯示分析師、方案名、價格、亮點、`review_status`
- 操作：「核准」「退回（須填原因）」
- 核准會寫 `reviewed_by = auth.uid()`、`reviewed_at = now()`、`review_status = 'approved'`
- 退回會寫 `review_status = 'rejected'` 與 `review_note`

## 2. 前台 features 三處統一讀 DB

修改 `Checkout.tsx` 與 `PlanDetail.tsx`，套用與 `ExpertProfile.tsx` 相同的 fallback 邏輯：

```
features 為非空字串陣列 → 顯示 DB 內容
否則 → fallback 到 getPlanFeatures(planType) 預設清單
```

確保分析師在後台填寫的方案亮點，可以同步出現在「個人頁」「方案詳情頁」「結帳頁」三個前台位置。

## 3. 週記功能澄清（無程式碼變更，只改文案）

實戰導師已可在 `/admin/:slug/signals`（側欄顯示「週記管理」）撰寫週記，發布後狀態為 `pending`，週五 20:00 由排程自動轉 `published`。會被誤解的原因是側欄項目雖有切換但不夠明顯。

**改進**：
- `AdminLayout.tsx` 側欄「週記管理」項目下方加一行小字提示：「週記於每週五 20:00 自動發布」
- `admin/Dashboard.tsx` 對 mentor 角色加一張卡片「📓 撰寫本週週記」直接跳 `/admin/:slug/signals`，避免分析師找不到入口

## 4. 訂閱者預覽模式（最重要的可用性補強）

新增「以訂閱者視角預覽」按鈕，讓分析師/導師可即時驗證自己的方案內容、訊號／週記、個人頁如何呈現。

### 實作方式
- `AdminLayout.tsx` 頂部側欄 Header 區塊新增「👁 訂閱者預覽」按鈕
- 點擊後在新分頁開啟 `/expert/:slug?preview=1`
- `ExpertProfile.tsx`、`PlanDetail.tsx`、`AppSignalDetail.tsx`、`AppJournalDetail.tsx` 偵測 `preview=1` 且 `user.expertSlug === slug`（或 `hasRole('company_admin')`）時：
  - 略過訂閱檢查，直接顯示完整訂閱者畫面
  - 頁面頂端顯示固定 banner：「🔍 訂閱者預覽模式 | 此畫面僅自己可見 | 退出預覽」
  - 所有「立即訂閱／結帳」按鈕禁用，避免誤點
- 額外提供 `/admin/:slug/preview/signals/:id`、`/admin/:slug/preview/journals/:id` 入口（從訊號列表「預覽」按鈕直接跳轉）

### 安全性
- preview 模式僅在前端顯示已 RLS 通過的資料（分析師本來就能讀自己的訊號）
- 不繞過任何 DB 權限，僅繞過 UI 層的「需訂閱才能看」檢查

## 變更檔案清單

| 類型 | 檔案 |
|---|---|
| Migration | 新增 `expert_plans.review_status` 等欄位、調整 RLS、新增分析師更新 trigger |
| 編輯 | `src/pages/admin/Plans.tsx`（審核狀態欄、提示文案） |
| 新增 | `src/pages/company/PlanReview.tsx`（審核頁） |
| 編輯 | `src/components/layouts/CompanyLayout.tsx` 側欄項目（如有則改，無則用現有 layout） |
| 編輯 | `src/App.tsx`（註冊 `/company/plan-review` 路由） |
| 編輯 | `src/pages/Checkout.tsx`（features fallback） |
| 編輯 | `src/pages/PlanDetail.tsx`（features fallback） |
| 編輯 | `src/components/layouts/AdminLayout.tsx`（週記提示、訂閱者預覽按鈕） |
| 編輯 | `src/pages/admin/Dashboard.tsx`（mentor 撰寫週記卡片） |
| 編輯 | `src/pages/ExpertProfile.tsx`（preview=1 模式 + banner） |
| 編輯 | `src/pages/PlanDetail.tsx`（preview=1 模式） |
| 編輯 | `src/pages/app/SignalDetail.tsx`、`src/pages/app/JournalDetail.tsx`（preview=1 繞過訂閱檢查） |

## 不在範圍

- 重新設計訊號／週記發布流程
- 方案實體刪除（仍只允許停用）
- 預覽模式下的 LINE 推播模擬（推播本身已可發送）

