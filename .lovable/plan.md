## 目標

把「帳號權限管理」頁面 (`/company/users`) 擴充成完整的帳號管理中心，管理員能對所有使用者執行：指派/移除角色、停權/解除、重設密碼、編輯顯示名稱與 expert_slug、刪除帳號。

## 後端：擴充 `admin-manage-users` edge function

在現有 `list / set_role / set_tester` 之外新增以下 actions（皆需 `company_admin`，皆寫入 `audit_logs`）：

1. **`set_banned`** — `{ user_id, banned: boolean }`
   - 用 `admin.auth.admin.updateUserById(user_id, { ban_duration: banned ? '876000h' : 'none' })` (~100 年 = 永久停權)
   - 自我保護：不能停權自己
2. **`send_password_reset`** — `{ user_id }`
   - 取得 email 後呼叫 `admin.auth.admin.generateLink({ type: 'recovery', email })`
   - 透過 Resend (已設定 `RESEND_API_KEY`) 寄送重設連結，主旨「重設您的密碼」
   - Line 虛擬信箱 (`*@line.local`) 拒絕並回傳 `line_account_no_email`
3. **`update_profile`** — `{ user_id, display_name?, expert_slug? }`
   - 用 service role 更新 `profiles`（繞過 `protect_profile_fields` trigger）
   - `expert_slug` 需檢查唯一性
4. **`delete_user`** — `{ user_id }`
   - 自我保護 + last-admin 保護
   - 呼叫 `admin.auth.admin.deleteUser(user_id)`，CASCADE 會清掉 profiles / user_roles / 訂閱

每個 action 都記 `audit_logs`：`account.ban / account.unban / account.password_reset / account.update_profile / account.delete`。

## 前端：改寫 `src/pages/company/Users.tsx`

擴充 `UserRow` 介面新增 `banned_until: string | null`。Edge function 的 `list` 回傳裡用 `usersList?.users` 內的 `banned_until` 欄位帶出。

UI 改動：
- 表格新增「狀態」欄（顯示 `已停權` badge）
- 每列右側新增「⋯」操作選單（DropdownMenu），包含：
  - 編輯資料（開 Dialog 編輯 `display_name` 與 `expert_slug`）
  - 寄送密碼重設信
  - 停權／解除停權（toggle）
  - 刪除帳號（紅色，二次確認 Dialog 需輸入 email 確認）
- 既有的 管理員 / 分析師 / Tester Switch 欄位保留
- 篩選列加入 `已停權` 篩選

所有操作沿用既有 `callAction` helper，操作後 `await load()` 重整。

## 技術細節

- 寄信走現有 Resend 模板樣式（參考 `infrastructure/email-notifications-resend` 記憶）。寄件來源沿用專案 `noreply@legendflow.tw`（若已驗證），主旨與內容用繁體中文，連結為 `generateLink` 回傳的 `action_link`，附 60 分鐘有效期說明。
- Ban 機制使用 Supabase Auth 內建 `ban_duration`，`'none'` 解除、`'876000h'` 永久。前端判斷 `banned_until && new Date(banned_until) > new Date()` 視為停權中。
- 刪除使用者前，UI 需強制使用者輸入該帳號 email 字串才能啟用「確認刪除」按鈕，避免誤刪。
- `expert_slug` 衝突直接由 DB unique constraint（若存在）擋下；edge function 將錯誤訊息原樣回傳，前端 toast 顯示。
- 不修改任何 RLS 或 DB schema；全部走 service role edge function。

## 檔案

- `supabase/functions/admin-manage-users/index.ts` — 新增 4 個 action + list 回傳 banned_until
- `src/pages/company/Users.tsx` — 表格欄位、DropdownMenu、編輯/刪除 Dialog
