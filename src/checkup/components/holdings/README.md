# Holdings 元件目錄

本目錄分兩類元件：

## 🟢 In-use（已被外部引用）
- `HoldingsPanel.jsx` — 列表式持倉面板
- `HoldingsTable.jsx` / `HoldingRow` — 表格式持倉
- `holdingsTokens.js` — 設計 token（單色橘紅憲法）

## ⚪️ Template-only（樣板，**請勿** import 至 /free-checkup）
- `HoldingsWorkbench.jsx`
- `HoldingHero.jsx`
- `HoldingCard.jsx`
- `PriorityStrip.jsx`
- `HoldingDetailPanel.jsx`

### 為何保留？
這些元件是「持倉看板」的模組化樣板。`/free-checkup` 採 inline JSX 渲染（見記憶 `mem://architecture/checkup/inline-rendering-audit`），不引用這些抽象元件，以避免反覆抽出/合併造成的維護負擔。

樣板價值：
- 設計參考（Hero / Card / Strip / Panel 四種陳列模式）
- 未來新建獨立持倉頁時可直接引用
- Token 系統的活範例（如何套用 `valueColor` / `valueWeight` / `valueArrow`）

### 維護規則
1. 不刪除（保留設計資產）
2. 不直接掛上 `/free-checkup`（會違反 inline-rendering 共識）
3. 修改設計憲法時（`holdingsTokens.js`），同步更新這些樣板與 inline 程式碼
