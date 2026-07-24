
# 後台 SignalsTable RWD 雙形態根因重構（含瘦身與回歸控管）

目標三合一：
1. 從**物理層面**解決 809px 8 欄擠壓跑版。
2. 重構後**淨行數不增反減**（現況 SignalRow 321 行 + SignalsTable 128 行 = 449 行 → 目標 ≤ 420 行）。
3. 每一步都可獨立回滾，回歸 bug 有 CI 立即擋下。

---

## 一、肥大控管原則（先訂規則、再寫碼）

| 規則 | 執行方式 |
|---|---|
| **不新增 presenter 之外的元件層** | 只允許 3 個新檔：`useSignalRowViewModel.ts`、`SignalListItem.tsx`、`SignalExpandedDetails.tsx`。禁止再切 `SignalListItemHeader` / `SignalListItemFooter` 這類過度拆分。 |
| **共用子片段用純函式 + JSX 片段**，不用元件 | 例如 `renderBatchBadge(vm)`、`renderCurrencyDot(vm)` 放在 view model 檔尾，兩形態共用；避免 props drilling 與額外 memo 邊界。 |
| **展開區塊只抽一次** | `SignalExpandedDetails` 同時服務 table `<td colSpan>` 與卡片底部，用 `as` prop（`'tr' \| 'div'`）切換外層 wrapper。**不做兩份。** |
| **禁止複製 tailwind class 到兩形態** | 共用 tone 走 `signalTone.ts`（10 行常數表：`{ mentor: 'border-mentor/40 …', success: '…' }`），view model 只吐 tone key，presenter 查表。 |
| **行數硬上限** | PR 合入前 `wc -l` 三個新檔 + 兩個 presenter 檔加總 ≤ 現況 449 行 + 15%（≈ 516）。CI script 檢查。 |
| **禁止新增 npm 依賴** | 全部靠現有 `useIsMobile` pattern + `matchMedia`。 |

---

## 二、斷點與形態

| 視窗寬 | 形態 | 備註 |
|---|---|---|
| ≥ 1280px | Table | 現況欄寬重排作兜底 |
| 768–1279px | Card | 涵蓋 809px 現場 |
| < 768px | Card（緊湊 padding） | 手機 admin 極少用 |

新增 `src/pages/_adminSignals/breakpoints.ts`（≤ 25 行）：
```ts
export function useAdminSignalsLayout(): 'table' | 'card' | 'card-compact'
```
用 `useSyncExternalStore` + `matchMedia('(min-width: 1280px)')` / `(max-width: 767px)`，SSR 首次回 `'card'` 避免 CLS。

---

## 三、資料層（一次寫對，永不再改 UI 分岔）

**新檔 `useSignalRowViewModel.ts`（≤ 180 行，含 tone 表）**

輸出**已展平**的 view model：
```ts
{
  id, batchId, isTeaching,
  publishedAtText,
  displayInstrument: { text, tooltipFull } | null,
  assetBadge: { label, className } | null,
  batchBadge: { count, collapsed, onToggle } | null,
  actionMeta,                          // getActionMeta
  price: { symbol, formatted, quantityText, fx: {amount, currency} | null } | null,
  currency: { code, source, isInferred, sourceLabel },
  reasonSummaryPreview: string,
  publishStatus: { label, toneKey: 'mentor'|'success' } | null,
  holdingStatus: { label, toneKey } | null,   // 5 層三元運算集中此處
  actions: { canExpand, canRepush, canRecall, canEdit, recallDisabled, recallReason },
  expanded: { teachingTopic, overallSummary, reasonSummary, reasonDetail, riskNotes, learningPoints },
}
```

**關鍵瘦身點**：SignalRow.tsx L202–222 那 21 行 5 層三元 → view model 內 12 行 switch，兩形態直接讀 `holdingStatus.toneKey`。

---

## 四、UI 層變更（差量）

