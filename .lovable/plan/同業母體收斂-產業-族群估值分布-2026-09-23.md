# 同業母體收斂 + 產業／族群估值分布

三件事：把同業母體改成「市場族群優先」讓同業家數變少且更像一回事；持倉看板新增產業與市場族群的佔比分布；每個產業／族群各自算三把尺的加權指數與涵蓋率。

## 1. 同業母體：市場族群優先

目前母體順序是「細分產業 → 產業大類」，所以電源供應會抓到 44 家、電子代工 43 家，看起來不像同業。改成三段優先序：

```text
市場族群重疊（如散熱三雄）→ 有效同業 ≥3 家就用
  ↓ 不足
細分產業（125 類）→ ≥3 家就用
  ↓ 不足
產業大類 → 最後保底
```

畫面上同業明細標明目前母體是哪一層（族群／細分產業／產業大類）與家數，例如「同業母體：散熱三雄（3 家）」。同業明細、分布圖、趨勢圖、投組加權指數全部自動跟著這個母體走，不需各自再刻一套。

注意：族群層母體通常只有 3–5 家，樣本本來就小；因此族群層仍需通過「至少 3 家有當日有效數值」才成立，不足就自動退回細分產業，不會硬湊。

## 2. 產業分布與市場族群比例

在持倉看板既有的「索引」區塊下方新增一個分布區：

- 產業分布：依細分產業（125 類）計算持股市值佔比，橫向條形圖由高到低，顯示產業名、佔比％、檔數。多產業個股沿用現有的營收拆分權重規則，不重複計算。
- 市場族群比例：族群是純標籤（一檔最多 3 個），顯示檔數與「佔台股持股市值比例」標籤，不參與產業佔比計算，避免加總超過 100%。
- 每個產業／族群旁標出實際涵蓋率：該桶內「三把尺算得出溢折價」的市值佔該桶市值的比例。涵蓋率低於門檻時標「同業樣本不足」，不顯示指數。

## 3. 產業與族群的加權指數

每個產業桶與族群桶各自計算本益比、股價淨值比、現金殖利率的市值加權溢折價，規則與現有投組指數完全一致（同業 ≥3 家門檻、極端值裁到 5%–95%、單檔溢價上限 +200%、±10% 內視為「與同業相當」）。

顯示形式：每一列 = 產業／族群名稱 ｜ 市值佔比 ｜ 三把尺的加權溢折價與文字標籤 ｜ 涵蓋率。文字全部中性（高於／接近／低於同業），不出現買賣建議。桶內沒有任何一檔算得出溢折價時顯示「資料不足」。

## 技術細節

- Migration `0015`：重建 `valuation_snapshot` 與 `valuation_peer_medians`，peer CTE 新增 `group_rows`（以 `stock_industry_map.market_groups` 陣列重疊比對），優先序改為 `group → fine → broad`，`peerScope` 新增 `'group'`，回傳附 `peerCount`。`valuation_peer_medians` 同步帶回 `peerScope`、`industry`、`marketGroups`，供前端分桶時不必再打一次 RPC。
- `valuationRulers.ts` 新增純函式 `buildBucketValuations(rows, bucketsOf)`：以 `computePortfolioValuation` 為單一計算來源，對每個桶跑一次子集合，輸出 `{ key, label, kind: 'industry' | 'marketGroup', weight, weightShare, rulers, coverage, stockCount }`。禁止重刻 winsorize／clip／門檻邏輯。合約常數 `PORTFOLIO_BUCKET_VALUATION_V1`。
- `usePortfolioValuation.ts` 回傳值加上 `buckets`，分桶所需的 industry／marketGroups 取自既有 `getMultiMeta`（override > auto），與 `aggregateBySector` 同口徑。
- 新元件 `HoldingsSectorValuation.tsx`，掛在 `HoldingsSectorSummary` 索引區下方，testid：`holdings-sector-distribution`、`holdings-group-distribution`、`holdings-bucket-valuation-{key}`。沿用 WB 色票與既有極簡樣式，顏色不單獨承載意義。
- `ValuationRulers.tsx` 同業明細標題加母體層級與家數標示。
- 不動 BSR 管線、估值同步排程 110／111／113、寄信管線。

## 驗證

- 新增純函式測試：族群優先母體、桶內涵蓋率、桶內全不足 → 資料不足、族群不影響產業佔比合計 100%。
- 正式資料唯讀讀回：3017 散熱三雄、3443 ASIC、2330 晶圓雙雄、2308 電源、1101 水泥、2882 金控的母體層級與家數變化前後對照。
- 真實帳號登入持倉看板，1440／560／390／380px 四斷點截圖，確認分布區與桶指數無橫向溢出。
- 全量測試、tsgo、module-boundaries、build、安全掃描全綠後才回報。
