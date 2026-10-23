# 持倉族群分類資料維護 SOP

**目的**：確保 `/holding-checkup` 上方「產業／題材分佈」聚合看到的分類是最新且正確的。

## 資料鏈（合併優先順序，高 → 低）

1. **`holding_meta_overrides` DB 表**：使用者手動 override + 「回報分類錯誤」寫入
2. **`src/checkup/data/stockIndustry.json`**：人工校訂的多族群 + `revenueMix` + `themes` 覆蓋層
3. **`src/checkup/seedData.js` `STOCK_META`**：Demo / 舊手 key 表（單值 industry / themes）
4. **`src/checkup/data/twsePrimaryIndustry.json`**：TWSE / TPEx 官方 ISIN 主產業（單值兜底）
5. **`src/checkup/data/twseSecondaryIndustry.json`**：FinMind 次產業（補 TWSE 空缺）

## 免費資料源（僅收商用風險低的來源）

| 來源 | 授權 | 補的欄位 | 更新腳本 |
| --- | --- | --- | --- |
| TWSE / TPEx ISIN | 政府公開資料 | 主產業（33 大類） | `bun run refresh:twse-industry` |
| FinMind `TaiwanStockInfo` | Apache 2.0，免費 600 次/天 | 次產業 + 全市場涵蓋 | `bun run refresh:finmind-industry` |
| MOPS `t164sb04` | 官方申報 | 產品營收比重 → revenueMix | `bun run refresh:mops-revenue 2330 2317 …` |

**刻意排除**：MoneyDJ、Goodinfo、財報狗、玩股網、CMoney、Yahoo Finance — TOS 全部禁止商業爬取。概念題材（AI / CoWoS / HBM）目前只走手工維護 + 使用者回報，不自動爬。

## 每月更新流程

### 授權櫃買產業價值鏈（自動）

- 既有 `refresh-industry-chain-monthly` 每月2日台北09:00執行（UTC `0 1 2 * *`），僅一個排程，透過 `cron_edge_call` 保護呼叫。
- 同步全部鏈與子項；`buildChainReview` 對全部待審產生唯一結果，新來源代碼只在子項名稱完全等於既有核准對照且唯一時沿用分類；未知產品保留待審，不自創字典。
- 主業一致才採用；多角化走 `dominantIndustry`：只採年報營收占比（`revenue_mix_source=annual_report`），同產業加總後第一名 ≥40% 且領先第二名 ≥10 點、且在平台產業內才採用；AI推估或產品比重不算；營收最高並列／無效比重不採用。人工確認、已採用及更新途中變動的資料不覆蓋。
- 年報營業比重：官方電子書股東會年報（F04）解析存於 `stock_annual_revenue_mix`；產品名稱完全等於 `productSourceMap` 才對到產業，對不上的照列。2026/10/23 多角化 198 檔：解析成功 174、版面無法核對 17、查無年報 7；依此自動採用 28 檔。
- `system_jobs_log.job_name=refresh_industry_chain` 保存完整逐檔結果、狀態、未對照子項與實際採用代號；可用 `dryRun: true` 只比對不寫入。
- 2026/10/23實跑：47鏈7030筆，600唯一待審結果；採用2（3644、4577）、衝突99、多角化196、未對照145、未收錄158，剩598待審；146筆人工確認指紋不變。
- 前台與即時同業讀取已採用分類；PS排程靜態清單仍受既有生成契約管理，分類採用不代表缺漏財報自動齊備。

```bash
# 1. 官方主產業（每月 1 號）
bun run refresh:twse-industry

# 2. FinMind 次產業補完
bun run refresh:finmind-industry
#   → 需要 token 走 600/day 時：FINMIND_API_TOKEN=xxx bun run refresh:finmind-industry

# 3. Top 20 持倉的產品營收比重（review 用，不會覆蓋 stockIndustry.json）
bun run refresh:mops-revenue --from-overlay
#   → 產出 data/mops-revenue-mix.json，人工把 products → industries 對照後合併

# 4. Diff & commit
git diff src/checkup/data/twsePrimaryIndustry.json src/checkup/data/twseSecondaryIndustry.json
```

## 每兩週 — 題材白名單（人工）

在 `stockIndustry.json` 對應個股的 `themes[]` 補題材（AI、CoWoS、CPO、高股息、車用…）。
事件驅動時（新台幣升值、颱風災後重建、政策題材）加碼 review。

## Top 20 持倉的 `revenueMix`

只有 Top 20 熱門持倉個股需要人工維護 `revenueMix`（依公司年報 / 法說會營收比重）。
其餘個股只需列 `industries[]`，聚合會自動平均拆分。

## 常見坑

- **CHECK constraint 不會擋分類錯誤**：資料正確性是流程問題，程式碼只負責顯示。
- **TWSE 產業別只有單值**：像鴻海分類為「電子零組件」但實際上跨伺服器/車用/AI，必須靠 `stockIndustry.json` 手動補多族群。
- **FinMind 不是 TWSE 正式分類**：欄位命名有時略異（例：「其他電子」vs「其他電子業」），聚合時視為別名。
- **MOPS 產品名 ≠ 產業別**：`refresh:mops-revenue` 只給你原始產品拆分，需人工映射到你採用的產業標籤。
- **題材無官方標準**：CMoney / 鉅亨 / Goodinfo 各家定義不同，統一以「使用者能看懂」為準，不追求全網一致。

## 驗收

- 抓完後隨機抽 10 檔用公開資訊觀測站對照
- Top 20 熱門持倉 spot-check 多族群拆分是否合理
- `/holding-checkup` 顯示「N 檔跨多族群」與加權後的產業條
