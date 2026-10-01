# 持倉抽屜改版：三把尺換算成「歷史估值參考區間」，和目標價共用一條價格軸

## 盤點結果（已查證）

**資料**
- `tw_valuation_daily` 只有 `per / pbr / dividend_yield / source / trade_date`，**沒有 EPS、BVPS、每股股利、收盤價**。`stock_fundamentals` 裡 3443、2882 都是 0 筆。
- 同一天的收盤價放在 `daily_price_snapshots.close_price`，policy「Anyone can view snapshots」(SELECT, true)。3443 和 2882 在 2026-09-23（估值最新日）都有收盤價。
- 結論：基礎值只能用**同一天的收盤價 ÷ 比率反推**，不能拿今天的報價配 9/23 的比率。

| 代碼 | 估值日 | 收盤 | PER | PBR | 殖利率 | 5 年樣本 | 收盤資料最新 |
|---|---|---|---|---|---|---|---|
| 3443 創意 | 2026-09-23 | 8385 | 214.94 | 83.45 | 0.24% | 1208 | 2026-10-01 |
| 2882 國泰金 | 2026-09-23 | 111.5 | 13.15 | 1.61 | 3.14% | 1208 | 2026-09-30 |

- 樣本 1208 筆，高於 `MIN_HISTORY_SAMPLES=250`；PER/PBR/殖利率 5 年內都沒有缺值。目前估值資料比今天晚 8 天，`VALUATION_STALE_DAYS=7`，所以會被標成「資料較舊」。這是排程每週六才跑的結果，**不是**這次改版的缺口。
- `valuation_snapshot` RPC 目前回傳 `pe/pb/dividendYield/asOf/source/history{pe,pb,dividendYield}/peers/trend`，**不含收盤價**。

**程式**
- `HoldingsDetailPanel.tsx`：`PriceAxis`（L742）畫成本、現價、目標（`displayTarget`，來自 `avgTarget(h.code)` 和 `tpHistory`），L481 掛 `<ValuationRulers>` 三張卡。
- `valuationRulers.ts`：`computeRuler`、`summarizeRulers`、`quantile`、`isValidMultiple/isValidYield`，NA 規則有 missing、non_positive_denominator、no_dividend、insufficient_history。
- `useValuationSnapshot.ts`：透過 `getCheckupGateway().rpc` 取資料，只讀。

## 算法（新純函式 `buildValuationPriceBand`，放在 valuationRulers.ts）

輸入：asOf 比率、asOf 收盤價 `P0`（必須和 asOf 同一天）、5 年歷史陣列。

1. 基礎值：`EPS = P0/PER`、`BVPS = P0/PBR`、`DPS = P0 × 殖利率/100`。
2. 各尺都用既有 `computeRuler` 判斷 NA，NA 的尺不進入計算。
3. 各尺的價格界線（歷史分布用 `quantile` 取 0.3 / 0.7）：
   - P/E：`[EPS×q30, EPS×q70]`
   - P/B：`[BVPS×q30, BVPS×q70]`
   - 殖利率：`[DPS/(q70/100), DPS/(q30/100)]`（殖利率高對應價格低，所以上下界要反轉）
4. 合成：
   - 有效尺少於 2 → 不顯示區間，寫「資料不足：{原因}」。
   - 有效尺之間**有交集** → 主區間 = 交集 `[max(lo), min(hi)]`，標記 `consensus`。
   - **沒有交集** → 不給單一區間。主標改成「三把尺分歧，無共同區間」，軸上分別畫各尺的淡色細帶，標記 `divergent`。
   - 交集寬度小於中點的 3% 時一樣視為分歧，避免顯示假精確的「合理價」。
5. 同業中位數只放在「計算依據」，不納入區間。
6. 現價位置：`(現價 − Y)/Y` 高於區間，或 `(X − 現價)/X` 低於區間，否則顯示「區間內」。現價用 priceResolver 的權威價（ADR-0002），並標註「區間以 {asOf} 收盤換算」。
7. 金額取整：≥1000 到個位，100–1000 到 0.5，<100 到 0.05。

