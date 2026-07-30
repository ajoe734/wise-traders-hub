# 03 — 身分驗證：Email 與 LINE 登入隔離

**What to build:** 使用者能以 Email 註冊／登入／忘記密碼重設，或以 LINE 登入；兩種身分完全隔離（LINE 使用虛擬信箱 `line_{ID}@line.local`），同一人用不同管道登入不會互相汙染資料，登入後導回原本想去的頁面。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Email 註冊／登入／忘記密碼／重設密碼四條路徑可完成
- [ ] LINE callback 成功建立 session，並與 Email 帳號互不合併
- [ ] OAuth redirect 為同源公開網址，登入後才導向受保護頁
- [ ] 未登入存取受保護路由會被導向登入並保留 return path
- [ ] 洩漏密碼保護（HIBP）維持開啟
