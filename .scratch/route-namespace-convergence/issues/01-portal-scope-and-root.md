# 01 — /portal 的邊界與首頁歸屬

Type: grilling
Status: open
Blocked by: None

## Question

哪些路由屬於 `/portal/*`，以及網站根目錄 `/` 要如何處理？

需要定案：

- `/` 保持為首頁（`SmartHomeRedirect` + `Index`），或 301 到 `/portal`？
- `/experts`、`/expert/:slug`、`/s/:slug`、`/plan/:slug/:planId`、`/pricing`、`/legal`、
  `/data-sources`、`/holding-checkup`、`/holding-checkup-demo` 各自的新網址。
- 未登入結帳路徑 `/checkout/:slug/:planId`、`/checkout/checkup/:planId` 屬 portal 還是獨立。
- canonical 要指向新網址還是舊網址（已答：舊網址可變更、需 301，所以 canonical 應為新網址——需確認 SEO 風險承受度）。
