# VALUATION_THREE_RULERS_PLAN_V1（唯讀盤點 + 分階段計畫）

HEAD `a563fa5548e9d7ef0297187839849576bb4ac562`，git status clean。本輪未改 code、未改 DB、未 deploy/Publish。

## A. 六項資料來源實況

| 資料 | 目前真實來源 | 頻率 | 覆蓋率 | 判定 |
|---|---|---|---|---|
| 最新收盤價 | `current_prices`（ADR-0002 權威價；前台走 `src/checkup/lib/priceResolver.ts`） | 台股 14:05 同步 | 183 檔、最後更新 2026-09-19 00:01Z | **DONE** |
| TTM EPS | 無。`stock_fundamentals` 只有 `dataset='monthly_revenue'`，18 列／3 檔；`backfill-worker/index.ts:395-419` 支援 `financial_statements` 但正式庫 0 列 | — | 0% | **MISSING** |
| BVPS | 無任何資產負債表資料 | — | 0% | **MISSING** |
| LTM 現金股利 | 無。只有 `checkup-mops-announcements/index.ts:14` 把公告標題分類成 `dividend`，不含金額 | — | 0% | **MISSING** |
| 5 年歷史序列 | 無估值序列。`daily_price_snapshots` 只有價量 | — | 0% | **MISSING** |
| 產業分類 | `src/checkup/lib/stockMetaMulti.js`：overrides > `stockIndustry.json`(5 檔) > seedData > `twsePrimaryIndustry.json` > `twseSecondaryIndustry.json`（FinMind，2530 檔） | 手動 script 重跑 | 上市櫃近全覆蓋 | **DONE** |
| 同業名單 | 無。沒有任何 peer set 或 peer RPC | — | 0% | **MISSING** |

已驗證可用的外部來源（本輪唯讀實測）：

- **FinMind `TaiwanStockPER`**：逐日 `PER / PBR / dividend_yield`，含上櫃（6274 實測有值，資料到 2026-09-18），且有 5 年以上歷史（3443 回測 2021-09 成功）。專案已有 FinMind sponsor token 與 `finmind_quota_pools` 節流。→ **主來源**。
- **TWSE `openapi/v1/exchangeReport/BWIBBU_ALL`**：1078 檔上市、免 token、每日一筆，欄位 `PEratio/PBratio/DividendYield`（2330 PE 28.52／PB 9.92／殖利率 0.89）。→ **上市 parity 對帳來源**，不做歷史。
- TPEx openapi peratio 端點目前回 520，**不採用**。

註：三把尺改採「交易所已公告的 PER/PBR/殖利率」而非自行用 EPS/BVPS/股利重算。理由：原料（EPS、BVPS、股利）在正式庫是 0 覆蓋，自建需三條新 ingest 管線與會計期對齊；交易所口徑本身就是 TTM EPS / 最新 BVPS / 近 12 月現金股利，且可被 TWSE 官方數字逐檔對帳。公式與 as-of 仍完整揭露。

## B. 「抓不到資料」的根因（與 BSR 無關）

1. **缺 ingest**：`stock_fundamentals` 只跑過 monthly_revenue，`financial_statements` 從未排程；估值三欄位根本沒有任何 writer。→ 主因。
2. **缺 schema**：沒有估值時間序列表，因此無從算 5 年分位。
3. **缺 consumer 接線**：`holdingDetailViewModel.ts` 的 `deriveValuation()`（:37）算的是持股市值/權重/損益，**不是**估值倍數；抽屜零估值欄位。
4. **非權限、非 cache 問題**：`stock_fundamentals` 已有 GRANT 與 RLS（migration 20260726110032:73-86，僅 admin/service 可讀，一般會員讀不到——若要前台直讀需新表另開 policy）。
5. **BSR 的障礙是另一回事**：券商分點走 FinMind per-stock 佇列與熔斷（`ChipsSection.tsx:531-756`），與估值資料完全不同管線，不得混談。

## C. 既有可重用元件／公式

- 估值公式：**MISSING**。全庫沒有 price/eps、price/book 之類運算。`dataUtils.js:364`、`dailyAnalysisRuntime.js:35`、`brainRuntime.js:593` 出現的「本益比／PBR／殖利率」全是 LLM prompt 字串或關鍵字標籤；`demoData.js:188` 是 demo 假句。
- 可重用：`stockMetaMulti.js`（產業）、`priceResolver` / 權威價鏡像、`getCheckupGateway()` seam、`freshness.ts`（as-of/STALE）、`useChipsLifecycle` 的 loading/stale/partial/error 呈現模式、harness host gate 與 network hard-block。

## D. 三個真實案例（以 2026-09-18 TWSE 官方值為 input）

