# 04 — SPA 上的 301 永久導向可行方案

Type: research
Status: resolved
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

**結論：留在 Lovable 原生託管就做不到真正的 HTTP 301。**

- Lovable 託管是黑盒 CDN，只做 SPA fallback，沒有任何 redirect/rewrite 設定管道（`_redirects`、`vercel.json`、headers API 皆無效）。官方唯一承認能做伺服器層 301 的路徑是遷出到 Vercel/Netlify/Cloudflare/自架 Nginx。
- Google 官方（Search Central「301 redirects」）把 **JavaScript `location` 重定向列為 permanent redirect 訊號**，與 301 同一類，但明列其「被正確解讀的機率最低」。權重會傳遞，但非保證、非即時。
- **GSC「變更網址工具」不適用**：官方限定用於換網域／子網域，同網域內路徑變更明確被列在「不要使用」清單。

**替代組合（可執行步驟）**

1. 建立完整 old → new 對照表，含 query string 與 hash 保留規則。
2. 舊路徑 route 以 `window.location.replace(new + location.search + location.hash)` 導向（用 `replace`，不污染歷史、語意較接近永久）。**query 與 hash 不會自動搬遷，必須手動拼接**——這是最常見的漏接點，LINE 深連結常帶 utm 與 hash。
3. 舊頁 `<head>` 放 `rel=canonical` 指向新網址；純 CSR 注入的 canonical 可靠性未經 Google 保證，能靜態化就靜態化。
4. `sitemap.xml` **只列新網址**，移除舊網址，並在 GSC 重新提交。
5. 不用換址工具，改用 URL 檢查工具對關鍵頁手動 Request Indexing 加速。
6. 舊網址導向邏輯**至少保留 6–12 個月**。
7. 監控：GSC「網頁」報表看舊 URL 轉為「已重新導向」的速度，效能報表比對新舊曝光此消彼長。
8. 對已發出的 LINE／Email 連結，實測 LINE 內建瀏覽器、Gmail App、Outlook 的實際跳轉行為。

**預期損失**：索引移轉比真 301 慢（數週起跳、可能更久），權重為部分而非全額傳遞，過渡期可能先降後回升。低階裝置或 in-app webview JS 執行失敗時使用者會卡在舊頁。

**對終點的影響**：使用者原始要求的「301 永久導向」在現有託管上不可得，需在 Ticket 06 決定是接受 client-side 替代組合，或把「遷出託管」列為前置條件。
