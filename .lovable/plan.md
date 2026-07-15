## 目標
用 Playwright 針對兩個元件的**純輸出字串**做跨正負／邊界值的完整回歸，鎖死 `costStr / priceStr / decText` 與 `srcTitle / srcBadge / errBadge / valueStr / tgtStr` 的合約，任何未預期的格式變動都要 fail。

## 為什麼不用現有 `/holding-checkup-demo` 路由
現有 demo 資料是**固定 fixture**，只能覆蓋一種 priceSource、一種 dec 長度、一組值。要覆蓋 null / 0 / 正 / 負 / 超長 / 各 priceSource / 各 priceError 組合，必須新增一個「以 URL 參數驅動 fixture」的隔離 harness。

## 新增檔案

### 1. `src/pages/HoldingCardHarnessEntry.tsx`（preview-only）
路由 `/e2e/holding-card-harness`，讀 `?d=<base64url-json>` → JSON.parse → 直接渲染兩個元件：

```
<HoldingCardPriceTrack h={fx.h} meta={fx.meta} dec={fx.dec}
  subColor="#1a1a1a" muteColor="#666" variant={fx.variant} />
<HoldingCardFooter h={fx.h} tp={fx.tp} upside={fx.upside}
  hasToday={fx.hasToday} todayPnlNum={fx.todayPnlNum} todayPctNum={fx.todayPctNum}
  variant={fx.variant} subColor="#1a1a1a" muteColor="#666"
  hairColor="#eee" lossColor="#c0392b" />
```

- 環境判斷（`import.meta.env.DEV || localhost || *.lovableproject.com || id-preview--*.lovable.app`）與 `HoldingCheckupDemoEntry` 一致；非 preview 環境回傳 `null`（避免 production 洩漏）。
- 頁面根 `<div id="harness-root">` 便於選取。
- URL 缺 `?d=` 或 JSON parse 失敗 → 顯示 `<pre>ERR: ...</pre>`（測試會斷言不能出現此節點）。
- 在 `App.tsx`（或 `src/main.tsx` route table，先讀取才決定）加 `<Route path="/e2e/holding-card-harness" element={<HoldingCardHarnessEntry />} />`，`lazy()` 引入避免影響主 bundle。

### 2. `e2e/helpers/holdingCardHarness.ts`
共用工具：`encodeFixture(fx)` → base64url、`navigateHarness(page, fx)` → `page.goto(\`/e2e/holding-card-harness?d=\${enc}\`)`、`readText(page, selector)` helper。

### 3. `e2e/holding-card-price-track-parity.spec.ts`
矩陣 case（每個 `test()` 一組 fixture），selector 用**純結構**避免動元件：
- `cost` cell: `page.locator('xpath=//span[text()="成本"]/following-sibling::span[1]')`
- `price` cell: `page.locator('xpath=//span[text()="現價"]/following-sibling::span[1]')`
- `dec` text: `page.locator('#harness-root > div').nth(1).locator('div')`

覆蓋範圍：
| 名稱 | h.cost | h.price | dec.actionText | meta.strategy | variant | 預期 |
|---|---|---|---|---|---|---|
| both null | null | null | null | null | normal | 成本`—` / 現價`—` / decText `''` |
| zero cost | 0 | 100 | null | 'A' | normal | 成本`0.00` / 現價`100.00` / decText `A`（40字內原文，此處長度3） |
| integer trunc | 12 | 12.345 | null | null | normal | 成本`12.00` / 現價`12.35`（四捨五入 toFixed） |
| large numbers | 1234567.891 | 999999.999 | null | null | normal | 成本`1234567.89` / 現價`1000000.00` |
| dec short | 100 | 110 | '短句' | null | normal | decText `短句` |
| dec exactly limit normal | 100 | 110 | 'X'.repeat(60) | null | normal | decText 原文 60 字 |
| dec over limit normal | 100 | 110 | 'X'.repeat(65) | null | normal | decText 以 `…` 結尾、長度 ≤ 60 |
| dec with punctuation break | 100 | 110 | `A。${'B'.repeat(80)}` | null | normal | 保留至第一個標點後 `…` |
| dec over limit ink | 100 | 110 | 'Y'.repeat(120) | null | ink | decText 以 `…` 結尾、長度 ≤ 90 |
| dec null fallback strategy normal | 100 | 110 | null | 'S'.repeat(60) | normal | decText `S`.repeat(40)（slice 40） |
| dec null fallback strategy ink | 100 | 110 | null | 'S'.repeat(120) | ink | decText 原文（ink 不裁切 strategy） |
| dec null no strategy ink | 100 | 110 | null | null | ink | decText `持續監控基本面與籌碼變動。` |

每個 case 用「測試中複寫一份 `truncateAction`」與元件一致，計算期望值後 strict equal — 元件邏輯變動即 fail。

