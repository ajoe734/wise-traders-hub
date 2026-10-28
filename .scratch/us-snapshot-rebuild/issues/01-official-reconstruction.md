# 01 — 美股快照官方日線重建

Status: ready-for-agent
Priority: P1
Category: bug
Blocked by: None

## What to build

全部美股快照改用 Nasdaq 官方網站顯示的每日 OHLCV 重建，保留原件與核對證據，無資料不採用。先前727筆為第三方核對說法，本輪以官方全量重算，不強湊數量。

## 驗收標準

- [ ] 全部1831筆、37標的有重建或停用結果，晚標日期優先。
- [ ] 日期按原始拍攝時刻與已完成紐約交易日判定，休市不捏造資料。
- [ ] 原始紀錄完整存稽核，重跑冪等、同日碰撞不覆蓋另一標的。
- [ ] 期權、SPCX無官方日線保留原件並停用；全部讀取路徑排除停用列。
- [ ] 單元與資料庫重建測試、官方全量讀回對帳通過。

## 頁面／路由清單

無新前台路由；既有持倉、績效、回測讀取沿用資料表。新增管理員維護端點，不發布正式前台。

## 資料來源

- 讀：daily_price_snapshots 全部US原件；Nasdaq歷史JSON，每檔保存URL、抓取時間、SHA256與原始回應。
- 寫：快照日期及OHLCV、is_usable/source/exclusion_reason；audit_logs保存原件及新資料，每標的原子交易。
- 權限：修復RPC僅service_role，維護端點驗證company_admin；不擴張會員權限。
- 口徑：USD，成交量股數，來源顯示的close（非adjclose），不用價差猜日期。

## Out of scope

不改持倉交易帳本、不重算已完成薪資、不發布正式前台；無官方期權日線不可用股票替代。