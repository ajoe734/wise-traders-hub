# 01 — 週記持股時間軸與會員持股總覽

Status: ready-for-agent
Priority: P1
Category: feature
Blocked by: None — can start immediately

## What to build

訂閱會員可在週記查看每次買進、加碼、減碼與賣出的數量及成交價，並在專屬總覽按老師、幣別、產業和持倉比例檢視目前持股。

## 驗收標準

<!-- 可驗證的行為，每條都要能被人或測試判定過／不過；避免「優化」「改善」這種無法判定的字眼 -->

- [ ] 有效訂閱會員在週記看到不可改寫、按時間排序的持股交易變化。
- [ ] 會員只看到仍有效訂閱老師的事件與目前持股，未訂閱與投影未通過時不顯示數字。
- [ ] 無持股、無歷史、缺價、讀取失敗與部分老師失敗都有獨立畫面。
- [ ] 手機（560 / 390 / 380px）版面正常，無溢出
- [ ] 既有測試全綠，並新增單元、資料庫與 e2e 測試涵蓋上述行為

## 頁面／路由清單

<!-- 每一條新增或修改的路由都要列；沒有新路由就寫「無」並說明掛在哪個既有頁面 -->

| 路由 | 新增／修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/app/holdings` | 新增 | `subscriberOnly` | 全部已訂閱老師與單一老師持股總覽 |
| `/app/journal/:id` | 修改 | `subscriberOnly` | 目前持股下方加入交易變化時間軸 |
| `/company/data-source-health` | 修改 | `requiredRole=company_admin` | 區分內部分配與上游觀測額度 |

深連結與導向：

- 進入點：會員首頁、週記頁。
- 失敗導向：沿用 `ProtectedRoute` 登入與訂閱者准入。
- 是否需要更新 `public/sitemap.xml`：否，會員專屬頁不收錄。

## 資料來源

<!-- 讀寫的每一個來源都要列，含權限。禁止只寫「從後端拿」 -->

**讀取**

| 來源 | 型別 | 欄位／回傳 | 權限 |
| --- | --- | --- | --- |
| `position_events` | 資料表 | 老師、股票、動作、數量差、變動後數量、成交價、時間 | RLS：有效訂閱／老師本人／管理員／tester |
| `get_expert_capital_status` | RPC | 目前未平倉持股 | security definer + 前台投影 gate |
| `stock_industry_map` | 資料表 | symbol、industries | 既有唯讀政策 |
| `finmind_quota_pools` / `finmind_upstream_quota` | 資料表 | 內部分配與上游觀測 | 管理員頁唯讀 |

**寫入**

| 來源 | 動作 | 權限與稽核 |
| --- | --- | --- |
| `position_events` | 由訊號觸發器 insert | service-side；拒絕 update/delete；來源訊號唯一鍵去重 |
| `finmind_quota_pools` | interactive 額度更新 | company_admin RPC／受控資料操作 |

**衍生規則**

- 單位：事件保存 base quantity；顯示時沿用 `resolvePositionQuantityDisplay`。
- 幣別：依老師／持股資料的 TWD 或 USD；跨老師先分幣別，不換匯。
- 價格權威：目前持股沿用 `useExpertHoldingsBundle`，事件價格為發布訊號成交價。
- 快取與更新頻率：React Query 30 秒；Realtime 在交易與事件寫入後失效重抓。

## Out of scope

- 不建立週記發布快照；不混加不同幣別；不讓前端直接呼叫 FinMind。

## Comments

2026/10/06：使用者確認跨老師依幣別分組，FinMind interactive 每日額度為 1,000。
