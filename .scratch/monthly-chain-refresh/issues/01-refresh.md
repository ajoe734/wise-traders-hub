# 01 — 每月產業鏈全量重審

Status: ready-for-agent
Priority: P1
Category: enhancement
Blocked by: None

## What to build

每月2日台北09:00更新櫃買全部產業鏈，重跑所有待審股票（目前600檔），有主業證據才採用；人工確認保持不變。

## 驗收標準

- [ ] 既有月排程只有一個且啟用，時間符合台北09:00。
- [ ] 本次600檔都有唯一結果；衝突、無來源、未知子項保持待審。
- [ ] 新來源代碼的子項完全符合核准對照即可沿用，未知產品不自創字典。
- [ ] 更新前人工確認或同時變動的資料不得被覆蓋。
- [ ] 單元測試、正式函式呼叫與資料讀回確認完成。

## 頁面／路由清單

無新增／修改畫面；既有 `/company/stock-industry`、`/holding-checkup` 讀取已採用分類。無導向或sitemap更動。

## 資料來源

讀取：授權櫃買平台（每月全部產業鏈）、stock_industry_map（排程服務權限）、既有129類字典。
寫入：industry_chain_membership（更新官方成員）、stock_industry_map（僅符合條件待審）、system_jobs_log（全部結果與錯誤）。沿用服務端權限，不改資料表或RLS。
執行入口：refresh-industry-chain，cron-key限定；透過既有cron_edge_call。

## Out of scope

不發布前台、不盲目核准600檔、不變更財務分母、不同業跨上下游混算。