### 4. `e2e/holding-card-footer-parity.spec.ts`
Selector 依 Footer 現有 aria/role/class，**不改元件**：
- srcBadge: `page.getByRole('img').filter({ hasText: /^(截圖|即時|最高|賣一|昨收|DEMO|收盤|已收K|TWSE|Yahoo)$/ })`
- errBadge: `page.getByRole('img', { name: /^報價錯誤：/ })`（也對應 hasText `失敗`）
- valueStr: `page.locator('.wb-bottom > span.wb-bottom-val').nth(1)`
- todayCell: `page.locator('.wb-bottom > span.wb-bottom-val').nth(0)`
- tgtStr: `valueStr.locator('span').last()` 且 textContent 以 `TGT ` 開頭

覆蓋範圍（每列一個 test）：

**srcLabel / srcTitle**
1. priceSource 為 `SRC_LABEL` 全部 10 key（screenshot/live/high/ask/yclose/demo/regularMarketPrice/previousClose/chartClose/twse/yahoo）→ 斷言 srcBadge 文字 = SRC_LABEL[key]、`title` 內含 `來源：{label}（{key}）`
2. priceSource 未知字串 `mystery` → srcBadge 文字 = `mystery`、title 含 `來源：mystery（mystery）`
3. priceSource null、無 priceError → 無 srcBadge、無 errBadge
4. srcTitle 拼接：`priceUpdatedAt` 給 `2026-07-15T04:30:00Z` → title 含 `更新於 HH:MM`（不寫死時區小時，只 assert `更新於 \d{2}:\d{2}` regex）
5. srcTitle 拼接：`yesterday=105.5` → title 含 `昨收 105.50`
6. srcTitle 拼接：`price=110.123` → title 含 `現價 110.12`
7. srcTitle 拼接：三者皆缺、只有 srcLabel → title 完全等於 `來源：即時（live）`
8. srcTitle 拼接：無 srcLabel 且無 priceError → title = `尚未同步即時報價`

**errBadge**
9. priceError='NET' 且 priceSource=null → srcBadge 不存在、errBadge 文字 `失敗`、title=`NET`、aria-label=`報價錯誤：NET`、srcTitle= `報價問題：NET`（透過 srcTitle 位置：Footer 上 title 屬性只掛在 srcBadge/errBadge，故用 errBadge title 驗證）
10. priceError='X' 且 priceSource='live' → 顯示 srcBadge（不顯示 errBadge），且 srcBadge.title 起首是 `報價問題：X`

**valueStr**
11. h.value=null → valueStr `—`、aria-label=`無資料`
12. h.value=0 → valueStr `0`、無 aria-label
13. h.value=1500000.5 → valueStr `1,500,000.5`（`toLocaleString`）
14. h.value=undefined → valueStr `—`

**tgtStr**
15. variant=ink, tp=200, upside=15.267 → tgtStr `TGT +15.3%`
16. variant=ink, tp=200, upside=-0.05 → tgtStr `TGT -0.1%`（toFixed(1) 四捨五入）
17. variant=ink, tp=200, upside=0 → tgtStr `TGT +0.0%`
18. variant=normal, tp=200, upside=15 → tgtStr 不存在（selector 找不到）
19. variant=ink, tp=null, upside=15 → tgtStr 不存在
20. variant=ink, tp=200, upside=null → tgtStr 不存在

**todayCell**
21. hasToday=false → textContent=`—`、aria-label=`無資料`
22. hasToday=true, todayPnlNum=1234, todayPctNum=2.567 → `+1,234+2.57%`
23. hasToday=true, todayPnlNum=-1234, todayPctNum=-2.567 → `-1,234-2.57%`
24. hasToday=true, todayPnlNum=0, todayPctNum=0 → `+0+0.00%`
25. hasToday=true, todayPnlNum=null, todayPctNum=5 → `—+5.00%`
26. hasToday=true, todayPnlNum=100, todayPctNum=null → `+100`（無百分比 span）

## 不動元件（守住現有 snapshot 合約）
- 不加 `data-testid`、不改 aria-label、不改 class name、不改樣式 → `HoldingCardFooter.snapshot.test.tsx` 12 個 inline snapshot 與 `HoldingCardFooter.a11y.test.tsx` 18 case 全部不受影響。
- PriceTrack 目前沒有 data-testid／class；用 xpath 找「成本／現價」sibling 是唯一穩定路徑，接受此輕微耦合。

## Playwright config
- 現有 `playwright.config.ts` 已含 `baseURL: http://localhost:8080` 與 chromium 專案。新增 spec 直接沿用，不加新 project。
- 兩個新 spec 都用 `test.describe.parallel` 加速。
- 不做 pixel screenshot；只做 `expect(locator).toHaveText(exact)` / `toHaveAttribute` 斷言，避免 flaky。

## Playwright 執行
```
bunx playwright test e2e/holding-card-price-track-parity.spec.ts e2e/holding-card-footer-parity.spec.ts
```
CI 加入 default matrix，本地手動驗證通過後回報。

## 驗證流程
1. 加 harness → 手動開 `/e2e/holding-card-harness?d=<encoded>` 目視確認可渲染
2. 跑 12 (PriceTrack) + 26 (Footer) = 38 案例，全綠
3. 故意在本地把 `truncateAction` 的 `limit` 改成 30 → PriceTrack case #6/#7/#9 應立即 fail（驗證測試真的能抓到回歸）
4. 復原改動 → 再跑一次全綠 → 完成
