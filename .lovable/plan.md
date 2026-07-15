# Plan：跨寬度 sparkline 截圖快照 + pctSign / sparkOpacity 一致性回歸

## 目標
針對 demo 模式的 `/holding-checkup` 持倉卡，在多個 viewport 寬度下：
1. 對 `.wb-spark` 元素做逐卡 element screenshot 快照比對，作為視覺回歸基線。
2. 以 DOM 屬性斷言：**同一 code 卡在所有寬度下，`data-spark-sign` 與 `data-spark-opacity` 完全一致**（跨零 sign 分流結果不應被排版寬度影響）。

## 新增檔案
- `e2e/freecheckup-sparkline-width-parity.spec.ts`
- 快照目錄自動生成：`e2e/freecheckup-sparkline-width-parity.spec.ts-snapshots/`

## Viewport 矩陣
建立 3 個新 Playwright project（覆蓋窄／中／寬三段）：
- `sparkline-width-390`  → 390×844（iPhone 14/15 基準）
- `sparkline-width-768`  → 768×1024（iPad 直立，中寬）
- `sparkline-width-1280` → 1280×900（桌面寬）

三者共用同一支 spec，`testMatch: /freecheckup-sparkline-width-parity\.spec\.ts/`。

## 測試設計

### 共用 boot
沿用 `freecheckup-sparkline-signs.spec.ts` 的 IntersectionObserver stub、`?demo=1`、`lf_force_demo`、`holdings-intro-video-seen-v2`，導向 `/holding-checkup` 並等 `.wb-spark` 出現。

### Case A — 逐卡 element screenshot 快照（每個 project 各存一份）
```ts
const cards = await page.locator('.holdings-card-grid .wb-card').all();
for (const card of cards) {
  const code = await card.getAttribute('data-code') || <fallback 取第一個 4-6 位數字 span>;
  const spark = card.locator('.wb-spark');
  await expect(spark).toHaveScreenshot(`spark-${code}.png`, {
    maxDiffPixelRatio: 0.02,
    animations: 'disabled',
  });
}
```
Playwright 會自動以 project name 分資料夾，所以同一 code 在 390 / 768 / 1280 各有一張獨立基線，允許排版差異但守住渲染細節。

### Case B — DOM 屬性跨寬度 parity（在單一 project 內以 setViewportSize 逐一切換）
```ts
const widths = [390, 768, 1280];
const collected: Record<number, Sample[]> = {};
for (const w of widths) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForFunction(...);   // .wb-spark 存在
  collected[w] = await collectByCode(page);
}
// 以 390 為基準，其餘寬度逐 code 比對 sparkSign / sparkOpacity / variantAttr
```
此案不做截圖，只驗屬性。放在 `sparkline-width-390` project 內執行一次即可（`test.skip` 其他 project），避免重複 3 遍。

### Case C — 跨零守門（每寬度必存正負樣本，且屬性白名單）
每個 project 各跑一次：
- `sparkSign ∈ {"1","-1"}`
- `sparkOpacity ∈ {"0.85","0.55","0.6"}`
- `sparkColor ∈ {"#ff4d1f","#9b968d","#f4f1ec"}`
- 至少 1 張正、1 張負；正負兩群 opacity 集合不完全重疊

## `playwright.config.ts` 變更
新增 3 個 project 條目（緊接現有 `iphone-390-sparkline` 之後），各設 `testMatch` 與 viewport；不動全域 `expect.toHaveScreenshot` 設定（maxDiffPixelRatio 0.01 已足夠，個別 case 可 override 到 0.02 吸收字型 subpixel）。

## 快照基線生成
首次執行：
```
bunx playwright test --project=sparkline-width-390 --update-snapshots
bunx playwright test --project=sparkline-width-768 --update-snapshots
bunx playwright test --project=sparkline-width-1280 --update-snapshots
```
之後正式跑三個 project 應全綠。

## 不做的事
- 不改任何 app 程式（`HoldingCardHeader.tsx` 的 `data-spark-*` 已就緒）。
- 不加 real-mode（那由既有 `-roi-mode-parity` spec 覆蓋，避免重工）。
- 不改全域截圖 tolerance。

## 驗收
```
bunx playwright test --project=sparkline-width-390 \
                    --project=sparkline-width-768 \
                    --project=sparkline-width-1280 --reporter=list
```
三 project 全綠；DOM parity case 顯示逐 code 屬性在三寬度全等；快照基線納入版本管理。
