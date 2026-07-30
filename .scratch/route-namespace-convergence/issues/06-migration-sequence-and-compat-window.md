# 06 — 遷移順序與相容期

Type: grilling
Status: open
Blocked by: 03, 04

## Question

舊網址要以什麼節奏退場？

需要定案：

- expand–contract 的批次切法：先新增新網址（雙活）→ 逐批改內部連結 → 最後只留導向。
- 舊網址別名保留多久（例：90 天 / 一個訂閱週期 / 永久保留）。
- 資料庫既有 `notifications.link_url` 是否要一次性 migration 改寫，或永久靠 runtime 導向。
- 遷移期間如何量測：舊網址命中次數要不要進 analytics，達到什麼門檻才可移除。
