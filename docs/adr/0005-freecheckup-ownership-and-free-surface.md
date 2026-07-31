# ADR-0005：freecheckup 的治外法權收編——每個深模組多一個 free surface

- 狀態：Proposed（介面已定案，遷移分三階段執行）
- 日期：2026-07-31
- 相關：ADR-0001（五個深模組）、ADR-0004（Checkup Gateway seam）

## 背景

ADR-0001 把持倉看板切成五個深模組，擁有權由 barrel 的 re-export 自動推導。
但**免費版單頁**（`/holding-checkup`、`/holding-checkup-demo`）走的是另一套實作，住在
`src/checkup/components/freecheckup/**`（約 10k 行、30 個檔）與 `src/pages/FreeCheckup.jsx`（3.6k 行）。

盤點結果（`node scripts/moduleBoundaries.mjs` 對這批檔案完全沉默）：

| 事實 | 數字 |
| --- | --- |
| `freecheckup/**` 被任何模組 barrel 擁有 | 0 個檔 |
| `freecheckup/**` import 五模組 barrel 或其實作 | 0 次（完全平行的第二套實作） |
| shell（`FreeCheckup.jsx`）深挖 tab 實作 | 10 次 lazy import |
| 模組側（`useHoldingDetailViewModel`）反向深挖 freecheckup | 1 次 |

也就是說：**同一個領域（持倉／收盤／事件／交易／研究）有兩套 UI，其中一套完全不受邊界守衛管轄。**
C2 的 `_priceN` ReferenceError、C5 的 PDF 白名單漏接，都是在這塊治外法權裡發生、且守衛不會出聲的事故。

## 決策

**不新增第六個模組。** freecheckup 依領域併入既有五模組，成為每個模組的第二個對外表面（free surface）。

### 1. 擁有權映射（由 barrel re-export 自動生效）

| 模組 | 併入的 freecheckup 檔 |
| --- | --- |
| M1 Holdings | `HoldingsTab`、`HoldingCard`、`HoldingsDetailPanel`、`HoldingsWorkbench`、`HoldingsHero`、`HoldingsSectorSummary`、`HoldingsFilterBar`、`HoldingsFooterBar`、`HoldingsQuotaMeter`、`HoldingsEmptyState`、`HoldingsNoMatchState`、`HoldingsActionPriority`、`HoldingsReversalSection`、`HoldingsUploadSummary`、`HoldingExportCard`、`HoldingMetaReportModal`、`ChipsSection`、`ChipsTrendChart`、`bsrHeaderLabel`、`holdingScenario` |
| M2 Closing | `DailyTab`、`NewsTab`、`NewsEventRow` |
| M3 Events | `EventsTab` |
| M4 TradeIO | `TradeTab`、`LogTab`、`TradeUploadModal`、`BatchParsePanel` |
| M5 Research | `ResearchTab` |

實體檔案**不搬家**（搬 10k 行會炸掉所有 e2e 快照與 harness 入口）；擁有權一律靠 barrel re-export 宣告，
與 ADR-0001 的推導機制完全一致，不維護第二份清單。

### 2. Shell 不是模組

`src/pages/FreeCheckup.jsx` 與 `src/pages/_freeCheckup/**` 是 **shell**：它只負責路由、tab 切換、
配額與 demo 狀態，**只能 import barrel**，禁止再深挖 tab 實作。
`OnboardingOverlay`、`DemoFooterHint` 屬於 shell 自己的 UI，留在 shell 擁有權外，不歸任何模組。

### 3. Free surface 是次級 barrel，保住 code splitting

主 barrel（`@/checkup/modules/holdings`）是同步 re-export，若把 tab 塞進去，
`FreeCheckup.jsx` 的七個 lazy chunk 會被合併成一包，首屏直接倒退。

因此每個模組多開一個**次級 barrel**，路徑本身就是介面的一部分：

```
@/checkup/modules/<m>          ← 既有：路由頁 + hook + emit helper
@/checkup/modules/<m>/free     ← 新增：免費版單頁的表面（tab 與其專屬元件）
```

shell 端保持 lazy：

```js
const HoldingsTab = lazy(() =>
  import('@/checkup/modules/holdings/free').then((m) => ({ default: m.HoldingsTab })),
);
```

`<m>/free` 由守衛視為該模組的合法對外入口（等同 barrel），深挖 `<m>/free/` 底下仍然違規。

### 4. 共享層：`_validateProps` 與 `_ui`

盤點顯示 freecheckup 內部的跨領域耦合只有兩處：

