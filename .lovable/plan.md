

# 持倉看板升級計畫 — 18 人格討論結果

## 規劃階段 Planning

### 🧑‍💼 CEO 產品思維（/plan-ceo-review）

**核心問題**：持倉看板是用戶每天打開第一個看的頁面，但目前視覺層次扁平，所有卡片長得一模一樣，缺乏「一眼抓重點」的能力。

**產品方向**：
1. **英雄區塊**：總損益必須是頁面最搶眼的元素，用漸層背景 + 大字體，正如收盤分析已經做的那樣
2. **資訊密度分層**：摘要層（一眼看完）→ 健檢層（需要注意的）→ 明細層（逐檔查看）
3. **行動導向**：每個區塊都要能引導下一步動作（同步價格、設定目標價、觸發分析）

### 👷 工程經理（/plan-eng-review）

**架構評估**：
- 現有 `HoldingsPanel.jsx`（277行）和 `HoldingsTable.jsx`（306行）結構合理，不需要拆檔
- 資料流通過 `useRouteHoldingsPage` → `usePortfolioRouteContext` 已經完善
- `holdings.js` 的計算函數完整，不需改動
- `STOCK_META` 和 `IND_COLOR` 已有豐富 metadata 可利用

**技術決策**：純 UI 渲染優化，不動資料流、不動計算邏輯、不動 store

### 🎨 資深設計師（/plan-design-review）

**現有設計問題（80 項審計摘要）**：
1. `HoldingsSummary`：三個指標卡的 `fontSize:9` 標籤太小，數字 `fontSize:14` 不夠搶眼
2. `PortfolioHealthCheck`：產業分布條只有 6px 高，幾乎看不見；產業標籤排列密集
3. `HoldingRow`：五欄 grid 在手機上會被壓縮，代碼 `fontSize:9` 太小
4. `WinLossSummary`：只顯示前 3 檔，沒有視覺化漲跌幅度
5. 所有卡片之間 `marginBottom:8` 太緊湊，缺乏呼吸感
6. 展開行的目標價/警報輸入框過於樸素，缺乏交互反饋

### 🎭 設計夥伴（/design-consultation）

**競品參考**：Bloomberg Terminal、TradingView Portfolio 的共通點是：
- 總損益用超大字體 + 背景色彩暗示漲跌
- 持股列表用色條表示個股權重
- 產業分布用環形圖或堆疊條

---

## 審查階段 Review

### 🔍 Staff Engineer（/review）

**潛在 Bug**：
1. `HoldingRow` 第 79 行 `holding.qty.toLocaleString()` — 如果 qty 是 undefined 會 crash → 加 `(holding.qty || 0)`
2. `PortfolioHealthCheck` 第 97 行 `holdings.forEach((h) =>` — 變數名 `h` 遮蔽了 `createElement as h`，雖然在此 scope 內不使用 createElement 所以不會出錯，但不良實踐
3. `Top5Holdings` 在 `totalVal=0` 時 `Math.max(totalVal, 1)` 防止除零，OK

---

## 測試階段 QA

### 🐛 QA 主管（/qa）
- 需測試空持倉狀態、單檔持倉、20+ 檔持倉的渲染
- 需測試手機 375px 寬度下的 grid 是否 overflow

### 📐 設計 QA（/qa-design-review）
- 美化後需確認暗色主題下文字對比度 ≥ 4.5:1
- 確認漸層背景不會讓文字難讀

---

## 具體改動計畫

### 改動 1：英雄損益摘要卡片
**檔案**：`HoldingsPanel.jsx` 的 `HoldingsSummary`

- 總損益數字 `fontSize:14` → `28`，加入漸層背景（漲紅暈/跌綠暈）
- 新增「總損益」為獨立大卡片，與總成本/總市值/持股數分開
- 加入報酬率百分比 pill 標籤
- `marginBottom:10` → `14`

### 改動 2：產業分布條視覺強化
**檔案**：`HoldingsPanel.jsx` 的 `PortfolioHealthCheck`

- 產業條高度 `6px` → `10px`，加入 `borderRadius:5`
- 標籤增加 hover 效果提示
- 集中度警告加入 ⚠ 圖示 + amber 漸層頂邊線

### 改動 3：持股明細行三行佈局（手機優先）
**檔案**：`HoldingsTable.jsx` 的 `HoldingRow`

- 從五欄 grid 改為三行堆疊：
  - 第一行：名稱 + 代碼 + 標籤（投資週期、核心/衛星）
  - 第二行：產業 + 策略分類（低亮度文字）
  - 第三行：股數 · 成本 · 現價 · 損益 · 報酬率
- 損益加入微型色條表示漲跌幅度
- 展開行增加目標價距離百分比提示

### 改動 4：獲利/虧損摘要增加漲跌幅色條
**檔案**：`HoldingsPanel.jsx` 的 `WinLossSummary`

- 每檔後面加入 mini 色條，寬度比例表示漲跌幅度
- 表頭加入 📈 / 📉 圖示

### 改動 5：Top5 增加圓環佔比視覺
**檔案**：`HoldingsPanel.jsx` 的 `Top5Holdings`

- 每檔前面加入微型圓弧進度條表示佔比

### 改動 6：HoldingRow qty crash 防護
**檔案**：`HoldingsTable.jsx` 第 79 行

- `holding.qty.toLocaleString()` → `(Number(holding.qty) || 0).toLocaleString()`

## 涉及檔案

| 檔案 | 改動範圍 |
|------|---------|
| `src/checkup/components/holdings/HoldingsPanel.jsx` | HoldingsSummary、PortfolioHealthCheck、Top5Holdings、WinLossSummary 美化 |
| `src/checkup/components/holdings/HoldingsTable.jsx` | HoldingRow 三行佈局 + Bug 修復 |

## 不動的部分
- `holdings.js`、`holdingMath.ts` 計算邏輯不動
- `useRouteHoldingsPage.js` 資料流不動
- `holdingsStore.js` store 不動
- `theme.js` 主題色不動
- 其他頁面不動

