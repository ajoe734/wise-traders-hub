# 01 — 歷史股價回補自動停排

Status: needs-info
Priority: P1
Category: enhancement
Blocked by: TDD 公開驗收邊界確認

## What to build

全市場歷史股價每小時補40檔，有待補才執行、全部完成後自動停排；後續新缺資料入列可重新喚醒，會員與專家只讀真實資料庫日線。

## 驗收標準

- [ ] 每輪最多40檔，全部完成後停止既有歷史回補排程，不影響每日股價及月營收排程。
- [ ] 上游額度耗盡／失敗不得標完成；待補與失敗仍可重試。
- [ ] 新增需求重新喚醒，並發入列與清空不得遺失喚醒。
- [ ] 全市場名錄逐檔驗證小圖所需日線，不以固定2,000或ready數字假判完成。
- [ ] TDD先RED再GREEN，覆蓋排程生命周期及回補執行公開介面。
- [ ] 無前台樣式變更，手機斷點不適用。

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