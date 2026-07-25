# 持倉看板 prop 契約衝突清掃（範圍已窮舉驗證）

## 驗證方法（先講清楚範圍怎麼定的）

1. **動態掃描**：Playwright headless 跑 `/holding-checkup`，收集 console `error/warning/pageerror`，並輪點四個 tab。
2. **靜態掃描**：`grep validateProps` 找出 12 支有 schema 的 freecheckup 元件，逐支比對 schema vs FreeCheckup.jsx / HoldingsTab 的呼叫端。

## 動態確認的衝突（每次進 `/holding-checkup` 必噴）

1. **`HoldingsHero` — `holdings` 型別錯誤**
   - `HoldingsHero.tsx` L28：`holdings: { type: 'object', optional: true }`
   - `HoldingsTab.tsx` L275 傳入 `holdings={H}`（`Array<Holding>`）
   - `_validateProps.js` 對 `array`／`object` 嚴格分離 → 每次 render `console.error`

2. **`HoldingsTab` — `tradeLog` 未登記**
   - `FreeCheckup.jsx` L3554 傳入 `tradeLog={tradeLog}`；`HoldingsTab.tsx` L130 有解構使用（傳給 DetailPanel）
   - `HOLDINGS_TAB_PROP_SCHEMA` 缺此欄 → 每次 render `console.warn`

（其他 console 噪音 —— `traffic-ingest` CORS、`knowledgeBase 0 rows`、React Router v7 future-flag —— **不是**持倉看板的問題，本次不動。）

## 靜態掃描結果（4 支關鍵子元件）

- `HoldingsFilterBar`、`HoldingsQuotaMeter`、`HoldingsReversalSection`、`HoldingCard` 的 schema 與呼叫端型別對齊，沒有潛藏 array/object 錯配。
- `HoldingsSectorSummary`、`HoldingsActionPriority`、`HoldingsFooterBar`、`HoldingsWorkbench`、`HoldingsDetailPanel`、`HoldingsEmptyState`、`HoldingsNoMatchState`、`HoldingsUploadSummary`、`HoldingMetaReportModal`、`HoldingExportCard`、`ChipsSection` **沒有 schema**（不透過 validateProps）→ 這批本次不新增 schema，避免擴大範圍。

## 修法（只動 3 個字面上的契約，不動 runtime）

### Step 1 — `HoldingsHero.tsx` L28

```ts
holdings: { type: 'array', optional: true }, // Array<Holding>
```

### Step 2 — `HoldingsTab.tsx` `HOLDINGS_TAB_PROP_SCHEMA`

在 optional 區塊補：
```ts
tradeLog: _opt('array'),
```

### Step 3 — 兜底靜態複檢

再對 `HoldingsFilterBar` / `QuotaMeter` / `ReversalSection` / `HoldingCard` 快速掃一次「schema 宣告 required 但呼叫端可能 undefined」的 case，發現就補 optional 或給 fallback。目前 grep 沒看到明顯 miss，但實跑後若 dev console 仍冒新警告，一併在同一次修完（不留尾巴）。

## 驗證

1. `bunx tsgo`：TS 通過。
2. Playwright 重跑 `/holding-checkup` 並輪點四個 tab，斷言以下三條 console 訊息**不再出現**：
   - `[HoldingsHero] prop "holdings" expected object, got array`
   - `[HoldingsTab] unknown prop "tradeLog"`
   - 任何 `[Holding*]` 開頭的 error/warning
3. 截圖 Hero 與持倉牆，確認視覺零退化。

## 不動範圍

- 不改資料流、store、UI 行為。
- 不改 `_validateProps.js` 驗證邏輯（它是對的）。
- 不 refactor `FreeCheckup.jsx` 的巨型 props bag（另一個工程）。
- 不處理 CORS / knowledgeBase / React Router future flag（不是持倉看板問題）。

## 技術細節

`_validateProps.actualType` 對 `Array.isArray` 回傳 `'array'`，`typeof {}` 才是 `'object'`；`typeMatches` 用嚴格 `===`，所以 `'object'` schema 拒收 array。這就是 Hero 錯誤的根因，修法即把 schema 改 `'array'`。