### 4.1 `SignalRow.tsx`：321 行 → 目標 ≤ 140 行
- 刪除 pickSignalCurrency 相關邏輯（搬進 view model；export 保留 re-export 給既有 test import，不破壞 API）。
- 刪除 holdingStatus 5 層三元。
- 刪除 FxHint（搬到展開區）。
- 刪除永遠顯示的「推斷·代號推斷」文字 badge → 改成 `<CurrencyDot />` 純函式片段：
  - `source='explicit'` → return null。
  - 其他 → 8px amber 圓點 + `title` tooltip，保留 `data-testid="admin-signal-currency-source"` + `data-currency` + `data-source`。
- colgroup 重排作 ≥1280 兜底：128 / 22% / 68 / 180 / auto / 88 / 96 / 148。

### 4.2 `SignalListItem.tsx`（新，≤ 120 行）
```
Row1: 時間 · 標的(tooltip) · asset · batch    │右：方向badge · 狀態badge
Row2: 大字價位 + CurrencyDot · 數量灰字
      理由 line-clamp:2
Row3: 展開 · 編輯 · 重推 · 收回（wrap）
```
教學卡：Row1 隱藏標的、Row2 隱藏價位。
padding：`card` `p-4 gap-3`，`card-compact` `p-3 gap-2`。
外層加 `content-visibility:auto; contain-intrinsic-size: 180px` 讓長清單懶算 layout。

### 4.3 `SignalExpandedDetails.tsx`（新，≤ 70 行）
- 抽 SignalRow L275–318 展開內容 + FxHint block。
- 用 `as: 'tr' | 'div'` 決定外層：table 版包 `<tr><td colSpan>`、卡片版純 `<div>`。**只寫一份。**

### 4.4 `SignalsTable.tsx`：128 行 → 目標 ≤ 110 行
```tsx
const layout = useAdminSignalsLayout();
if (layout === 'table') return <TableView …/>;   // 現況<table>，抽成內部函式，不新開檔
return <CardListView layout={layout} …/>;
```
- holdingSummary tfoot 也走同一份資料，卡片版渲染成底部灰色 summary 卡列表（12 行 JSX，行內處理，不新開檔）。
- **`?legacyTable=1` query flag** 強制走 table 版，作為線上緊急退版開關（≤ 3 行）。

**淨行數預估**：新增 ~370 行、刪除 ~200 行 → 淨 +170 行；扣掉 view model 消滅的 21 行三元 + 兩份 UI 邏輯本會產生的重複 ~80 行，實際約 +90 行，遠低於硬上限。

---

## 五、回歸控管（分四層守門）

### L1 型別與 API 契約
- `pickSignalCurrency` / `pickSignalCurrencyWithSource` / `SignalCurrencySource` / `SIGNAL_CURRENCY_SOURCE_LABEL` **保留 re-export**，避免外部 import（如 `pickSignalCurrency.test.ts`、`SignalCreateDialog`）中斷。
- view model 型別 export，`SignalRow`、`SignalListItem` props 都收 `viewModel: SignalRowViewModel`，讓 tsgo 抓到欄位漏傳。

### L2 單元測試（新增 3 個檔，共 ~60 case）
- `useSignalRowViewModel.test.ts`：
  - 7 種 action × (有持倉/無持倉/addBuy) → holdingStatus 表格化。
  - 4 種 currency source × isInferred。
  - Batch collapsed on/off、教學 signal displayInstrument。
- `SignalListItem.test.tsx`：教學卡不渲染價位、explicit 幣別不出現圓點、按鈕 disabled tooltip。
- `SignalRow.test.tsx`：`data-testid` 契約、colspan、hover class。

### L3 E2E（新檔 `e2e/admin-signals-rwd.spec.ts`）
同一份 fixture 三斷點：
| 視窗 | 硬斷言 |
|---|---|
| 1440×900 | `role=table` 存在、無 `[data-signal-card]`、scrollWidth ≤ clientWidth+1 |
| 809×593 | 無 `role=table`、`[data-signal-card]` 數 = signals.length、無橫向 scroll |
| 375×812 | 每張卡 `getBoundingClientRect().right ≤ viewport.width`、按鈕不溢位 |

