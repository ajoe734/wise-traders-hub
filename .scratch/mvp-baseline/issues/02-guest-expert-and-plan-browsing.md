# 02 — 訪客瀏覽專家與方案

**What to build:** 未登入訪客能從首頁進入專家列表，開啟任一專家頁看到身分（導師／分析師）、績效摘要與可購買方案，再進到方案詳情頁看到價格、期間與權益說明，並看到清楚的下一步（登入／結帳）入口。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `/experts`、`/expert/:slug`、`/plan/:slug/:planId` 皆可匿名瀏覽且無 RLS 錯誤
- [ ] 專家角色配色符合規範（導師藍、分析師 primary）
- [ ] 績效數字走單一資料源（`useExpertHoldingsBundle`），未公開專家不外洩
- [ ] 每頁具備 SEO title/description、單一 H1、canonical
- [ ] 短網址 `/s/:slug` 與 legacy 導向仍正確
