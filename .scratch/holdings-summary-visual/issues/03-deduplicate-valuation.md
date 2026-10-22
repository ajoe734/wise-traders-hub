# 03 — 下方去重與估值視覺化

Status: ready-for-agent
Priority: P2
Category: enhancement
Blocked by: None

## What to build
去除 D 摘要下方重複產業占比與策略統計，保留不重複的估值證據，以圖表及可展開明細呈現。

## 驗收標準
- [x] 不重複畫產業市值分布／策略清單，保留題材、族群、預設與篩選。
- [x] 投組與逐桶估值沿用原值，各尺單獨定位；無值不畫點。
- [x] 已反映程度使用原權重，未完成不補成已知分類，明細可查。
- [ ] 本人31檔、全部桶選取、說明／明細及1280/560/390/380驗收。
- [ ] 模組邊界、相關測試、四手機卡片回歸通過。

## 頁面／路由清單
| 路由 | 修改 | 准入 | 說明 |
| --- | --- | --- | --- |
| `/holding-checkup` | 是 | 原登入／示範隔離 | 下方去重及估值 |
| `/free-checkup` | 否 | 原轉址 | 導向上述入口 |
| `/portfolio/:id/holdings` | 否 | 原持倉權限 | 已確認沒有這三個估值區，不加新資料 |

## 資料來源
讀取：既有 `usePortfolioValuation` 與 `usePricedInList` 結果、`aggregateBySector` 索引；保留既有 RPC／財報載入與權限，無新增請求。
寫入：僅原篩選／預設；新展開與選取只在記憶體。
衍生：僅 SVG 位置編碼與刻度著色，不改金融計算、加權或資料更新頻率。

## 模板與候選
投組／桶溢折價採 L7 Brand Spectrum，`lupi-gallery.html` / Where the brand sits；獨立雙極量尺與點位置，取消無語義的跨尺 ribbon。F12 前後對比不符基準比較，F5 只容納非負計數。
已反映程度採 F4 Tick Donut，`basics-gallery.html` / Where the traffic comes from；每1%刻度環、每10刻度點標、灰階及單一橘重點。L14 與 D 百格重複，L15 各項獨立不是構成，故採 F4；精確權重保留旁列，未完成留灰不凑數。

## Out of scope
DB／權限／Edge Functions／金融算法／正式發布。