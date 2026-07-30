# 09 — 通知連結欄位與歷史資料盤點

Type: task
Status: open
Blocked by: None

## Question

`link_url` / `download_url` 在 `supabase/functions/**` 完全沒有命中，代表通知連結的實際欄位名
與寫入路徑尚未確認。改網址時這是**唯一需要資料回填 migration** 的斷點，必須先量出規模。

需要查明並記錄：

- 查 `supabase/migrations/**` 與 schema，確認通知資料表的連結欄位真實名稱（`link`？`action_url`？`link_url`？）。
- `openNotificationLink()` 的所有呼叫端檔案，以及它們讀的是哪個欄位。
- 對資料庫下查詢，統計既有資料中各路徑前綴（`/account`、`/app`、`/expert`、`/checkout`…）的筆數與最舊／最新時間。
- 評估：一次性 UPDATE 回填，或在 `openNotificationLink` 內加 old→new 重寫表。

## Answer

_（待執行）_
