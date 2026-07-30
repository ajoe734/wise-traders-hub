# 03 — 硬寫死路徑的完整盤點

Type: research
Status: resolved
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

專案**沒有任何路徑常數層**（無 `routes.ts`／`paths.ts`），全部是散落的字面字串。

**1. `src/**` 共 216 處**
`/app` 56、其他未收斂家族（`/pricing` `/legal` `/holding-checkup` `/portfolio/:id` `/people/:slug` `/line/:slug/account` `/explore` `/mentor-admin`）36、`/company` 35、`/auth` 20、`/experts` 18、`/admin` 14、`/expert` 11、`/account` 10、`/checkout` 5、`/` 5、`/me` 2、`window.location.href = <變數>` 15。
熱點檔：`App.tsx`、`components/layouts/PortalLayout.tsx`、`pages/app/AppHome.tsx`、`pages/company/Dashboard.tsx`、`pages/Index.tsx`、`pages/admin/SignalEditor.tsx`。

**2. `supabase/functions/**`**
- `legendflow.tw` 字面字串 **29 處**（CORS allow-list、email from、含完整路徑的 `action_url`，如 `alerts-watchdog/index.ts:665` → `/company/alerts`、`apologize-line-free-quota/index.ts:32` → `/auth/login`）。
- `${siteUrl}/...` 拼接的前台深連結 **31 處**，散在 `admin-manage-users`、`checkup-daily-reminder-cron`、`checkup-notify-complete`、`email-push-renewal-reminder`、`line-login-callback`、`line-push-renewal-reminder`、`notify-payment-failure`、`recover-abandoned-checkout`、`recover-failed-transactions`、`share-og`、`subscribe-renew-link`、`update-analyst-credentials`。
- **已存在的既有不一致**：`email-push-renewal-reminder:193`／`line-push-renewal-reminder:206` 用 `/:slug/checkout`，但 `notify-payment-failure:164-166`／`recover-failed-transactions:150,159` 用 `/checkout/:slug/:planId`；`update-analyst-credentials:158` 用 `/reset-password`（漏 `/auth`），`admin-manage-users:358` 用 `/auth/reset-password`。
- `link_url` / `download_url` 字面字串在 functions 內 **0 命中**——欄位名需查 migrations（見票 09）。

**3. 靜態檔**
`public/robots.txt:8`（Sitemap）、`public/sitemap.xml:3-7`（`/`、`/experts`、`/pricing`、`/holding-checkup`、`/legal` 共 5 條）、`index.html:34,38,44,47-50`（og:url、og:image、twitter:image、JSON-LD）。canonical 由各 page 的 react-helmet-async 自行宣告，尚未逐頁清點。

**4. `e2e/**` 共 225 處 `page.goto`**
`/company` 34、`/e2e` harness 34、`/app` 32、`/checkout` 7、`/account` 5、`/expert` 4、`/auth` 4、`/admin` 3、其他 7、經本地常數（`ROUTE`／`HARNESS_URL`）解析 95。單檔熱點 `batch5b-react-query.spec.ts` 26 處。

**5. `openNotificationLink.ts`**
只用 `/^https?:\/\//` 判 external／internal，internal 一律直接 `navigate(link)`，**沒有路徑白名單或重寫**。程式本身不會壞，但會忠實把 DB 內的舊路徑丟出去 → 404。

**最容易斷的前五名**
1. Edge Function `${siteUrl}` 深連結（已寄出的 email／LINE 無法回收）。
2. DB 內歷史通知連結（唯一需要**資料回填 migration** 的斷點）。
3. `/account/*` ↔ `/app/account` ↔ `/me` 三軌命名，30+ 處字面值。
4. `/expert/:slug` 與 `share-og:145`／`og-card` 的社群快取與 SEO 索引。
5. `e2e/**` 130 處字面路徑，改不同步 CI 會大面積變紅。
