# 01 — 歷史流量證據回補與固定對帳

Status: ready-for-human
Priority: P1
Category: bug
Blocked by: None

## What to build

回補 2026/10/20 台北零時前仍有原始證據的看頁與會員連結，未知的當時登入狀態不推測；每次流量修改固定執行逐日對帳驗收。

## 驗收標準

- [x] 原始舊版未具名且無 props 的看頁可還原；不存在的事件、其他事件、未知登入狀態不猜填。
- [x] 有同一 visitor_id 的唯一可信會員證據才還原訪客會員連結；多會員衝突不合併。
- [x] 重跑修復無新增重複事件，修復附來源標記與稽核。
- [x] 全期間／每台北日／所有頁面的收集與報表口徑一致；具名看頁、內部、日期界線與匿名身分均驗收。
- [x] 固定測試不寫正式流量；CI 每次相關修改執行。
- [x] TDD 公開邊界已確認：有證據回補、冪等、逐日對帳一致。

## 頁面／路由清單

無新增頁面；既有 `/company/traffic` 對帳資料口徑驗證，公司管理員限定；不發布網站或改樣式，手機斷點不適用。

## 資料來源

**讀取**：traffic_events 原始 id、visitor_id、user_id、route、event_name、event_props、occurred_at、is_internal；traffic_visits；referral_attributions；conversions；既有 get_traffic_overview。正式資料僅透過受限管理工具及本人管理員讀取。

**寫入**：只修改 traffic_events 確證 legacy page_view 名稱與回補來源；traffic_visits 唯一可信會員連結；audit_logs 記前後數量。保留原 timestamp/id，無刪除、會員帳號與訂單變更、權限變更。

**衍生規則**：台北日期半開區間；user_id 連結不是當時已登入的證據；舊 visit page_views 不代表看頁次數，不能據以生成事件。

## Out of scope

遺失／已刪除事件無法還原；不補假登入紀錄、不掃描私人憑證、不自動測試真實付款；固定驗收無外部 API 或永久排程。

## 驗收結果（2026/10/20）

- 原地還原 681,407 筆；10 批 audit 的 rows 合計一致，符合 legacy 條件的未具名紀錄讀回為 0。沒有新增事件、沒有更動原始時間／事件身分。
- 5 筆唯一可信會員連結逐筆 audit，全部讀回一致。全歷史具名非內部 page_view 的 event user_id 非空筆數為 0；無法還原「當時已登入」，保留未知，不拿會員連結冒充。
- 本人管理員真實登入 `/company/traffic`。2026/05/28–2026/10/19 共 145 日（含零流量日期），1,491 個日期／路徑桶，768,809 次看頁；原始聚合與報表全部一致。對逾時日完整逐時讀回後合計，不抽樣、不漏頁；所有歷史路徑 logged_in_visitors 均為 0，與原始事件證據一致。
- `src/test/fixtures/traffic-recovery-20261020.aggregate.json` 只有日期、路徑、計數，不含會員／訪客識別；固定 gate 驗數值、重複桶、遺漏零流量日。
- RED→GREEN：未具名事件不算看頁；活動同名不同來源營收 200≠100，修為完整 campaign/source/medium 證據鍵。visitor_id 資料庫唯一約束防止同一訪客多桶；註冊事件去重，不把連結當註冊。
- `bun run check:traffic`：13 檔 109 項、實際 migration SQL、全期間 snapshot 全通過。完整回歸：383 檔，4,324 通過／9 跳過，RESULT PASS。最新預覽 build OK。
- migrations 0047–0058 已作用於共享資料庫，因此正式流量報表讀取也受影響；未發布前台、未改權限／RLS／訂單／金融資料。

## 尚未解除的限制

部分高流量日整日 RPC 仍有 statement timeout；逐時驗收完成只證明數值對帳，不等於整日／長期間看板效能已修好。此效能問題須另行診斷，不宣稱完全解決。