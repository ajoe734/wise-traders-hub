# Plan：HoldingCardFooter A11y — badge/srcTitle 可讀性

## 元件修正（`HoldingCardFooter.tsx`）

Footer 目前僅在 badge 上掛 `title`，螢幕閱讀器（SR）大多不會朗讀 `title` → 補上 `aria-label` 讓報價來源 / 錯誤能被讀出。同時把「用不到卻會被 SR 讀出」的裝飾字消音。

1. **srcBadge**（`priceSource` 有值時渲染）
   - 現況：`<span title={srcTitle} style={srcBadge}>{srcLabel}</span>`
   - 改為：加 `role="img"` + `aria-label={\`報價來源：${srcTitle}\`}`；保留 `title`。
   - 理由：`aria-label` 覆寫可見文字（原為簡短 label 例如「即時」），SR 讀完整 `srcTitle`（含更新時間、昨收、現價）；`role="img"` 讓 SR 把它視為單一原子節點，不會把內文的簡稱再讀一次。

2. **errBadge**（`priceError && !srcLabel`）
   - 加 `role="img"` + `aria-label={\`報價錯誤：${h.priceError}\`}`；保留可見文字「失敗」與 `title`。

3. **兩個「—」dash placeholder**（`todayNode` 缺 pnl、`valueStr` 缺 value）
   - 目前是純文字「—」，SR 會唸「破折號」→ 補 `aria-label="無資料"` 於外層 span。
   - 為避免 today wrapper 重讀外層 label，只在 `hasToday=false` 的 today span 加 `aria-label`；`valueStr` 為 '—' 時加 `aria-label`。

4. **VALUE / TODAY header cells**：保持純文字（本身就是 label），不動。

## 測試（新增）`HoldingCardFooter.a11y.test.tsx`

**Case 矩陣 — badge aria 分流（10 case）**

| # | 情境                                       | 斷言                                                                                                          |
|---|-------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| 1 | `priceSource='live'`                       | 有一個 `role="img"` badge，`aria-label` 開頭 `報價來源：`，包含 `來源：即時`、`更新於`、`昨收 99.00`、`現價 100.50` |
| 2 | `priceSource='screenshot'`                 | `aria-label` 含 `來源：截圖（screenshot）`                                                                    |
| 3 | `priceSource='demo'`                       | `aria-label` 含 `來源：DEMO（demo）`                                                                          |
| 4 | `priceSource='yclose'`                     | `aria-label` 含 `來源：昨收（yclose）`                                                                        |
| 5 | `priceSource=null, priceError='報價逾時'`  | errBadge 存在、text=`失敗`、`aria-label='報價錯誤：報價逾時'`；srcBadge 不存在                                 |
| 6 | `priceSource=null, priceError=null`        | srcBadge 與 errBadge 皆不存在                                                                                 |
| 7 | `priceSource='live'` + `priceError='X'`    | srcTitle 首行為 `報價問題：X`；`aria-label` 開頭 `報價來源：報價問題：X`（errBadge 不出現，因 srcLabel 存在） |
| 8 | `variant='ink'` + `priceSource='live'`     | 同 #1 aria 內容；額外驗 `role="img"` 屬性沒被 ink 樣式覆蓋                                                    |
| 9 | `variant='ink'` + `priceError, no source`  | ink errBadge `aria-label='報價錯誤：網路錯誤'`                                                                |
| 10 | `priceSource='live'` 無 `priceUpdatedAt` / `yesterday`（皆缺） | `aria-label` 不含 `更新於`、`昨收`，仍含 `來源：即時（live）` 與 `現價` |

**Case 矩陣 — 「—」placeholder aria（4 case）**

| # | 情境                          | 斷言                                                    |
|---|-------------------------------|---------------------------------------------------------|
| 11 | `hasToday=false`              | today span textContent='—'、`aria-label='無資料'`       |
| 12 | `hasToday=true, todayPnlNum=null, todayPctNum=null` | today span textContent 含 '—'，不強制 aria-label（wrapper 內是動態片段） |
| 13 | `h.value=null`                | value span textContent='—'、`aria-label='無資料'`       |
| 14 | `h.value=123456`              | value span 無 `aria-label`（避免多餘朗讀）             |

**Case 矩陣 — 結構守門（3 case）**

| # | 情境                | 斷言                                                                          |
|---|--------------------|-------------------------------------------------------------------------------|
| 15 | 任一 badge 存在時   | 該 badge 無 `aria-hidden`（不能被隱藏；違反會 fail）                          |
| 16 | 全部情境（loop）    | Footer 根 `.wb-bottom` 無 `aria-hidden="true"`                                |
| 17 | TODAY / VALUE label | 兩者以純文字出現在 DOM，`textContent` 可被 `getByText` 找到（`exact:true`）    |

實作用 `render()` + `container.querySelector`；aria 斷言用 `getAttribute('aria-label')` 對正則。

## 對既有測試影響

- `HoldingCardFooter.snapshot.test.tsx` 剛跑過的 12 個 inline snapshot **會全部因新增 `aria-label`/`role` 屬性而 diff** → 同步用 `-u` 重生。
- `HoldingCardFooter.test.tsx` / `HoldingCardFooter.derived.test.tsx` 檢查 textContent 與 title 的既有斷言不受影響（本次不移除任何 title / 可見文字）。

## 驗收

```
bunx vitest run \
  src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCardFooter.a11y.test.tsx \
  src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCardFooter.snapshot.test.tsx \
  src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCardFooter.test.tsx \
  src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCardFooter.derived.test.tsx
```
先 `-u` 重生 snapshot，再無 `-u` 二跑 → 全綠。

## 非目標
- 不動 PriceTrack / Header（本次僅 Footer）。
- 不加 axe-core（既有測試環境未安裝；用細粒度 aria 斷言足以）。
- Playwright e2e 不動（既有 sparkline aria / roi aria 已覆蓋 Header 端）。
