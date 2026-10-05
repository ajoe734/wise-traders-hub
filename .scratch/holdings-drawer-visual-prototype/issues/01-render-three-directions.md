# 01 — 持倉抽屜三方向視覺原型

Status: ready-for-human
Priority: P1
Category: enhancement
Blocked by: None — can start immediately

## What to build

使用真實持倉抽屜行情元件與固定 3443 資料，提供已選定的 Lieflat valuation drawer 預覽，讓使用者確認後再決定是否修改正式介面。

## 驗收標準

- [x] 390px 完整抽屜套用已選定的 Lieflat valuation drawer 方向並可截圖。
- [x] 固定資料包含價格軸、30 日 OHLC 與量能、PE/PB/PS 三尺、現金殖利率輔助、三大法人。
- [x] 目標價與 PE／PB／PS 共用同一條 NT$ 價格軸；切換時動畫更新內容，資料不足不畫假區間。
- [x] 除 K 線、成交量、法人籌碼外，圖卡採 lieflat-charts wire 灰階＋品牌橘與原版可數刻度語法；行情紅漲綠跌；無陰影、漸層、深色區塊、藍紫金。
- [x] 560／390／380px 無水平溢出，768px 資訊層級正常。
- [x] 動畫支援 prefers-reduced-motion。

## 頁面／路由清單

| 路由 | 新增／修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/e2e/holdings-drawer-visual-prototype` | 新增 | localhost／未發布 Preview | 三方向獨立視覺原型 |

深連結與導向：

- 進入點：直接開啟預覽網址。
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

- 使用者已選定 Lieflat valuation drawer；確認預覽後另開正式實作工作項目。