# 01 — 歷史股價回補自動停排

Status: ready-for-human
Priority: P1
Category: enhancement
Blocked by: none（TDD 公開驗收邊界已確認）

## What to build

全市場歷史股價每小時補40檔，有待補才執行、全部完成後自動停排；後續新缺資料入列可重新喚醒，會員與專家只讀真實資料庫日線。

## 驗收標準

- [x] 每輪最多40檔，全部完成後停止既有歷史回補排程，不影響每日股價及月營收排程。
- [x] 上游額度耗盡／失敗不得標完成；待補與失敗仍可重試。
- [x] 新增需求重新喚醒，並發入列與清空不得遺失喚醒。
- [x] 全市場名錄逐檔驗證小圖所需日線，不以固定2,000或ready數字假判完成。
- [x] TDD先RED再GREEN，覆蓋排程生命周期及回補執行公開介面。
- [x] 無前台樣式變更，手機斷點不適用。

## 頁面／路由清單

無新增或修改前台路由；既有會員／專家走勢小圖與估值讀取介面沿用。排程介面：market-data-sync（cron-key）；checkup-sparkline（既有登入讀取）。sitemap不變。

## 資料來源

**讀取**：market_data_requests（symbol/state/attempts/last_attempt_at）、official_share_registry（全市場symbol）、tw_price_history（日線）、cron.job（既有排程）、system_jobs_log（執行紀錄）；依既有service_role權限。

**寫入**：market_data_requests回補狀態、tw_price_history日線、tw_month_revenue營收、system_jobs_log執行紀錄；排程生命周期只處理既有歷史回補工作，不改既有RLS／帳號權限。

**外部來源**：FinMind由排程fetchWithRetry呼叫，頁面不連外。

**衍生規則**：每小時40檔；真實日線達既有小圖可讀門檻才算可用；額度與網路錯誤保持未完成。

## Out of scope

- 正式前台發布、付款、帳號與RLS調整、偽造歷史價格。

## Comments

- 實作前依已啟用TDD要求確認公开驗收邊界。
- 2026/10/20：已部署0046及三個受共用入列介面影響的函式。140項相關測試、SQL生命周期與真雙連線並發通過；worker Deno檢查通過，共享小圖檔既有implicit-any檢查仍有技術債。
- 正式續跑40檔成功；全40檔日線與本人登入小圖接口讀回complete（至少70根），不是只看ready。1976檔中1293檔完整，683檔續補；1589／4804只有4月舊日線，重新待補，未以舊歷史假標完成。全市場完成仍待上游資料及排程續跑，不承諾日期。
- 新需求最遲下一個每小時40分啟動；有工作時每日最多24輪，清空立即移除排程。失敗退避上限24小時，不丟棄；每日行情／營收三工作hash不變。沒有前台發布、RLS變更或測試假資料寫入正式庫。