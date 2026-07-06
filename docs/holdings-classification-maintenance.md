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
