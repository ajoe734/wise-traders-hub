# 修正分析師頭像上傳失敗

## 根因

`avatars` bucket 的 storage RLS policy（INSERT/UPDATE/DELETE）要求：

```
(storage.foldername(name))[1] = auth.uid()::text
```

也就是檔案路徑**第一層資料夾必須是登入者的 user_id**。

但 `src/pages/admin/Profile.tsx` 第 93 行硬寫：

```ts
const path = `avatars/${expert.id}.${ext}`;
```

第一層變成字串 `"avatars"`，而且就算改成 `expert.id`，那是 expert 的 id 不是 user id —— 兩者都不等於 `auth.uid()`，所以 Supabase 直接擋下並回 `new row violates row-level security policy`。

對照可用的範例 `src/pages/account/Profile.tsx:37`：`${user.id}/avatar.${ext}` —— 一般使用者頭像之所以正常，就是因為符合這個規則。

## 修法

**只改一支檔案**：`src/pages/admin/Profile.tsx` 的 `handleAvatarUpload`

1. 從 `useAuth()`（或現有的 user 來源）取出 `user.id`
2. 上傳路徑改為：`${user.id}/expert-${expert.id}.${ext}`
   - 第一層 = `user.id` → 通過 RLS
   - 第二層保留 expert.id 以避免一個 user 擁有多個 expert 時互相覆蓋（雖目前 1:1，先預留）
3. `getPublicUrl` 用同一條 path
4. 加 cache-busting：`?t=${Date.now()}`（與 account/Profile.tsx 一致），避免 CDN 舊圖
5. `experts.avatar_url` 一樣 update 進去

## 影響範圍

- 既有 `avatars/<expert_id>.xxx` 舊檔案（如果有）會孤立在 bucket 裡，不影響顯示（RLS 只擋 write，public read 仍可）。不主動清理。
- 不需要動 storage policy、不需要 migration、不影響一般使用者頭貼上傳。

## 驗證

1. 用分析師帳號到 `/admin/profile` 上傳一張頭像 → 不再出現 RLS 錯誤、頭像即時更新。
2. 一般使用者 `/account/profile` 上傳照舊正常（未改動）。