**3443 實算**（EPS≈39.01、BVPS≈100.48、DPS≈20.12）
- P/E：42.99–55.14 倍 → NT$1,677–2,151
- P/B：14.83–21.87 倍 → NT$1,490–2,197
- 殖利率：1.20%–0.87% → NT$1,677–2,313
- 交集 **NT$1,677–2,151**；現價 8,385 比上界高約 290%，會觸發「現價遠高於區間」版面。

**2882 實算**（EPS≈8.48、BVPS≈69.25、DPS≈3.50）
- P/E：8.81–14.87 倍 → NT$74.7–126.1
- P/B：1.07–1.28 倍 → NT$74.1–88.6
- 殖利率：5.33%–3.06% → NT$65.7–114.4
- 交集 **NT$74.7–88.6**。屬金融股，「計算依據」註明 P/B 是主要參考，算法不變。

比率本身只到小數第 2 位，反推的 EPS 誤差約 0.01%，可以忽略，會寫在計算依據中。

## 資料取得（最小可行，不動 DB）

- 在 `useValuationSnapshot` 中，RPC 回來後再用 gateway 讀一次 `daily_price_snapshots`（`symbol=代碼 AND trade_date=asOf`，取 `close_price`）。
- 該日沒有收盤價時，**不回退**到其他日期，區間標成「資料不足：缺 {asOf} 收盤價」。
- 實作第一步先確認 authenticated／anon 透過 gateway 真的讀得到這張表（policy 已存在，但表權限沒在查詢結果中看到）。讀不到就停下回報，提出「RPC 補回 close 欄位」的 migration 方案，不自行套用。

## 視覺參考與授權

- 視覺參考是 lieflat-charts。該 repo 採 PolyForm Noncommercial 授權，本產品屬商業用途，**不複製**其任何模板、程式碼、token、配色值或圖稿，也不加入依賴、不抓取任何檔案。
- 只採用通用設計原則，獨立實作：髮絲線軸、清楚的直接標記（不用圖例）、主次字級層次、單一強調色、圖下來源與日期註記。
- 色彩、字型、間距全部沿用本專案既有品牌 token（`WB.*`、#EC662D、Source Serif 4、Kore-eda 規範）。

## UI 結構（取代 PriceAxis 與三張卡；K 線、趨勢、同業都保留）

```text
歷史估值參考區間（5 年分位換算）NT$1,677–2,151   ← 主標 18px/700
現價 8,385，高於區間上緣 290%｜三尺交集，資料日 2026/09/23
|--[淡帶]--▲成本---▼目標------------------●現價|  ← 等比例單一 TWD 軸
區間依三尺各自 30–70 分位換算後取交集，屬模型參考，
非合理價或獲利保證；目標價來自分析師共識，與本區間不同源。
▸ 計算依據（預設收合）
```

- 主軸**等比例**，從 0 以外的範圍顯示，`min(全部標記)×0.95` 到 `max×1.05`，線性刻度，不斷軸、不壓縮。
- 一個強調色：#EC662D 只用在現價點。區間是淡色帶，目標用細刻度（保留現有 `tpHistory` 箭頭與漲跌%），成本用 ▲。不加陰影、不加漸層。
- 主標措辭固定為「歷史估值參考區間」，旁邊註明「三尺交集」或「三尺分歧」與資料日。全頁不出現「合理價」「目標價區間」「應」「建議」。
- 「計算依據」展開後：每把尺一列，含原始比率、30/70 分位倍數、換算價格區間、5 年分位與狀態、樣本數；其下是來源與日期、反推公式、同業中位數（沿用最多 3 家的規則），以及**原有的同業分布圖與估值趨勢圖**，從 ValuationRulers 搬進來，不刪除。
- K 線與 30D RangeBand 原位保留不動；只有三張大卡改成計算依據裡的列。