- `_validateProps`（10 個檔共用的 props schema 斷言）→ 上升為**無主共享層** `src/checkup/lib/validateProps`，任何模組可 import，禁止反向 import 模組。
- `_ui/*`（`ActionBadge`、`PriceTrack`、`ReturnBar`、`SectionRule`）→ 只有 Holdings 使用，直接歸 M1，不上升。
  `_ui/holdingCard/**` 同樣歸 M1。

### 5. 唯一的手足違規：HoldingsTab → BatchParsePanel

`HoldingsTab`（M1）目前直接 import `BatchParsePanel`（M4）。
解法不是加例外，而是**槽位注入**：shell 把 `batchParseSlot` 當 prop 傳給 `HoldingsTab`，
由 shell 決定放哪個模組的元件。這符合 ADR-0001「跨模組只走三條路」中「由上層編排」的精神。

### 6. 反向依賴：`useHoldingDetailViewModel` → `holdingScenario`

兩者都歸 M1，收編後自動合法，不需改 import。

### 7. 守衛擴充（R5）

`scripts/moduleBoundaries.mjs` 新增一條規則，三處（ESLint / Vitest / CI）同步生效：

> **R5 free surface 收斂**：`src/checkup/components/freecheckup/**` 的檔案必須被某個模組 barrel 擁有；
> 模組外部（含 shell、harness 入口）不得直接 import 這些實作檔，只能走 `@/checkup/modules/<m>/free`。

例外清單只有兩類，且寫死在守衛裡：
- `src/pages/*HarnessEntry.tsx`（視覺 harness，不進 production bundle）
- `src/test/**`（既有 ignore 規則）

## 介面設計

```ts
// src/checkup/modules/holdings/free.ts —— M1 的 free surface（其餘四模組同型）
export { default as HoldingsTab } from '../../components/freecheckup/HoldingsTab';
export { HoldingCard } from '../../components/freecheckup/HoldingCard';
export { HoldingsDetailPanel } from '../../components/freecheckup/HoldingsDetailPanel';
// …M1 擁有的其餘 freecheckup 元件
```

介面契約（呼叫端必須知道的事，不只型別）：

1. **只有 shell 會用它。** free surface 服務單頁免費版；路由版仍走主 barrel 的 `HoldingsPage`。
2. **一律 lazy import。** 直接同步 import `<m>/free` 會破壞首屏切包，守衛不擋但 review 會擋。
3. **tab 元件是受控元件**：狀態（持倉清單、配額、demo 旗標）由 shell 持有並以 props 注入，
   tab 內部不得自建跨領域狀態；跨領域互動走 Shell Event Bus。
4. **後端存取一律走 Gateway（ADR-0004）**，free surface 不改變這條規則。

## 遷移階段

| 階段 | 內容 | 驗收 |
| --- | --- | --- |
| S1 | 建立五個 `free.ts` 次級 barrel + 共享層 `validateProps`；shell 改用 barrel lazy import | 既有 e2e 全綠、bundle 切包數不變 |
| S2 | `HoldingsTab` 的 `BatchParsePanel` 改槽位注入 | 新增 R1 反向測試不再需要例外 |
| S3 | 守衛加上 R5 + 合成違規反向測試，CI 硬擋 | `npm run check:module-boundaries` 對 freecheckup 有輸出能力 |

## 替代方案

- **新增 M6 `freeCheckup` 模組**：一行 barrel 就收編完，但等於承認「同一領域兩套實作各自為政」，
  持倉的 bug 仍然要在兩個模組間追。否決。
- **實體搬檔到各模組目錄**：邊界最直觀，但要改動 30 個檔的路徑、全部 e2e 快照與 4 個 harness 入口，
  風險與收益不成比例。擁有權用 barrel 宣告即可，不需要目錄一致。
- **刪掉 free 版、共用路由版元件**：長期正解，但免費版與登入版的配額／demo／SEO 行為差異太大，
  不是一次重構能收斂的。留待 free/paid 行為差異先以 props 收斂後再議。

## 後果

- 五模組各多一個對外入口，模組介面從「一個 barrel」變成「兩個 barrel」——這是為了 code splitting 付的明確代價，寫進本 ADR 以免下次有人「順手合併」。
- shell 變成明確的編排層，往後 free/paid 差異只能在 shell 或 props 上表達，不能在 tab 內偷偷分叉。
- freecheckup 內任何新檔若沒被 barrel 認領，CI 會直接紅燈，治外法權關閉。
