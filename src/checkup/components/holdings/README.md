# Holdings 元件目錄

本目錄保留會員版 `/checkup` 路由所需的兩支持倉元件。

## 元件
- `HoldingsPanel.tsx` — 列表式持倉面板（由 `src/checkup/pages/HoldingsPage.jsx`）
- `HoldingsTable.jsx` / `HoldingRow` — 表格式持倉（同上）
- `holdingsTokens.js` — 設計 token（單色橘紅憲法，見 `mem://style/holdings/monochrome-orange-pnl`）

## 已移除（2026-05 holdings 盤點 A1）
原 `HoldingsWorkbench` / `HoldingHero` / `HoldingCard` / `HoldingDetailPanel` / `PriorityStrip`
五支樣板檔已刪除（合計 1,252 行）— 從未被任何路由引用，僅自我互引。

`/holding-checkup` 的持倉看板實作在 `src/checkup/components/freecheckup/Holding*.tsx`，
與本目錄完全獨立；憲法詳見 `mem://architecture/checkup/inline-rendering-audit`。

## 維護規則（憲法）
1. `/holding-checkup` 的持倉變更請改 `src/checkup/components/freecheckup/`，**不要** import 本目錄
2. `/checkup`（會員版）的表格持倉變更請改本目錄，**不要** import freecheckup/Holding*
3. 修改 token 時，同步更新 `freecheckup/HoldingCard.tsx` 等對應檔
4. 兩套刻意分離：表格 vs 卡片牆是不同產品形態，合併會破壞 UX

## Hooks 命名澄清（C 批 M7；2026-07 更新）
- Expert 持倉單一資料源：`@/hooks/useExpertHoldingsBundle`（RPC `get_expert_capital_status`）
- Zustand 全域狀態：`@/checkup/stores/holdingsStore`（exports `useHoldingsStore`）
- 已移除：`src/checkup/hooks/useHoldings.js`（orphan）、`src/hooks/useMyTradeRecordHoldings.ts`（違反單一資料源憲法，2026-07 廢除）

