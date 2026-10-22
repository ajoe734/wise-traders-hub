# 01 — 持倉看板上方摘要三個視覺模板

Status: ready-for-human
Priority: P2
Category: enhancement
Blocked by: None

## What to build
把持倉看板上方條列（總損益、成本／市值／檔數、產業、策略／週期／定位）改成 lieflat wire 圖表；先出三個預覽供選擇。

## 驗收標準
- [x] `/e2e/holdings-summary-templates?v=a|b|c` 三模板可切換（僅本機／未發布 Preview）。
- [x] 1280／390／380px 無水平溢出、無頁面錯誤。
- [x] 百格方陣加總 100、損益與集中提醒規則有單元測試。
- [ ] 使用者選定方向後另開正式移植項目。

## 頁面／路由清單
| 路由 | 新增／修改 | 准入條件 | 說明 |
| --- | --- | --- | --- |
| `/e2e/holdings-summary-templates` | 新增 | harnessHostGate | 三模板預覽 |

## 資料來源
**讀取**：頁內固定示範持倉。**寫入**：無。**衍生規則**：`src/lib/holdingsSummaryViz.ts` 純聚合。

## Out of scope
正式持倉看板、計算邏輯、資料庫。
