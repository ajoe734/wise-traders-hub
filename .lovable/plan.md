## 問題

`/company/subscribers` 與 `/admin/subscribers/:slug` 只顯示 `profiles.display_name`（如 Ray、tsai），看不出帳號是誰、用 Email 還是 Line 登入，公司對帳無法處理。

`email` 存在 `auth.users`，前端拿不到 → 需要透過 service role edge function 取得。

## 方案

### 1. 後端：擴充 `supabase/functions/admin-manage-users/index.ts`

新增 `action: 'lookup_identities'`：

- Input: `{ user_ids: string[] }`（最多 500 個）
- 權限：沿用既有 `company_admin` 檢查
- 動作：
  - `profiles` 撈 `user_id, display_name, line_user_id`
  - `supabase.auth.admin.listUsers()` 後以 Map 對應 email
  - 判斷登入方式：`line_user_id` 不為空 → `'line'`；否則 → `'email'`
- Output:
  ```
  { identities: [{ user_id, display_name, email, login_method, line_user_id }] }
  ```

不寫 RLS、不改 schema。

### 2. 前端共用 hook：`src/hooks/useUserIdentities.ts`（新增）

- 接收 `userIds: string[]`
- React Query：`['user-identities', sortedIds.join(',')]`，`staleTime: 60s`
- 呼叫 `admin-manage-users` lookup_identities
- 回傳 `Record<user_id, Identity>`

### 3. 修改 `src/pages/company/Subscribers.tsx`

- 移除目前用 `profiles` 自己查 display_name 的程式碼
- 改用 `useUserIdentities(userIds)`
- 訂閱者欄位改為兩行顯示：
  ```
  [Email] 海洋福星
  bjoe734@gmail.com · a1b2c3d4
  ```
  或
  ```
  [Line] Ray
  Uab10de · a1b2c3d4
  ```
  - 第一行：`badge(login_method) + display_name`
  - 第二行：`email`（Email 帳號）或 `line_user_id 末 6 碼`（Line 帳號）+ `user_id 末 8 碼`（淺色 muted）
- 搜尋欄涵蓋：email、line_user_id、display_name、user_id 末碼
- CSV 匯出新增三欄：`登入方式`、`Email`、`Line ID 末段`

### 4. 修改 `src/pages/admin/Subscribers.tsx`（分析師後台）

同樣換成 `useUserIdentities`，「姓名」欄一樣兩行顯示。分析師也應該看得到訂閱者怎麼聯絡。

### 5. Badge 樣式

- Email badge：`variant="outline"` + 淺灰
- Line badge：`bg-[#06C755]/10 text-[#06C755]` 沿用 Line 綠

## 技術細節

- `auth.admin.listUsers()` 預設 50 筆 / page。Lookup function 內要分頁直到撈完，或只撈 `perPage=1000` 一頁（目前用戶量遠低於此）
- `lookup_identities` 不寫 audit log（純讀取）
- Edge function 已 `verify_jwt = true` (預設) + `company_admin` 檢查，不額外設定
- 不修改 `useMemberSubscriptions` / `useSubscriptions`（會員端 hooks 不需要 identity 資訊）

## 不做的事

- 不合併 Email / Line 帳號（違反 identity isolation 鐵則）
- 不在會員端任何頁面顯示其他用戶 email
- 不改 schema、不改 RLS
