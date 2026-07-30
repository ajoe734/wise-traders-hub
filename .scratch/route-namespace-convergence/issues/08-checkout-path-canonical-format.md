# 08 — checkout 路徑的唯一正確格式

Type: grilling
Status: open
Blocked by: 01

## Question

結帳路徑目前有三種寫法並存，收斂前必須先定一個唯一格式。

現況（票 03 查出）：

- 前端路由：`/checkout/:slug/:planId`（正式）＋ `/:slug/checkout`（`LegacyCheckoutRedirect`）
- `email-push-renewal-reminder:193`、`line-push-renewal-reminder:206`、
  `recover-abandoned-checkout:152`、`subscribe-renew-link:137` 用 `${siteUrl}/${slug}/checkout?plan=...`
- `notify-payment-failure:164-166`、`recover-failed-transactions:150,159` 用 `/checkout/:slug/:planId`
- 健檢結帳另有 `/checkout/checkup/:planId` 與 `${siteUrl}/checkup/checkout?plan=...` 兩種

需要定案：唯一格式、query 參數規範（`plan=` vs path param）、以及舊格式的相容期。
同時要決定 Edge Function 端是否建立共用的路徑產生器，避免再次各寫各的。