**邊界情況的版面**
- 現價距離區間很遠時（例如創意）：**只有一條等比例 TWD 線**，不另畫輔助軸。區間帶照真實寬度畫，只有在換算後不到 2px 時才畫成 2px 讓它看得到，並在 DOM 上標 `data-min-width="true"`。精確上下界一律寫在醒目主標，不從帶寬判讀。成本、目標、現價三個標記上下分層避碰。
- 標記太接近（間距 <28px）：沿用既有 `holdings-price-axis-compact` 的上下錯位與 label 分層。
- 沒有目標價：不畫目標刻度，也不顯示「目標 —」。
- 三尺分歧（無交集或交集寬度 <3%）：主標寫「三尺分歧，無共同區間」，不給單一數字；軸上分別畫各尺的細帶並直接標示尺名。
- 無股利：殖利率列顯示「未配息，不適用」，其餘兩尺仍可合成。
- 金融股：計算依據註明 P/B 較具參考性，算法不變。
- 320px：主標分兩行，計算依據改成直式列；390px 與桌面主標為單行。
- 狀態：skeleton（軸＋兩行灰條）、error（「估值資料暫時取不到」＋重試）；資料超過 7 天時，主標旁標示「資料日 {YYYY/MM/DD}，已逾 7 天」；資料不足時寫出原因（例如缺同日收盤價、有效尺少於 2 把）。

## 檔案清單

- `src/checkup/lib/valuationRulers.ts`：新增 `buildValuationPriceBand`、`ValuationPriceBand` 型別、`roundPrice`，並把 contract `VALUATION_PRICE_BAND_V1` 加進 contract json。
- `src/checkup/hooks/useValuationSnapshot.ts`：補讀 asOf 收盤價，回傳 `band`。
- 新增 `src/checkup/components/freecheckup/ValuationPriceAxis.tsx`：合併價格軸、區間和計算依據。
- `HoldingsDetailPanel.tsx`：L454 的 PriceAxis 改成新元件；L481 的 ValuationRulers 併進新元件的計算依據；K 線與 RangeBand 不動。保留 testid `holdings-price-axis*`、`valuation-distribution*`、`valuation-trend*`，新增 `valuation-band`、`valuation-basis`。
- `ValuationRulers.tsx`：匯出 DistributionChart、TrendChart 與同業列，給計算依據重用；只移除三張大卡。
- `holdingsDetailPanel.css`：320/380/560 media query。
- 不碰持倉編輯／刪除的未發布檔案（HoldingEditDialog、holdingEditService、FreeCheckup 編輯接線）。

## 驗收測試

- 單元 `src/test/unit/valuation-price-band.test.ts`：3443 和 2882 的實際向量要對上上面的區間（±0.5%）；殖利率上下界反轉；EPS≤0、未配息、樣本<250 時排除該尺；有效尺<2 回傳資料不足；無交集或交集寬度<3% 判為分歧；缺同日收盤價時不回退。
- 既有 valuation 23 項、peer-charts 測試全部要過。
- e2e：更新 `holdings-price-axis-*` 三支 spec，新增「現價遠高於區間」「目標缺值」「分歧」三個 fixture，並斷言：
  - 抽屜裡只有一條價格軸；
  - 各標記與帶的 x 位置跟價格成線性比例（±1px）；
  - 帶寬只有在真實寬度不到 2px 時才是 2px，且帶有 `data-min-width` 標記；
  - 頁面沒有「合理價」字樣；
  - K 線、趨勢、同業的 testid 仍然存在。

  抽屜指紋 json 加入 `valuation-band`。手機回歸跑 320/390/桌面截圖，依 FreeCheckup RWD 清單逐項檢查。
- Build 完成後的驗證：讀回 3443／2882 的原始比率與同日收盤價、執行計算單元測試、在實際 Preview 打開創意抽屜，並截 320/390/桌面三張圖。
- Gates：全量測試、tsgo、module-boundaries、build、`check-freecheckup-rwd`、`bunx playwright test e2e/freecheckup-card.spec.ts`。

## 不做

不改 DB、不跑 migration、不發布；不改估值原始資料，也不改目標價來源。不引用 lieflat-charts 的任何程式或素材。Build 開始時把本任務登記到 roadmap.md。