| 案例 | 輸入 | 期望輸出 |
|---|---|---|
| 3443 創意（正常獲利、高倍數） | PE 183.29／PB 71.16／殖利率 0.28%，產業「IC設計」 | 三尺皆有值；與自身 5 年分位比對後標「偏高／合理／偏低」；總結如「2 把偏高、1 把合理｜整體估值偏高」 |
| 1101 台泥（PE 缺值＝近四季無獲利） | PEratio 空字串、PB 0.79、殖利率 3.29% | P/E 顯示「不適用（近四季無獲利）」，**不得補 0**；總結只用有效的 2 把尺，並標「本益比不適用」 |
| 2882 國泰金（金融股） | PE 13.03／PB 1.59／殖利率 3.17%，產業「金融保險」 | 三尺照常顯示，但同業比較只與金融保險同業比，並標註「金融股以 P/B 與殖利率為主，P/E 受一次性損益影響」 |

TWSE BWIBBU_ALL 全 1078 檔中 209 檔 PE 為空，「不適用」是常態路徑，不是邊界案例。

## E. 規則定案（提議，未硬寫）

- 分位門檻：產品內無既有規則 → 採 `<=30%` 偏低、`30–70%` 合理、`>=70%` 偏高。分位取個股自身近 5 年逐日序列（殖利率方向相反：高殖利率＝便宜）。樣本 < 250 交易日標「資料不足」。
- 總結：三尺各自 low/fair/high/na 計票，多數決；平手取「合理」；有效尺 < 2 時只顯示「資料不足」。不出現買賣字眼。
- 同業：同 `primaryIndustry`（`stockMetaMulti`）且當日有值者為母體；排除分母無效（PE 空、PB<=0、殖利率 0 視為「無配息」另計）；中位數前做 5%/95% winsorize；n < 3 時不顯示中位數，改標「同業樣本不足（n=x）」；保留 n 與 as-of。溢折價 = (個股值 ÷ 同業中位數 − 1)，顯示到小數 1 位。最近同業 3 家依倍數距離排序，其餘收在展開抽屜。跨市場（上市／上櫃）不混算；不同財報期以「交易所公告日」對齊，同一 as-of 日才納入。

## F. 版面

- `ChipsSection` 的 BSR 區塊（`ChipsSection.tsx:584-753`）降級成單行 data-quality badge，細節移入既有展開區。
- 新區塊順序：三把尺 3 欄卡片 → 一行總結 → 一行同業中位數比較 →（可展開）同業名單。
- 桌機在現有抽屜寬度內；新增高度 ≤ 現有主要資訊區 1.5 倍。手機 ≤640px 三欄極簡（數字 + 文字標籤），沿用 `holdingsDetailPanel.css` 的 `min-width:0 / overflow-wrap:anywhere` 硬合約。
- 顏色不單獨承載意義：每格都有「偏低／合理／偏高／不適用／資料不足」文字。
- 狀態：skeleton／error(可重試)／stale(顯示 as-of 與「資料較舊」)／partial(部分尺不適用)。

## G. 分階段

1. **S1 資料層（產出檔案，不套用）**：migration 建 `tw_valuation_daily(symbol, trade_date, per, pbr, dividend_yield, market, source, fetched_at)`，UNIQUE(symbol, trade_date)、GRANT authenticated SELECT + service_role ALL、RLS 公開讀、index(symbol, trade_date DESC)；RPC `valuation_snapshot(symbol)` 回傳目前值 + 5 年分位 + 同業中位數 + n + as-of。
2. **S2 ingest（產出檔案，不 deploy）**：edge function `valuation-sync`（FinMind TaiwanStockPER，走 `_shared/retryFetch.ts` 與 quota pool），日更 + 5 年回補；TWSE BWIBBU_ALL 每日 parity 對帳寫 `data_source_health`。
3. **S3 純函式**：`src/checkup/lib/valuationRulers.ts`（分位、分級、總結、winsorize、中位數、溢折價）+ 固定 vectors 合約檔。
4. **S4 UI**：`ValuationRulers.tsx` / `PeerComparisonRow.tsx`，掛進 `HoldingsDetailPanel.tsx:467` 前；BSR badge 降級；由 `holdings/free.ts` 認領（R5）。
5. **S5 harness**：`/e2e/valuation-rulers-harness`，marker `VALUATION_RULERS_V1`，fake gateway + network hard-block + host gate，`mutation_calls=0`。
6. **S6 驗收**：公式單元測試（含負 EPS／PB<=0／零股利／極端值／同業不足／跨 tenant）、consumer integration、1440/1024/390 RWD spec、tsgo、check:module-boundaries、build。fresh Hosted Preview 通過前不 Publish、不 deploy、不套 migration、不寫正式 DB。

VALUATION_THREE_RULERS_PLAN_READY
