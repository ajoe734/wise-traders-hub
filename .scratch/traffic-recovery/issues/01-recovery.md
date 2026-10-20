# 01 — 歷史流量證據回補與固定對帳

Status: ready-for-agent
Priority: P1
Category: bug
Blocked by: None

## What to build

回補 2026/10/20 台北零時前仍有原始證據的看頁與會員連結，未知的當時登入狀態不推測；每次流量修改固定執行逐日對帳驗收。

## 驗收標準

- [ ] 原始舊版未具名且無 props 的看頁可還原；不存在的事件、其他事件、未知登入狀態不猜填。
- [ ] 有同一 visitor_id 的唯一可信會員證據才還原訪客會員連結；多會員衝突不合併。
- [ ] 重跑修復無新增重複事件，修復附來源標記與稽核。
- [ ] 全期間／每台北日／所有頁面的收集與報表口徑一致；具名看頁、內部、日期界線與匿名身分均驗收。
- [ ] 固定測試不寫正式流量；CI 每次相關修改執行。
- [ ] TDD 公開邊界已確認：有證據回補、冪等、逐日對帳一致。

## 頁面／路由清單

無新增頁面；既有 `/company/traffic` 對帳資料口徑驗證，公司管理員限定；不發布網站或改樣式，手機斷點不適用。

## 資料來源

**讀取**：traffic_events 原始 id、visitor_id、user_id、route、event_name、event_props、occurred_at、is_internal；traffic_visits；referral_attributions；conversions；既有 get_traffic_overview。正式資料僅透過受限管理工具及本人管理員讀取。

**寫入**：只修改 traffic_events 確證 legacy page_view 名稱與回補來源；traffic_visits 唯一可信會員連結；audit_logs 記前後數量。保留原 timestamp/id，無刪除、會員帳號與訂單變更、權限變更。

**衍生規則**：台北日期半開區間；user_id 連結不是當時已登入的證據；舊 visit page_views 不代表看頁次數，不能據以生成事件。

## Out of scope

遺失／已刪除事件無法還原；不補假登入紀錄、不掃描私人憑證、不自動測試真實付款；固定驗收無外部 API 或永久排程。