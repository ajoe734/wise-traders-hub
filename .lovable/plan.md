# Phase 7 — 價格權威單一化（TDD 根因修復）

## 為什麼還沒真的修完

Phase 3 只把 DB-first 覆蓋層（`useAuthoritativePrices`）套在 `useRoutePortfolioRuntime` 的 `holdings` 上。經檢查，仍有多個消費端**直接讀 legacy TWSE / LocalStorage 快取 `marketPriceCache`**，因此同一畫面會出現兩套價格：

| 消費端 | 檔案 | 目前取價來源 |
|---|---|---|
| 總覽頁（多組合彙總） | `src/checkup/hooks/useRouteOverviewPage.js:16-23` | `readRouteMarketState().marketPriceCache` |
| 投組摘要卡 | `src/checkup/hooks/useRoutePortfolioRuntime.js:676` | `buildPortfolioSummariesFromStorage({ marketPriceCache })` |
| 持倉正規化 | `useRoutePortfolioRuntime.js:195` | `normalizeHoldings(value, marketPriceCache?.prices)` |
| 壓力測試 | `useStressTestWorkflow.js:52` | `getMarketQuotesForCodes`（TWSE 抓取） |
| 事件生命週期 | `useEventLifecycleSync.js:39` | 同上 |
| 每日分析／收盤分析 | `useDailyAnalysisWorkflow.js:142,594` | 同上 |
| Store selector | `marketStore.js:34-40` | `marketPriceCache.prices[code]` |

`useMarketData.js` 的 `fetchPostCloseQuotes` 目前仍是**線上主路徑**（`syncPostClosePrices` 直打 TWSE MIS 並寫回 holdings），與計畫書寫的「fallback-only」不符——這是收盤價對不上的殘留根因。

另有一項待處理：`us-option-price-sync` 有 7 腿 `not_in_chain`，目前靜默略過，UI 只會顯示 `stale` 而無原因。

## 目標

**單一取價入口**：全部走 `useAuthoritativePrices`／同一個 resolver，legacy TWSE 快取降級為純離線 fallback，且任何路徑都不得再寫回 holdings 價格。

## 作法（TDD，先紅後綠）

### Step 1 — 建立唯一 resolver（先寫測試）
新增 `src/checkup/lib/priceResolver.ts` + `__tests__/priceResolver.test.ts`：
- `resolvePrice(row, { authoritative, offlineCache, online })`，優先序 snapshot > current > combo > offline > stale。
- 測試鎖：online 時**永遠不得**回傳 LocalStorage 值；stale 需帶 `reason`。
- `useAuthoritativePrices` 的 `combineAuthoritativePrices` 改為呼叫此 resolver（行為不變，既有 9 條測試須維持綠燈）。

### Step 2 — 總覽頁與摘要卡改走權威價（先寫測試）
- 新增 `src/test/unit/overview-price-authority.test.ts`：給定 snapshot 價 ≠ LocalStorage 價，`buildOverviewRuntimeData` / `buildPortfolioSummariesFromStorage` 必須輸出 snapshot 價。
- 改 `useRouteOverviewPage.js`、`useRoutePortfolioRuntime.js:676`：以權威價 map 取代 `marketPriceCache.prices`，離線時才回退。

### Step 3 — 拔除 TWSE 主路徑（先寫測試）
- 新增 `src/test/unit/useMarketData-fallback-only.test.ts`：`navigator.onLine=true` 時呼叫 `syncPostClosePrices` **不得** fetch `API_ENDPOINTS.TWSE`；offline 才允許。
- 改 `useMarketData.js`：`syncPostClosePrices` 加線上閘門，改為觸發權威層重抓；`fetchPostCloseQuotes` 僅離線使用。
- `getMarketQuotesForCodes` 改為讀 `daily_price_snapshots` / `current_prices`，讓壓力測試、事件同步、每日分析三個 workflow 自動吃到權威價（不改它們的呼叫簽名）。

### Step 4 — Store selector 收斂
`marketStore.js` 的 `getPrice/getQuote` 加上權威層優先，並補 store contract 測試（沿用 `src/test/unit/checkup-stores-contract.test.ts`）。

### Step 5 — `not_in_chain` 可觀測化
- Deno 測試：不在鏈上的腿必須寫入 `price_parity_events`（`kind='option_leg_not_in_chain'`），而非靜默略過。
- `us-option-price-sync/index.ts` 回傳 `skipped` 明細；`PriceParityCard.tsx` 增列該類事件計數。

### Step 6 — E2E 擴充
`e2e/holdings-price-parity.spec.ts` 追加：
- 總覽頁情境：mock snapshot 價，斷言畫面顯示的是 snapshot 而非 seeded LocalStorage 價。
- 線上情境：斷言**沒有**對 TWSE MIS proxy 的請求。

### Step 7 — 文件同步
更新 `docs/architecture/price-authority.md`（新增「單一 resolver 契約」與「禁止直接讀 marketPriceCache」守則）與 `.lovable/plan.md`（Phase 7 表格），刪除已過期的 Phase 2b/3 規格草稿段落。

## 驗收標準

- 全域搜尋：`src/` 中除 `useMarketData.js`（offline 分支）與測試外，不得再有 `marketPriceCache?.prices` 直接取價。
- `bunx vitest run`：既有 19 條價格測試 + 新增 Step 1–4 測試全綠。
- `bunx playwright test --project=holdings-price-parity`：4 tests pass。
- Deno：`us-option-price-sync` 測試全綠（含新 skipped 契約）。

## 不可觸碰

`src/integrations/supabase/{client,types}.ts`、`.env`、`supabase/config.toml`；`FreeCheckup.jsx` Hero 與 RWD 斷點（僅換價格來源，改動時須跑手機回歸清單）。
