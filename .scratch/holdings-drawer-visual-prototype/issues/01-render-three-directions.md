# 01 — 持倉抽屜三方向視覺原型

Status: ready-for-agent
Priority: P1
Category: enhancement
Blocked by: None — can start immediately

## What to build

提供三個使用真實持倉抽屜圖表元件與固定 3443 資料的獨立預覽，讓使用者先比較視覺方向，再決定是否修改正式介面。

## 驗收標準

- [ ] 三方向皆為 390px 完整抽屜，可用網址參數切換並可分別截圖。
- [ ] 固定資料包含價格軸、30 日 OHLC 與量能、PE/PB/PS 三尺、現金殖利率輔助、三大法人。
- [ ] wire 灰階＋品牌橘；行情紅漲綠跌；無陰影、漸層、深色區塊、藍紫金。
- [ ] 560／390／380px 無水平溢出，768px 資訊層級正常。
- [ ] 動畫支援 prefers-reduced-motion。

## 頁面／路由清單

| 路由 | 新增／修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/e2e/holdings-drawer-visual-prototype` | 新增 | localhost／未發布 Preview | 三方向獨立視覺原型 |

深連結與導向：

- 進入點：直接開啟預覽網址並以 `direction=research|price|balanced` 切換。
- 失敗導向：正式與自訂網域顯示 NotFound。
- 是否需要更新 `public/sitemap.xml`：否。

## 資料來源

**讀取**

| 來源 | 型別 | 欄位／回傳 | 權限 |
| --- | --- | --- | --- |
| 原型檔內固定 fixture | 靜態資料 | 3443 價格、OHLCV、法人數字 | 僅 Preview harness |

**寫入**

| 來源 | 動作 | 權限與稽核 |
| --- | --- | --- |
| 無 | 無 | 原型不持久化 |

**衍生規則**

- 單位：價格 TWD；法人張數。
- 幣別：TWD。
- 價格權威：固定原型資料，不代表正式報價。
- 快取與更新頻率：無。

## Out of scope

- 不修改正式抽屜、金融計算、資料庫、權限或正式發布。

## Comments

- 使用者選定方向後，另開正式實作工作項目。