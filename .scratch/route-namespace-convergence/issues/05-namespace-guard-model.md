# 05 — 命名空間層級的 guard 模型

Type: grilling
Status: open
Blocked by: 02

## Question

四個命名空間的准入守衛要長什麼樣？

現況是每條路由各自包一層 `<ProtectedRoute>`（`subscriberOnly` / `requiredRole`），
共數十處重複。收斂後應改為 layout route 一次套用。

需要定案：

- 是否改用 React Router layout route（`<Route element={<RequireSubscriber/>}>` 包一整段）。
- `/portal` 是否需要「已登入且已訂閱者自動彈到 /app」的反向守衛（現有 `SmartHomeRedirect` 行為）。
- View-as 視角檢視模式在新 guard 下的行為（唯讀模擬不得被 subscriberOnly 擋掉）。
- guard 失敗時的落地：導 `/auth/login?next=`，並確認 `next` 一律為 same-origin 相對路徑。
