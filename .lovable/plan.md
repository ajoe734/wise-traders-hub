# 免費外部資料源補強計畫

現在骨架已有 TWSE 4 位股票代號 → 主產業（`twsePrimaryIndustry.json`）+ 手動 `stockIndustry.json` overlay。缺的是：**次產業、概念/題材族群、業務營收比重**。以下用完全免費、可程式化、且商用風險可控的來源補齊。

## 一、選定資料源（僅取商用風險低者）

| 用途 | 來源 | 為什麼選 |
| --- | --- | --- |
| 主產業別（骨架） | **TWSE OpenAPI + TPEx OpenAPI + data.gov.tw** | 官方 JSON、免費、可商用（OGDL） |
| 次產業 / 補完欄位 | **FinMind `TaiwanStockInfo`** | REST JSON、免費 600次/天、Apache 2.0 |
| 業務營收比重 | **MOPS `t05st08`（透過 `twmops`）** | 官方申報最權威、月更 |
| 概念題材族群 | **手動維護 CSV / `stockIndustry.json`**（首波），未來可補 g0v 資料集 | 避開 MoneyDJ / 財報狗 / Wantgoo 的商用禁令 |

刻意排除：MoneyDJ、Goodinfo、財報狗、玩股網、CMoney — 全部 TOS 禁止商業爬取。

## 二、實作範圍（本輪）

### Step 1 — 加入 `FinMind` 補完次產業與英文分類
- 新增 `scripts/refresh-finmind-industry.mjs`：
  - `GET https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo`（免 token 也可 low-rate 呼叫；有 token 走 600/day）
  - 輸出 `data/finmind-industry-map.json`（stock_id → { industry_category, type, date }）
  - 合併寫入 `src/checkup/data/twsePrimaryIndustry.json` 的兄弟檔 `twseSecondaryIndustry.json`
- `stockMetaMulti.js` fallback 追加第 5 層：`FinMind secondary`

### Step 2 — 加入 MOPS 月營收比重抓取（Top 20 用）
- 新增 `scripts/refresh-mops-revenue-mix.mjs`：
  - 對 `topWatchList`（讀 `stockIndustry.json` 已有 `revenueMix` 的清單 + 使用者持倉高頻檔）依序 POST `mops.twse.com.tw/mops/web/t05st08`
  - 解析產品/業務比重 → 產出 `data/mops-revenue-mix.json`
  - 手動 review 後合併進 `stockIndustry.json` 的 `revenueMix` 欄位
  - 內建 3 秒 delay、每次最多 20 檔，避免被 MOPS 封 IP

### Step 3 — Secret + 使用說明
- `FINMIND_API_TOKEN` 走 `secrets--add_secret`（optional，未填則走匿名 low-rate）
- 更新 `docs/holdings-classification-maintenance.md`：
  - 每月流程：`bun run refresh:twse` → `refresh:finmind` → `refresh:mops` → 手動 diff → commit
  - 商用風險備註：僅這三個來源可安心用於產品

## 三、明確不做（本輪）

- 不爬 MoneyDJ / 財報狗 / Wantgoo：商用風險
- 不接 Yahoo Finance TW（`yfinance` 非官方 API，風險高）
- 概念題材（AI / CoWoS / HBM）先靠使用者回報 + 手動維護，不自動抓（下一輪再評估 g0v 或自建標籤）

## 四、驗收

1. `bun run scripts/refresh-finmind-industry.mjs` 產生 ≥ 1800 檔次產業對照
2. `bun run scripts/refresh-mops-revenue-mix.mjs 2330 2317 2454` 可拿到三檔業務比重 JSON
3. `stockMetaMulti.getMultiMeta('2330')` 回傳含 FinMind 次產業
4. `docs/holdings-classification-maintenance.md` 有完整月更 SOP

---

要我按這個 plan 開工嗎？（如果你想把「概念題材自動化」也放進本輪，我就再加一個 g0v/GitHub 開源資料集的整合步驟，但那份資料只到 2021 需要人工補新題材，請告訴我要不要）
