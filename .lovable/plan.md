

# 將 bjoe734@gmail.com 升為公司管理員

## 步驟

1. 透過 insert 工具在 `user_roles` 表插入一筆紀錄：
   ```sql
   INSERT INTO user_roles (user_id, role)
   SELECT id, 'company_admin'::app_role
   FROM auth.users
   WHERE email = 'bjoe734@gmail.com'
   ON CONFLICT (user_id, role) DO NOTHING;
   ```
2. 驗證該帳號 `user_roles` 已包含 `company_admin`

## 升級後效果

- 該帳號重新登入後，自動導向 `/company`
- 可進入所有 `/company/*` 頁面（Dashboard、Analysts、Subscribers、Revenue、Payments、Announcements、AuditLogs）
- 可進入任意 `/admin/:slug/*` 分析師後台
- RLS 開放跨分析師的全平台資料

## 注意事項

- 若 `bjoe734@gmail.com` 帳號尚未在系統註冊，將不會插入任何紀錄；需先請該使用者完成註冊後再執行
- 升級後請該使用者**登出再重新登入**，才會載入新的角色權限
- 不會影響該帳號既有的訂閱或其他權限

