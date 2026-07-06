## 目標

在 `/holding-checkup` 持倉分頁的最上方（KPI Hero 下方、反轉追蹤上方）加一段「持倉族群分佈」總覽，讓使用者一眼看出：

- 哪些**產業**吃掉最多市值（集中風險）
- 哪些**題材／策略**壓最多檔（重疊押注）
- 是否過度集中（單一產業 >25% 或 ≥3 檔）或過度分散（>6 個產業、每檔都 <10%）

同時保留每張持股卡片上既有的產業/題材標籤，不動卡片。

## 放位置

檔案：`src/checkup/components/freecheckup/HoldingsTab.tsx`
位置：`<HoldingsHero />`（L221-234）下方，`<HoldingsReversalSection />`（L238）上方。

## 新元件

新增 `src/checkup/components/freecheckup/HoldingsSectorSummary.tsx`：

Props：
- `holdings`（來自 `H`）
- `stockMeta`（`STOCK_META`）
- `WB` / `C` / `alpha`（沿用 Kore-eda 色系與現行 hero token）

### 兩個維度並列

```text
┌─ 產業分佈（依市值佔比） ─────────────────────────┐
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░  (stacked bar 6px)      │
│ [半導體 5檔 42%] [金融 2檔 18%] [電子零組件 …]    │
│ ⚠ 集中：半導體(5檔 42%) — 建議分散                │
└──────────────────────────────────────────────────┘
┌─ 題材／策略（依檔數） ───────────────────────────┐
│ [AI 4] [高股息 3] [重電 2] [未分類 1]             │
└──────────────────────────────────────────────────┘
```

### 集中/分散規則

- **集中警示**（琥珀色 `C.amber`，沿用 `PortfolioHealthCheck` 慣例）
  - 單一產業市值 >25%，或該產業持股 ≥3 檔
- **分散提示**（灰色 hint，不用警示色）
  - 產業數 >6 且最大產業 <20% → 「配置分散，追蹤成本較高」
- **未分類**（`STOCK_META` 沒收錄的個股）
  - 產業/題材皆歸「未分類」，數量若 >0 顯示 hint「N 檔未歸類，建議手動補產業標籤」

## 邏輯來源

複用 `HoldingsPanel.tsx` L198-234 的 `PortfolioHealthCheck` 聚合邏輯（industry × market value、strategy × count、warnings 條件），但：

- 不再共用該元件本身（該元件屬於舊 `HoldingsPanel`、非本路由使用）
- 抽出純聚合 helper 放 `src/checkup/lib/holdingUtils.js`：
  - `aggregateBySector(holdings, stockMeta)` → `{ industryByValue, strategyByCount, warnings, unclassifiedCount }`
- 新元件只負責渲染

這樣單元測試可以直接 cover helper，不用 mount 元件。

## Demo / 空狀態

- 持倉 = 0：整塊不渲染（早退）
- 只有 1 檔：不顯示 stacked bar，只顯示單一標籤 + 「僅 1 檔，暫無族群比較意義」

## 視覺規範

- 遵守 `mem://style/checkup/japanese-minimalist-aesthetic`：off-white 底、無陰影、字重 ≤500、字級 10-12
- 產業條 6px 高、圓角 3、最大產業用 `IND_COLOR[ind]`，其餘 `alpha(C.textMute,'25')`
- 題材/策略用 chip 樣式，與 `HoldingsFilterBar` 對齊

## RWD

必跑 `mem://qa/checkup/freecheckup-mobile-regression-checklist`：560/390/380px 三斷點靜態檢查 + 截圖。橫向 chip 用 `flexWrap: wrap`，不會撐爆。

## 驗證

1. 用內建 demo 資料進 `/holding-checkup?demo=1`，確認：
   - 產業條總和 = 100%
   - 集中警示對「半導體」正確觸發
   - 未分類個股（如新上傳未收錄）落入「未分類」桶
2. `bunx playwright test e2e/freecheckup-card.spec.ts`
3. `bunx tsgo` typecheck

## 檔案清單

- 新增 `src/checkup/components/freecheckup/HoldingsSectorSummary.tsx`
- 新增 helper `aggregateBySector` in `src/checkup/lib/holdingUtils.js`
- 編輯 `src/checkup/components/freecheckup/HoldingsTab.tsx`（import + 插入一行）
