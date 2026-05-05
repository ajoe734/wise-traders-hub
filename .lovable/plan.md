## 問題

分析師後台「更換頭像」按下去後出現：
`上傳失敗：new row violates row-level security policy`

## 根因（已查證）

1. **`upsert: true` 觸發 Storage 的 SELECT/UPDATE 權限檢查**
   目前 avatars bucket 只設了「以 `auth.uid()` 為第一層資料夾」的 INSERT / UPDATE / DELETE policy。
   一旦檔案已存在，`upload(..., { upsert: true })` 內部會走 update 路徑，必須同時通過 SELECT + UPDATE policy；目前沒有對應的 SELECT policy（只有 public read），在某些 storage server 版本下會直接被擋成 RLS 違規。
   這是這次最直接的觸發點。

2. **檔名固定 → 每次都踩 upsert**
   admin 頁的路徑是 `${user.id}/expert-${expert.id}.${ext}`，副檔名相同就一定撞檔，永遠走 overwrite。

3. **頭像來源分裂成兩套**
   - `src/pages/admin/Profile.tsx` → 寫入 `experts.avatar_url`
   - `src/pages/account/Profile.tsx` → 寫入 `profiles.avatar_url`
   兩邊都用 `upsert: true`，同一個問題會在帳號頁也復發。

4. **company_admin 代編輯分析師頭像時，路徑用 `user.id`**
   admin 把檔案放到「自己 uid 的資料夾」，但要更新的是別人的 `experts.avatar_url`。policy 雖然會通過（自己資料夾），但語意上是壞的，後續清理也會混亂。

## 修法

### A. 統一上傳流程（admin + account 兩個頁面）

改寫 `handleAvatarUpload`：

1. 檔案前置檢查：`image/*`、≤ 5MB
2. **不再用 `upsert: true`**，改成唯一檔名：
   `${user.id}/${Date.now()}-${random}.${ext}`
3. 上傳成功後：
   - admin 頁：`UPDATE experts SET avatar_url = ... WHERE id = expert.id`
   - account 頁：`UPDATE profiles SET avatar_url = ... WHERE user_id = user.id`
4. 上傳成功後嘗試刪除舊檔（best-effort，失敗不擋流程）
5. 錯誤分階段顯示：「上傳檔案失敗 / 更新資料失敗」分開提示
6. 完成後刷新本地狀態 / `refreshProfile()`

### B. 補齊 avatars bucket 的 Storage 權限

新增 migration，把 avatars policy 補完整、語意明確：

- **SELECT**：保留 public read（bucket 本來就 public）
- **INSERT / UPDATE / DELETE (owner)**：第一層資料夾 = `auth.uid()`
- **INSERT / UPDATE / DELETE (admin)**：`has_role(auth.uid(), 'company_admin')` → 可上傳到任意 expert 的資料夾
- 寫法用 `DROP POLICY IF EXISTS` + `CREATE POLICY`，不影響現有資料

這樣 upsert 就算被某些客戶端用到，也不會再因為缺 SELECT/UPDATE policy 噴 RLS。

### C. company_admin 代編輯時，檔案路徑改用 expert 的 user_id

admin 頁裡判斷：
- 若 `isOwner` → 路徑 `${user.id}/...`
- 若 `isCompanyAdmin && !isOwner` → 路徑 `${expert.user_id}/...`
（B 補的 admin policy 會允許這個路徑）

這樣每位分析師的頭像永遠在自己 uid 的資料夾下，乾淨、可追蹤。

### D. 驗證清單（按最高行為準則窮舉，不挑樣本）

修完後逐項驗證：

1. 分析師本人首次上傳 PNG
2. 分析師本人再次上傳同一張（測試「同 uid、不同檔名」流程）
3. 分析師本人改傳 JPG（換副檔名）
4. 檔案 > 5MB → 顯示大小錯誤
5. 非圖片檔 → 顯示類型錯誤
6. company_admin 代某位分析師上傳頭像 → 寫入該分析師的 `experts.avatar_url`
7. 上傳成功後 admin 頁頭像即時更新
8. 公開分析師頁 (`/experts/:slug`) 顯示新頭像
9. 帳號頁 `account/Profile.tsx` 上傳頭像 → 同樣不再噴 RLS
10. 帳號頁上傳後 AppHome / 各處顯示 avatarUrl 同步
11. Console 無 storage 403 / RLS 錯誤

## 涉及檔案

- `src/pages/admin/Profile.tsx` — 重寫 `handleAvatarUpload`
- `src/pages/account/Profile.tsx` — 重寫 `handleAvatarUpload`
- `supabase/migrations/<new>.sql` — 補 avatars bucket 完整 policy（含 admin 例外）

不動：`profileFieldGuard.ts`、AuthContext、其他 avatar 顯示端。

## 不會碰的範圍

- `signal-media` bucket policy（與本問題無關）
- `profiles` 其他欄位防呆 trigger
- 任何 expert KPI / billing / checkup 邏輯