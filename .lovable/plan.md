## 目標
抽屜內同時出現兩條 30 日折線：
- **A. Header 迷你 sparkline**（L459-464，110×28，貼在個股名稱右側，純裝飾）
- **B. RangeBand 30 日走勢帶**（L544-556，含低/高標籤、現價紅點、資料源一致性警示）

保留 **B（RangeBand）**，移除 A。B 資訊密度高、承載一致性偵測，是真正的資料元件；A 是視覺重複。

## 空白處排版
刪掉 A 後，Header 名稱那一列右側會空出一塊。方案：**把「今日 +X% · +Y」的當日績效從第 3 區（L487-492）上提到名稱列右側**，成為右對齊的當日 delta。

理由：
1. 保持 Header 兩欄視覺平衡（左：名稱／右：當日 delta），不留突兀空白。
2. 「當日績效」比「總 ROI」更適合放最上方——使用者打開抽屜第一眼想知道「今天怎樣」。
3. 第 3 區報酬塔精簡為 `總 ROI + 持股/市值`，減少資訊重複（今日績效原本擠在第二行，讀取層級不清）。
4. 完全不動 RangeBand、PriceAxis、建議印章等下游區塊，改動半徑最小。

## 版面示意

```text
變更前                              變更後
┌─────────────────────────┐        ┌─────────────────────────┐
│ 053848 · 半導體 · 權證  │        │ 053848 · 半導體 · 權證  │
│ 亞翔凱基5B購    ∿∿∿∿    │  →     │ 亞翔凱基5B購  今日+0.45%│
│                          │        │                +80      │
│ +21.55% +3,120           │        │ +21.55% +3,120          │
│ 今日+0.45% · +80         │        │ 持股 8,000 · 市值 17,600│
│ 持股 8,000 · 市值 17,600 │        │                          │
│ ─── 建議 —— 續抱 ───     │        │ ─── 建議 —— 續抱 ───    │
│ [PriceAxis]              │        │ [PriceAxis]             │
│ 30 日走勢    低 — 高    │        │ 30 日走勢    低 — 高    │
│ ∿∿∿∿∿∿∿∿∿∿● (RangeBand) │        │ ∿∿∿∿∿∿∿∿∿∿● (RangeBand)│
└─────────────────────────┘        └─────────────────────────┘
```

## 實作步驟

1. `src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`
   - **L459-464**：刪除 `<Sparkline>` 區塊與外層 `data-panel-sparkline` div。
   - **L453-465**：Header 右側改放當日 delta 小組件（`今日 +X% / +Y`），tabular-nums、`fontSize: 12`、`color: WB.inkSub`；當日為負用 `WB.inkMute`，避免搶走名稱視覺焦點。窄屏（≤380px）自動換行到名稱下方。
   - **L487-492**：從報酬塔第二行拿掉「今日 …」段落（已上提），保留 `持股 · 市值`。
   - `sparkArr` / `pctVal` 邏輯不動，RangeBand 仍照舊消費同一份 `sparkArr`。

2. 手機（≤560px）RWD：Header 用 flex-wrap，當日 delta 在窄屏落到名稱下方獨立一行、右對齊；已有 `holdingsDetailPanel.css` 斷點，加一條 `.holdings-detail-today-delta` 樣式。

3. 回歸測試
   - `e2e/holdings-detail-panel-visual-snapshot.spec.ts`：更新 baseline（3 斷點）。
   - `e2e/holdings-detail-panel-roi-fontsize.spec.ts`：確認新的當日 delta 字級 ≤ 22px。
   - 新增輕量斷言：`[data-panel-sparkline]` 不存在、`[data-testid="holdings-range-band"]` 仍存在。
   - `e2e/holdings-range-band-*` 系列不動（RangeBand 未改）。

## 不動的事
- RangeBand 幾何 / 一致性偵測 / diagnostics 全數保留。
- PriceAxis、建議印章、WeightRank 等其他區塊不動。
- 不改資料流、不改 props schema。
