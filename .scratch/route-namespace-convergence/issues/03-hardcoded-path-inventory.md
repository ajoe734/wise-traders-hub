# 03 — 硬寫死路徑的完整盤點

Type: research
Status: open
Blocked by: None

## Question

專案中有哪些地方把前台網址寫死，改網址時會一起斷？必須窮舉，不得抽樣。

至少需涵蓋：

- `src/**` 內所有 `to=`、`navigate(`、`href=`、`window.location` 的內部路徑字面值。
- `supabase/functions/**` 內產生的通知 `link_url`、`download_url`、LINE push 訊息、Email 模板連結。
- `public/sitemap.xml`、`public/robots.txt`、`index.html` canonical / og:url。
- `e2e/**` 測試中的 `page.goto` 路徑。
- 資料庫既有資料：`notifications.link_url` 等欄位已寫入的舊路徑數量與分佈。
- 分享／短網址（`/s/:slug`）與 QR 相關產物。

## Answer

_（待 research subagent 填寫）_
