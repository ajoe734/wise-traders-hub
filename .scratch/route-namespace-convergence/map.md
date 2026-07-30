# Map: 四命名空間路由收斂（/portal、/auth、/me、/app）

Label: wayfinder:map

## Destination

把目前散落的前台網址收斂成四個命名空間並實際落地：

- `/portal/*` — 未登入可見的公開探索與行銷頁（首頁、專家、方案、定價、法遵、免費健檢）
- `/auth/*` — 登入／註冊／LINE callback／密碼流程（已成形，只需納入統一模型）
- `/me/*` — 已登入的「個人帳號」區（個資、通知、匯款單、訂閱管理）
- `/app/*` — 已訂閱者的產品區（訊號、週記、持倉看板、探索、結帳）

舊網址（`/experts`、`/expert/:slug`、`/account/*`、`/me`、部分 `/app/*`）一律改為
**301 永久導向**至新網址；SEO canonical 與已發出的通知／LINE 連結不得斷。
`/company/*` 與 `/admin/*` 不在此次收斂範圍。

終點達成 = 一份確定的路由／守衛／導向規格 + 依賴排序的實作票，交付給實作 session。

## Notes

- Domain：single-context，見 `AGENTS.md`、`CONTEXT.md`（若存在）。
- 每個 session 應參考的 skills：`/grilling`、`/domain-modeling`、`/codebase-design`（層級 route guard 設計）、`/research`。
- 專案為 classic Vite SPA，**沒有伺服器端 301 能力**，這是本圖最大的未知數之一。
- 站內既有 `.scratch/mvp-baseline/` 13 張 MVP 票；本圖不取代它，但 Ticket 01（模組邊界）會與此收斂互相影響。
- 本圖是**規劃**：產出決策，不產出實作。

## Decisions so far

<!-- 一行一個已結票 -->

- [03 — 硬寫死路徑的完整盤點](issues/03-hardcoded-path-inventory.md) — 無路徑常數層；src 216 處、Edge Function 31 條深連結 + 29 處 legendflow.tw、e2e 225 處 goto；最痛點是已寄出的通知連結與 DB 歷史資料。
- [04 — SPA 上的 301 可行方案](issues/04-301-on-spa-hosting.md) — **Lovable 託管做不到真 301**；只能 client-side `location.replace` + canonical + sitemap 只列新網址 + 舊址保留 6–12 個月，權重為部分傳遞。

## Not yet specified

- 各 page 以 react-helmet-async 宣告的 canonical 尚未逐頁清點（`grep -rn "canonical" src/`），影響票 07 的 canonical 規則。
- `window.location.href = <變數>` 15 處的來源 Edge Function 回傳格式是否含本站路徑，尚待追蹤。
- `/portfolio/:id`、`/overview`、`/people/:slug`、`/line/:slug/account`、`/mentor-admin/*` 這批命名空間外飛地的歸屬。
- 是否要建立共用路徑常數層（前端 `src/lib/routes.ts` + Edge Function 端共用產生器），這會決定未來改址成本；等票 08 對 checkout 格式定案後一併看。
- `/app/*` 內部是否再分層（`/app/read/*` 訂閱閱讀 vs `/app/tools/*` 持倉工具）——等 `/me` 與 `/app` 職責切分決定後才看得清。
- 站內導覽元件（Header/BottomNav/Sidebar）如何隨命名空間切換 layout；等 guard 模型定案。
- `e2e/*` 與 `/e2e/*` harness 路由是否也搬到 `/portal` 外的獨立命名空間。
- sitemap.xml / robots.txt 的重寫策略，等 301 手段確定。
- 遷移期間 analytics 事件（`trackRaw` 路徑欄位）是否需要 old→new 對照表。

## 終點風險（04 揭露）

使用者原始要求的「301 永久導向」在現有 Lovable 託管上**不可得**。票 06 必須在
「接受 client-side 替代組合」與「把遷出託管列為前置條件」之間擇一，否則終點條件無法滿足。

## Out of scope

- `/company/*` 管理後台與 `/admin/:expertSlug/*` 專家後台的網址整併。
- 任何 UI 視覺改版；此圖只處理網址、守衛與導向。
