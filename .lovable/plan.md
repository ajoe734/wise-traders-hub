## 問題
`bjoe734@gmail.com` 後端 user_roles 確認有 `company_admin`，但進 `/company` 會閃一下「權限不足」才跳進後台。

## 根因
`src/contexts/AuthContext.tsx`：
- `hasRole` 用 `useCallback(..., [])` 包，讀 `userRef.current`（line 253）。
- `userRef` 在 `useEffect` 中跟著 `user` 同步（line 250），永遠**比 state 慢一個 render**。
- 所以 `user` 第一次被 set 成有 roles 的物件那個 render，`ProtectedRoute` 呼叫 `hasRole('company_admin')` 還是讀到舊 ref → false → 顯示「權限不足」。要等下一次任何 state 變動觸發 re-render，ref 才對。

## 修法（單一檔案）

**`src/contexts/AuthContext.tsx`**
- 把 `hasRole` 從「讀 ref」改成「讀 state」：
  ```ts
  const hasRole = useCallback(
    (role: AppRole) => user?.roles.includes(role) ?? false,
    [user],
  );
  ```
- 這樣 `user` state 一更新，`hasRole` 同一個 render 就回正確結果。
- `AuthActionsContext` 的 value 會因此在 user 變動時換 identity；可接受（每次登入/角色變動才會重 render action consumer，不會在 token refresh 抖動，因為 token refresh 走 `isSameUser && isTokenRefresh` 早 return，不動 `user`）。

## 不動的東西
- `ProtectedRoute.tsx` 保持原樣。
- `user_roles` 資料、RLS、SmartHomeRedirect 都不需要碰。

## 驗證
1. 登出再用 `bjoe734@gmail.com` 登入 → 直接打 `/company`，不應再看到「權限不足」閃一下。
2. 一般 subscriber 帳號進 `/company` → 應持續顯示「權限不足」（不會誤放行）。
3. Token refresh（停留 ~1 小時）不應觸發整頁重 render。
