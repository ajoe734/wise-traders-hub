# 讓管理者能瀏覽一般使用者頁面

## 問題定位

目前 `/app`、`/app/signals`、`/app/journals`…等路由都包了 `<ProtectedRoute subscriberOnly>`。

`src/components/ProtectedRoute.tsx` 裡 `subscriberOnly` 的邏輯會把：
- `company_admin` 強制導向 `/company`
- `analyst` 強制導向 `/admin/{slug}`

所以你用 admin 帳號點 `/app`，元件一掛載就 `<Navigate to="/company" replace />`，看起來就是「跳回 /company」。

`/free-checkup` 本身沒有 `subscriberOnly`，但首頁 `<SmartHomeRedirect>` 裡 admin 會被導去 `/company`；如果你是從 `/` 點過去的就沒問題，從導覽列直接點 `/free-checkup` 應該可進。若也有跳轉，多半是頁面內另有檢查（待調整時再看 FreeCheckup.jsx）。

## 設計決策

`subscriberOnly` 當初是為了避免 admin 在自己的後台閒晃時誤入訂戶頁（首頁時導向 dashboard）。但「admin 主動點 /app 想看訂戶視角」是合理需求，不該硬擋。

採用最小破壞性的調整：
- **保留**首頁 `SmartHomeRedirect` 對 admin/analyst 的自動導向（維持登入後直接進後台的既有體驗）。
- **移除** `ProtectedRoute` 內 `subscriberOnly` 對 admin/analyst 的強制跳轉。`subscriberOnly` 只剩「需要登入」這層意義（其實等同沒帶 requiredRole 的 ProtectedRoute），但保留旗標避免大改 App.tsx。

這樣 admin 想看訂戶視角時，直接打網址或從後台連結進 `/app` 就能看，登入後預設仍然落在 `/company`。

## 需要動的檔案

### `src/components/ProtectedRoute.tsx`
拿掉 `subscriberOnly` 區塊裡的兩個 `<Navigate>`，函式直接 fall-through 到 `return <>{children}</>`。

```tsx
// 刪除這段：
if (subscriberOnly && user) {
  if (hasRole('company_admin')) return <Navigate to="/company" replace />;
  if (hasRole('analyst') && user.expertSlug) return <Navigate to={`/admin/${user.expertSlug}`} replace />;
}
```

`subscriberOnly` 介面保留（不動 App.tsx 與既有測試呼叫點）。

### `src/test/components/ProtectedRoute.test.tsx`
兩個既有測試斷言「admin/analyst 在 subscriberOnly 時被導向後台」。改為斷言：admin/analyst 在 subscriberOnly 時 **能看到 children**，與一般使用者一致。

## 驗證方式
1. admin 帳號從 `/company` 手動輸入 `/app`、`/app/signals`、`/app/journals/...` → 應正常顯示頁面，不再彈回 `/company`。
2. admin 從 `/` 進入時仍自動到 `/company`（`SmartHomeRedirect` 行為不變）。
3. analyst 同上：可手動瀏覽 `/app/*`，登入後預設仍進 `/admin/{slug}`。
4. 跑 `bunx vitest run src/test/components/ProtectedRoute.test.tsx` 應全綠。

## 不在本次範圍
- `/free-checkup` 若仍有跳轉，請回報實際路徑與時機，再單獨追 FreeCheckup.jsx 內部 effect（目前路由本身無 guard）。
