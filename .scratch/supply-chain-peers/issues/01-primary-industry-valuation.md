# 01 — 產業鏈同業估值

Status: ready-for-human
Priority: P1
Category: enhancement
Blocked by: None

## What to build

同業平均與估值判讀只比較已核實的相同主細分產業，玻纖、銅箔、CCL及PCB板廠分開，不以次要業務或跨產業組湊數。

## 驗收標準

- [x] 玻纖紗/玻纖布只比玻纖廠，CCL只比銅箔基板廠。
- [x] 人工加入、次要產業、大類及市場族群不能繞過同主業限制。
- [x] 同業不足3家不畫參考點，判讀沿用歷史定位；未知分類不補猜。
- [x] 全129類測試同業過濾、即時名單及財報候選挑選。
- [x] 完整4550測試通過（9跳過）；本人34檔×八寬度272次圖表無溢出/pageerror；560/390/380px截圖確認。
- [ ] 414px既有截圖高度171→170px基準差異未閉合，未改基準；財報函式未部署、正式前台未發布。

## 頁面／路由清單

| 路由 | 新增／修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/holding-checkup` | 修改 | 既有公開及登入持倉 | 抽屜、個股分布與投組同業過濾 |
| `/free-checkup` | 修改 | 既有相容入口 | 共用相同估值接縫 |

無新導向或sitemap變更。

## 資料來源

讀取：已採用`stock_industry_map`主產業；既有`valuation_snapshot`、`valuation_peer_medians`及`valuation_peer_multiples`比率；`valuation-fundamentals`財報讀取維持原授權與DB-only規則。分類刷新沿用進頁、focus及管理員儲存通知。

寫入：無新DB/RLS/權限變更；沒有替使用者確認待審分類。歷史倍數、平均、中位數、分母及個人試算算法不變。

## Out of scope

正式前台發布、共用函式部署、PS排程清單與資料回補；既有跨產業靜態資料保留但不再被執行期估值使用。