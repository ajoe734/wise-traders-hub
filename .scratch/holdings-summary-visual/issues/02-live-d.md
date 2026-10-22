# 02 — D 版真實持倉摘要

Status: ready-for-human
Priority: P2
Category: enhancement
Blocked by: None

## What to build
將已選 D 並肩版套用正式持倉頁的真實持倉，保留動畫、刷新、產業篩選與預設。

## 驗收標準
- [x] 兩持倉入口使用原本總成本／市值，無示範數字或新請求。
- [x] 多產業市值拆分沿用 aggregateBySector，百格取整恰為 100；無市值不畫假格。
- [x] 重播清除計時器、滑過產業連動、減少動態立即顯示。
- [x] 策略／週期／定位無標籤列未分類，圓點一檔一點。
- [x] 刷新、錯誤重試、索引、聯集／交集與預設不移除。
- [x] 1280／560／390／380px 截圖、真實本人資料讀回與相關測試通過。

## 頁面／路由清單
| 路由 | 修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/holding-checkup`、`/free-checkup` | 是 | 現有登入／示範隔離 | 正式摘要呈現 |
| `/portfolio/:id/holdings` | 是 | 現有持倉權限 | 相同摘要元件 |
| `/e2e/holdings-summary-templates?v=d` | 是 | harnessHostGate | 共用正式元件 |

## 資料來源
**讀取**：既有 H／route panelProps、stockMeta、既有 metadata overrides；aggregateBySector 原有權重；無新增 API。
**寫入**：僅既有篩選互動；不寫任何持倉帳本。
**衍生規則**：沿用入口總成本／市值；最大餘數分配百格；刻度範圍必要時擴展，絕不夾限成假值。

## 模板依據
沿用使用者選定 D 的半環／百格／圓點幾何，F11（basics-gallery / How far to the quarter's goal）刻度與 obsReveal；L14（lupi-gallery / A hundred of us, four minds）100 單位分解；L15（What they fear, tick by tick）逐列可數單位與 stagger，採已核准圓點適配。比較 F4 的環構成會與半環重複，F5 橫列不保留百格選定形狀，L2 垂直類目不容納長產業標籤，故不改選型。wire 系統與品牌橘／暖灰維持原核准方向。

## Out of scope
DB／RLS／權限／金融計算／正式發布。
## 驗證結果
本人雲端 pf-holdings-v2 31 檔，畫面 31 檔／成本3100／市值14364；無示範模式。1280/560/390/380 無溢出；百格100、69非主角格hover淡化、產業選取與移除、重播及reduce正常，無pageerror。第二路由目前無持倉，僅空狀態驗證，非真實非空驗證。全套4380通過／9跳過；手機卡片12通過。摘要高度更動導致前三個手機卡片截圖位置1px差異，已視覺檢查並更新基準，未改卡片。
