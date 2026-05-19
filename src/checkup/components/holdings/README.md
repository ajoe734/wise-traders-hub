# Holdings 元件目錄

本目錄保留會員版 `/checkup` 路由所需的兩支持倉元件。

## 元件
- `HoldingsPanel.jsx` — 列表式持倉面板（由 `src/checkup/pages/HoldingsPage.jsx`、`AppPanels.jsx` 引用）
- `HoldingsTable.jsx` / `HoldingRow` — 表格式持倉（同上）
- `holdingsTokens.js` — 設計 token（單色橘紅憲法，見 `mem://style/holdings/monochrome-orange-pnl`）

## 已移除（2026-05 holdings 盤點 A1）
原 `HoldingsWorkbench` / `HoldingHero` / `HoldingCard` / `HoldingDetailPanel` / `PriorityStrip`
五支樣板檔已刪除（合計 1,252 行）— 從未被任何路由引用，僅自我互引。

`/free-checkup` 的持倉看板實作在 `src/checkup/components/freecheckup/Holding*.jsx`，
與本目錄完全獨立；憲法詳見 `mem://architecture/checkup/inline-rendering-audit`。

## 維護規則
1. `/free-checkup` 的持倉變更請改 `src/checkup/components/freecheckup/`，不要動本目錄
2. 修改 token 時，同步更新 `freecheckup/HoldingCard.jsx` 等對應檔
