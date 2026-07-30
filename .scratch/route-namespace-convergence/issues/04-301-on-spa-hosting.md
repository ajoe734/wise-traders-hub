# 04 — SPA 上的 301 永久導向可行方案

Type: research
Status: open
Blocked by: None

## Question

本專案是 Lovable 託管的 classic Vite SPA，沒有伺服器端 redirect 設定（`_redirects`、
`vercel.json` 等皆無效）。在此前提下，「301 永久導向」實際上能做到什麼程度？

需要查明：

- Lovable 託管是否提供任何 HTTP 層導向能力，或只能靠 client-side `<Navigate replace>`（等同 302/JS 導向）。
- Google 對 JS client-side redirect 的處理方式與排名傳遞效果，以及 canonical 能補上多少。
- 若無法真 301，替代組合（canonical 指新網址 + client redirect + sitemap 只列新網址 + GSC 變更工具）的完整程序。
- 已發出的 LINE／Email 連結在 client redirect 下的行為（含深連結參數保留）。

## Answer

_（待 research subagent 填寫）_
