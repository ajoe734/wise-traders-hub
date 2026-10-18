# 01 — brcto 自媒體來源與分平台看板

Status: ready-for-human
Priority: P1
Category: enhancement
Blocked by: None — can start immediately

## What to build
短網址來源在匿名訪問、註冊登入、送出付款與成交紀錄保持一致，流量看板按活動與平台拆分。

## 驗收標準
- [x] 匿名來源登入後寫入自己的歸因，保留首次來源與原始 30 天期限；重整不重複，失敗可重試。
- [x] 無平台標記顯示未標平台，不推斷成 IG；IG / FB / YouTube / LINE 分開。
- [x] 看板訪客、註冊、成交各自按日期與活動／平台統計，不複製活動總營收到每個平台；舊會員同月後來登入不算新註冊。
- [x] 模擬短網址 → 註冊 → 登入 → 訂單歸因；所有支付入口與成交來源有測試。
- [x] 1280 / 560 / 390 / 380px 無溢出，空資料與讀取失敗可辨識。
- [x] 真實註冊及付款尚未驗證：使用者選擇先完成模擬與看板。

## 頁面／路由清單
| 路由 | 新增／修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/company/traffic` | 修改 | company_admin | 新增分平台統計 |
| `/s/:slug` → `/expert/:slug` → `/auth/register` → `/auth/login` → `/checkout/:slug/:planId` | 既有流程驗證 | 公開／付款需登入 | UTM 與首次来源 |
無新增路由、不更新 sitemap；原本登入與無權限導向不變。

## 資料來源
讀取：traffic_visits（visitor_id、UTM、first_seen_at、first_landing_path；排除管理頁起始流量）、referral_attributions（會員、UTM、期限）、profiles（user_id、created_at）、conversions（訂單、UTM、金額、occurred_at）；沿用公司管理員讀取權限。
寫入：登入會員 insert 自己的 referral_attributions，沿用 RLS；結帳沿用各既有付款函式與訂單 attribution。
衍生規則：首次來源 30 天；訪客依 visitor_id 去重、註冊依 profiles.created_at 與 user_id 去重、成交依 conversions 記錄；TWD；未知平台不猜測。

## Out of scope
真實扣款、假匯款確認、正式發布、DB/RLS 變更與 utm_term 擴充。

## Evidence
`attribution-auth-backfill`、`platform-attribution`、`conversion-attribution`、`payment-attribution-dispatch`、`brcto-payment-handlers`：涵蓋匿名補寫、30天、重試、五平台、四付款入口、ACpay新訂閱／續訂與拒絕簽章、匯款成功／重複／失敗。`e2e/brcto-auth-funnel.spec.ts` 驗證五平台註冊登入下單與看板分頁、註冊／成交隔離、四尺寸、空資料、錯誤。未部署共用付款函式；正式成交仍待使用者核准部署及真人付款驗收。

最終：150項Vitest、13項E2E通過；看板501筆訪客跨頁讀回、1註冊／1成交799元隔離（全為mock，不寫正式資料）。後端HTTP handler mock 位於 `tests/brcto-payment-handlers.test.ts`，避免前台型別檢查載入Deno入口。既有 `share-short-link-redirect` 的og:image期待失敗（目前靜態og-image，而測試期待og-card）；未改SEO，短網址重導與UTM已另在五平台E2E通過。