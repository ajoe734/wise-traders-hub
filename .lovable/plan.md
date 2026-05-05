# 帳號權限管理（後台）

確實沒有，現在唯一能改角色的方法是手動下 SQL（之前把你升 company_admin 也是）。補一個正式頁面。

## 範圍
新增 `/company/users`，company_admin 專用：
- 搜尋使用者（email / 顯示名稱 / Line 綁定）
- 看每個帳號目前的角色（company_admin / analyst）、是否為 Line 帳號、`is_tester`、`expert_slug`
- 指派 / 移除 `company_admin`、`analyst` 角色
- 切換 `is_tester`
- 所有變更寫入 `audit_logs`

## 技術細節

### 1. Edge Function: `admin-manage-users`
RLS 不允許前端直接寫 `user_roles` 跨人操作 +  `auth.users` 也讀不到 email，需要 service-role function。

動作：
- `list`：分頁/搜尋。join `auth.users`(email) + `profiles` + `user_roles` 聚合
- `set_role`：`{ user_id, role, enabled }` → upsert / delete `user_roles`
- `set_tester`：`{ user_id, value }` → 更新 `profiles.is_tester`

每次操作前在 function 內驗證呼叫者必須是 `company_admin`（用 caller JWT 建一個 client 跑 `has_role`），通過後才用 service-role client 寫入。

護欄：
- 不能把自己的 `company_admin` 拔掉（避免把自己鎖在外面）
- 至少保留 1 位 `company_admin`
- 寫入 `audit_logs`：`action='role.grant' / 'role.revoke' / 'tester.toggle'`，`target_id=user_id`，`detail` 帶舊/新值

### 2. 前端 `src/pages/company/Users.tsx`
沿用 Celoxis 風格（圓角卡 + `company-shell`）。
- 上方搜尋框 + 「只看管理員 / 只看分析師」filter chip
- 表格欄位：頭像 + 名稱 / Email / 角色 chips / Tester / Line / Expert / 操作
- 操作：兩顆 Switch（管理員、分析師）+ Tester Switch；每個切換用 `confirm()` 二次確認、`toast` 回饋
- 自己那列：管理員 Switch 灰掉並 `PermissionTooltip("不可移除自己的管理員權限")`

### 3. 路由與側欄
- `src/App.tsx`：加 `/company/users` route，包 `<ProtectedRoute requireRole="company_admin">`
- `src/components/layouts/CompanyLayout.tsx`：sidebar 加 `{ path: '/company/users', icon: Shield, label: '帳號權限' }`，放在「分析師管理」上方

### 4. 不動的部分
- 不新增 enum 值（沿用既有 `company_admin` / `analyst`）
- 不改 RLS（所有寫入走 edge function）
- 不影響 AdminLayout 的 owner / company_admin 雙軌存取邏輯

## 檔案
- 新增：`supabase/functions/admin-manage-users/index.ts`
- 新增：`src/pages/company/Users.tsx`
- 編輯：`src/App.tsx`、`src/components/layouts/CompanyLayout.tsx`