沿用 `e2e/helpers/drawer-rwd-thresholds.ts` 的 `OVERFLOW_HARD_CAP_PX` + `VolatilityTracker`。**這是「跑版回歸」被 CI 立即擋下的關鍵。**

視覺快照走 `visual-regression.spec.ts` 加 3 張（table/card/card-compact），字型差異用 mask 遮 timestamp。

### L4 靜態守門（新增兩支 audit script，各 ≤ 40 行）
- `scripts/audit-admin-signals-columns.mjs`：偵測 `_adminSignals/` 內除兩個 presenter 外任何直接讀 `signal.action` / `signal.currency` / `signal.price_hint` → CI fail。強制新欄位必經 view model。
- `scripts/audit-admin-signals-loc.mjs`：`wc -l` 五個關鍵檔加總 > 516 → CI fail。防重構後又慢慢腫回去。

兩支掛進現有 `.github/workflows/test.yml` 的 lint job（不新開 workflow）。

### L5 既有 spec 對齊（防止改壞）
必須在同一 PR 內同步更新：
- `e2e/signal-detail-currency-tracking.spec.ts` → 加正向斷言「explicit 不出現圓點」。
- `e2e/signal-detail-preview-currency-schema.spec.ts` → 檢查 data attribute 未變。
- `src/test/pickSignalCurrency.test.ts`（29 case）→ 100% 保留通過，證明幣別邏輯無漂移。
- `signal-action-label-audit` → 已存在，無需改動。

---

## 六、實作順序（每步可獨立回滾）

| PR | 內容 | 若壞了怎麼辦 |
|---|---|---|
| **PR-1** | view model + 單元測試（不動 UI） | revert 單檔，UI 零影響 |
| **PR-2** | SignalRow 改吃 view model + CurrencyDot 收斂 | table 版視覺變化最小；revert 單檔 |
| **PR-3** | breakpoints hook + SignalListItem + 容器切換 | `?legacyTable=1` 立刻退版 |
| **PR-4** | SignalExpandedDetails 抽出 + FxHint 搬家 | revert 單檔，展開行為回舊態 |
| **PR-5** | E2E + 兩支 audit script + CI 整合 | 純 CI，本身不改 runtime |

每 PR：`bun run tsgo` + `bunx vitest run` + 對應 E2E 全綠才合入。

---

## 七、已知風險與對策

| 風險 | 對策 |
|---|---|
| 長清單卡片版 scroll 效能 | `content-visibility:auto` + `contain-intrinsic-size`；PR-3 用 200 筆 fixture 測 FPS |
| view model 抽錯造成 badge tone 漂移 | L2 case matrix + L4 audit + L5 既有 spec 三重護欄 |
| 斷點切換瞬間 flash | `useSyncExternalStore` 直讀 matchMedia，SSR 一律 card |
| `?legacyTable=1` 被遺忘導致技術債 | breakpoints.ts 內寫 TODO 附刪除日期（重構 + 兩週穩定後移除），audit script 一起檢查 |
| 手工 QA 遺漏 mentor/advisor 權限分岔 | L2 SignalListItem.test.tsx 用 `it.each` 覆蓋 isMentor × isAdvisor × isReadOnly 八個組合 |

---

## 八、為何這才是根因（相較 v1）

v1 只寫「切兩形態」；v2 額外釘死：
- **資料層唯一入口**（view model + audit）→ 未來新欄位不會再散落汙染 UI。
- **行數硬上限 + LOC audit** → 防止 6 個月後又腫回 800 行。
- **legacyTable query flag** → 上線後任何漏測回歸可在 30 秒內退版，無需 revert commit。
- **既有 spec 100% 保留通過** → 保證幣別、action label、視覺回歸三大既有契約無漂移。
- **每 PR 獨立可回滾** → 任何一步壞了都不會擋住其他改動。
