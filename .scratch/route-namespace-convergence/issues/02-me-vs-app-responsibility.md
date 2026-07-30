# 02 — /me 與 /app 的職責切分

Type: grilling
Status: open
Blocked by: 01

## Question

「個人帳號」與「訂閱者產品區」的界線畫在哪？

需要定案：

- 現有 `/account/profile`、`/account/notifications`、`/account/remittance`、
  `/app/account`、`/app/subscriptions` 分別落在 `/me/*` 還是 `/app/*`。
- `/me` 目前是導向 `/app/account` 的 legacy 別名；反轉方向後 `/app/account` 的處置。
- `/me/*` 的准入條件：只要登入即可，還是仍需 `subscriberOnly`？（影響未訂閱者能否管理匯款單）
- 未訂閱但有待付匯款單的使用者，登入後預設落地頁是哪一個命名空間。
