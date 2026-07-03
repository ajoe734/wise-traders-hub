修正計畫：

1. **補相容舊網址**
   - 在路由新增 legacy handler，支援使用者現在開到的：
     - `/:slug/checkout?plan=<planId>&cycle=<cycle>&utm_source=account_banner...`
   - 若 query 有 `plan`，自動導到正確 checkout：
     - `/app/checkout/:slug/:planId?cycle=<cycle>&utm_source=...&utm_campaign=...`
   - 若缺少 `plan`，導回 `/app/account`，避免再進 404。

2. **修掉帳戶頁剩餘舊入口**
   - `src/pages/_appAccount/SubscriptionCard.tsx` 的「立即續訂」目前仍是舊格式 `/:slug/checkout?plan=...`，改成 `/app/checkout/:slug/:planId?...`。
   - 檢查同類 account renewal / resume payment 入口，避免還有舊格式產生 404。

3. **補 E2E 回歸**
   - 加測：直接開你貼的 legacy URL 會被導到 `/app/checkout/sharkgu/ab1d8e55-290b-43a8-8cbb-b94dcc937200?...`，不會 404。
   - 加測：帳戶頁「立即續訂」連結 href 不再使用 `/:slug/checkout?plan=`，而是 `/app/checkout/`。

4. **驗證**
   - 跑相關 checkout / renewal E2E，確認新舊網址都能到正確結帳頁。