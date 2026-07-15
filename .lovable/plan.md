# Plan：擴充 sparkline / ROI 的 demo × real 雙模式 E2E 驗證

## 目標
在自由檢查頁（`/holding-checkup`）新增一支 Playwright 回歸，證明「**同一筆持倉在 demo 模式與登入後真實資料模式下，Header 派生出的字串（ROI %、aria-label、pctSign）與顏色（sparkColor / sparkOpacity / variant 對應）在 DOM 上完全一致**」，避免未來調 seed 或改 backfill 時，兩條路徑的派生分支發生漂移。

## 新增檔案
- `e2e/freecheckup-sparkline-roi-mode-parity.spec.ts`

## 測試設計

### 共用 fixture
沿用既有 `e2e/freecheckup-sparkline-signs.spec.ts` 的 IntersectionObserver stub 與 `navigateAndWaitForCardReady` helper，抽出到本檔頂部（不動舊檔）：
- `bootDemo(page)`：`localStorage['checkup-demo-mode']='1'`、跳過 intro 影片。
- `bootReal(page)`：注入受管理 Supabase session（依 `LOVABLE_BROWSER_AUTH_STATUS`），並在導頁前把 demo seed 以 RPC / 直寫 `trade_records` 方式建立為使用者資料；若 `AUTH_STATUS !== 'injected'` 則 `test.skip`。

### 資料收集器
複用 `collect(page)` 邏輯，回傳每張卡的：
`{ code, isFeature, variantAttr, ariaLabel, roiText, sparkSign, sparkColor, sparkOpacity, pnlText, pnlSubText }`。
key 用 `data-code`（若無則從 `.wb-code` 讀）確保兩模式可對齊。

### Case 1 — Demo baseline 白名單
執行 `bootDemo` → 收集全部卡：
- `sparkColor ∈ {#ff4d1f, #9b968d, #f4f1ec}`
- `sparkOpacity ∈ {0.85, 0.55, 0.6}`
- `sparkSign ∈ {"1","-1"}`
- 每卡 `signFromAriaLabel === signFromRoiText`

### Case 2 — Real baseline 白名單
`bootReal` → 相同斷言（防呆：真實資料路徑不會意外冒出第四種顏色 / 透明度）。

### Case 3 — Demo × Real 逐卡 parity（核心）
兩次 run 用相同 seed（DEMO_HOLDING_LOOKUP），以 `code` 對齊後逐卡比對：
- `variantAttr`、`sparkSign`、`sparkColor`、`sparkOpacity` 全等
- `roiText.trim()`、`pnlText.trim()`、`pnlSubText.trim()`、`aria-label` 的 `報酬率 ±X.XX%` 片段字面全等
- `isFeature` flag 一致（feature 卡策略在兩模式應一致）

### Case 4 — 跨零守門
篩出 `pctSign=+1` 與 `-1` 各至少一張，斷言兩組 `sparkColor` / `sparkOpacity` 相異；兩模式各自跑一次。

### Case 5 — Feature (ink) 卡專屬
ink 卡在兩模式都必須 `sparkColor==='#f4f1ec'`，正號 opacity=0.85、負號 0.6。

## 執行環境備註
- viewport `390×844`
- 若 `AUTH_STATUS='signed_out' | 'external_unmanaged' | 'no_supabase'`：Case 2/3 `test.skip` 並印訊息；Case 1/4/5 仍跑。
- 不新增 npm 套件；不動 `playwright.config.ts`（既有 setup 已涵蓋）。
- 不改任何應用碼；`data-spark-*` 屬性已在 `HoldingCardHeader.tsx` line 101 附近就緒。

## 交付驗收
`bunx playwright test e2e/freecheckup-sparkline-roi-mode-parity.spec.ts` 於 injected session 下全綠；於 signed_out 環境下 Case 2/3 顯示 skipped、其餘綠。
