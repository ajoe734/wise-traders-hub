# 01 — 同業明細顯示個股名稱

Status: ready-for-agent
Priority: P1
Category: bug
Blocked by: None — can start immediately

## What to build

持倉看板展開同業明細時，每一列都要同時顯示股票代號與個股名稱；名稱同步需涵蓋全市場，不能只補畫面上的少數個股。

## 驗收標準

- [ ] 展開同業明細後，每一列都顯示「股票代號 個股名稱」。
- [ ] 正式估值母體中的台股名稱完整回補，不只修正截圖中的 3035、3661、6533。
- [ ] 外部資料暫時缺少名稱時，仍保留股票代號與估值數值，不讓整列消失。
- [ ] 560 / 390 / 380px 版面正常，長名稱可換行且無橫向溢出。
- [ ] 新增回歸測試，並通過估值 focused tests、型別與模組邊界檢查。

## 頁面／路由清單

| 路由 | 新增／修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/holding-checkup` | 修改 | 依既有持倉看板准入 | 個股抽屜的同業明細補齊股票名稱 |

深連結與導向：

- 進入點：持倉看板點選個股後，展開「同業明細」。
- 失敗導向：沿用既有持倉看板處理。
- 是否需要更新 `public/sitemap.xml`：否。

## 資料來源

**讀取**

| 來源 | 型別 | 欄位／回傳 | 權限 |
| --- | --- | --- | --- |
| `TaiwanStockInfo` | 第三方 | `stock_id`, `stock_name`, `industry_category`, `type` | 排程金鑰保護的同步函式讀取 |
| `stock_names` | 資料表 | `symbol`, `name`, `market`, `asset_class`, `currency` | 估值 RPC 以固定查詢讀取 |
| `valuation_snapshot` | RPC | `peers[].symbol`, `peers[].name` 與三項估值 | 唯讀、既有安全模型 |

**寫入**

| 來源 | 動作 | 權限與稽核 |
| --- | --- | --- |
| `stock_names` | upsert 全市場台股名稱 | 僅排程函式以服務權限寫入 |

**衍生規則**

- 單位：不變。
- 幣別：台股固定 TWD。
- 價格權威：不變，名稱不參與價格計算。
- 快取與更新頻率：跟隨既有 `valuation-sync` 產業同步排程更新。

## Out of scope

- 不變更估值公式、同業母體、加權指數或 BSR 後端管線。

## Comments