## 目標
`/company/users` 帳號管理列表目前只顯示名稱、Email、角色、開關與狀態，無法判斷會員活躍度。加入註冊時間、最近登入時間，並用相對時間（如「3 天前」）+ tooltip 顯示絕對日期，讓管理員一眼看出誰是活躍會員。

## 修改

### 1. `supabase/functions/admin-manage-users/index.ts`（list action）
- `authById` 除了 `email` / `banned_until`，加入 `last_sign_in_at`
- 回傳的每筆 row 新增 `last_sign_in_at`（`created_at` 已存在）

### 2. `src/pages/company/Users.tsx`
- `UserRow` 型別加 `last_sign_in_at: string | null`
- Table 新增兩個欄位：**註冊時間**、**最近登入**
  - 顯示格式：相對時間（如「3 天前」「從未登入」），底下小字灰色顯示 `YYYY/MM/DD`
  - 「從未登入」與「超過 30 天」用弱化色，最近 7 天正常色，讓活躍度一目了然
- 新增排序切換：在既有 filter 旁加下拉「排序：註冊時間新→舊 / 最近登入新→舊」，預設「最近登入」以便快速看到活躍者
- 提供一個小工具 `formatRelativeTw(iso)`（就近置於檔案內）產生「N 分鐘/小時/天/月前」，日期字串一律 `YYYY/MM/DD`（符合專案 Core 規則）

### 3. RWD
表格已在 `overflow-x-auto` 之下，2 個新欄位不會影響現有版面；不動 mobile 卡片版本。

## 驗證
- 手動：進 `/company/users`，確認新欄位有資料、排序可切換；Line 帳號若 `last_sign_in_at` 為 null 顯示「從未登入」
- 型別：`tsgo` 於 build 階段驗證
