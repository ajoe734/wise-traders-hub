# 資料語意收斂與分階段上線計畫（H3/H4 clone 優先）

Production 0 touch。本計畫只描述要做什麼；下一個 Approve 只授權「H3/H4 clone/harness 驗證」，不含任何 production 變更、deploy、cron 或 Publish。

## 1) 唯讀盤點（已完成，以下為實測結果）

Row counts / 最新日期（今日讀取）：

| 表 | rows | 最新日 |
|---|---|---|
| tw_bsr_daily | 3,679,883 | 2026-08-14 |
| tw_chip_fact | 3,567,739 | 2026-08-14 |
| tw_chips_rollup | 39,833 | 2026-08-14 |
| tw_institutional_daily | 19,026,661 | 2026-08-17 |
| bsr_coverage_daily | 7,627 | 2026-08-14 |

分點（券商 BSR）語意：

- `tw_bsr_daily` PK=id、UQ`(stock_id,trade_date,broker_id)`；欄位 broker_id / broker_name / buy_shares / sell_shares / net_shares / avg_buy_price / avg_sell_price。**純分點**，無 source 欄位（舊資料源不可辨識）。
- `tw_chip_fact` UQ`(stock_id,trade_date,broker_id,source)`，`source` 現有三值：`finmind_per_stock`(1,896,402)、`legacy_migration`(1,408,778)、`finmind_batch`(262,559)。這是**分點事實表**，`raw` 保留原始 payload。
- `bsr_coverage_daily` PK`(stock_id,trade_date)`：broker_count / broker_sum_shares / snapshot_volume_shares / coverage_pct / coverage_class——**純分點覆蓋率**，不得由法人資料填。
- `tw_bsr_fetch_failures`、`tw_bsr_attempt_logs`、`tw_bsr_sync_queue`：分點抓取的失敗、逐次嘗試與佇列。佇列現況 done 9,956 / failed 1,573 / pending 76。

法人與價量：

- `tw_institutional_daily` UQ`(stock_id,trade_date)`：foreign_net / trust_net / dealer_net / total_net / raw / source。**三大法人**，語意乾淨且已到 8/17。
- `daily_price_snapshots` UQ`(symbol,trade_date)`、`current_prices` PK symbol：價量。

混用風險點（本計畫要處理的核心）：

- `tw_chips_rollup` UQ`(stock_id,as_of_date,window_days)` 同時放 `foreign_net/trust_net/dealer_net`（法人）與 `top_buy_brokers/top_sell_brokers/concentration_ratio`（分點）＋單一 `bsr_available` 旗標。單表混兩種語意，freshness 判讀容易被誤讀成「有資料＝新鮮」。
- consumer DAG：Edge `tw-chips-orchestrator` / `tw-chips-detail` / `tw-bsr-daily-sync` / `tw-bsr-finmind-sync` / `tw-institutional-daily-sync` / `chips-guardian` / `backfill-worker` → RPC（`get_bsr_daily_series`、`rebuild_bsr_rollup`、`get_bsr_readiness_v2`、`chip_fact_summary`…）→ 前端 `chipsRepository.ts` / `useTwChipsDetail` / `useChipsState` / `ChipsSection.tsx` / `ChipsTrendChart.tsx`，管理端 `FactLogHealthCard`、`BsrOcrMetrics`、`InstitutionalColdStartCard`。
- 前端目前已把「三大法人」與「關鍵分點」分區塊顯示（ChipsSection L424 / L484），但兩者共用同一組 loading／stale 文案，缺 BSR 時仍可能被讀成整體 fresh。

交付物：`db/r1/c/H/inventory.md`（逐欄語意 × PK × writer × RPC/view × Edge × 前端欄位的完整矩陣）。

## 2) Typed mapping 與語意隔離

三條資料線各自獨立、各自有 as_of 與 freshness：

| 資料線 | 官方來源 | 落地 | freshness key |
|---|---|---|---|
| 日價量 | TWSE STOCK_DAY_ALL / TPEx daily | `daily_price_snapshots` | `(market, as_of)` |
| 三大法人 | TWSE T86 legacy JSON、TPEx 3insti openapi（已 3/3 穩定） | `tw_institutional_daily`（新增 `market`、`as_of` 語意欄位） | `(market, as_of)` |
| 券商分點 BSR | 無免授權來源（BLOCKER-E1） | `tw_chip_fact` / `tw_bsr_daily` | `(market, as_of)`，目前 unavailable |

規則：

- **禁止**把價量或法人寫進 `tw_chip_fact` / `tw_bsr_daily` / `bsr_coverage_daily` 任何欄位，也不得填 `bsr_available`。
- `tw_chip_fact.source` 契約是「分點的抓取來源」，不是資料種類 → **不重用**它裝法人。改以獨立 typed 表／view。
- `tw_chips_rollup` 拆為三個 typed 讀取面（view 或分欄）：`institutional_*`＋`institutional_as_of`、`bsr_*`＋`bsr_as_of`＋`bsr_availability`（enum: `available` / `stale` / `unavailable_no_source`）。舊欄保留不刪，避免前端斷裂。
- 前端：三大法人區塊照常顯示 as_of；分點區塊在 BLOCKER-E1 期間顯示「券商分點資料不可用（無官方免授權來源）」，且整體 freshness 徽章不得因法人新鮮就標 fresh。

## 3) Eligibility：ingestion 必 join ISIN 分類

- T86 raw 15,386 列含 14,184 個 6 碼商品（權證為主）；**不得**整包 ingest。
- H1 `tw_market_symbols`（authoritative ISIN 分類）為唯一 gate：只 ingest `common` / `emerging`(創新板) / `etf` / `etf_leveraged`。
- **ETN 明訂不支援**（`eligibility=false`）：ETN 是發行商信用商品、無成分股籌碼意義，且量小。warrant / CB / TDR / preferred / REIT / ABS / unknown 一律 **fail-closed**。
- 每 `(market, as_of)` 獨立提交：TWSE 8/14 不可覆蓋或推進 TPEx 8/17 的 as_of，反之亦然。任一 market 失敗只影響該 market。

## 4) H3/H4 驗證（只在 disposable clone / harness，本輪唯一可 Approve 的範圍）

固定 fixtures：本輪保存的真實 full payload（TWSE T86 1,976,483 bytes、TPEx 3insti 862,844 bytes、兩份 ISIN registry）＋10 symbols（2330 / 2317 / 6505 / 2891 / 0050 / 00631L / 00679B / 3105 / 5483 / 03007）。

驗證項目：

1. Parser：schema drift（欄位增減／改名）、ROC 日期（1150817）與西元、千分位逗號與 `--`／空白／全形數字 locale 解析。
2. Full-payload ingest：canonical PK 去重、idempotent re-run（第二次 0 變更、hash 相同）。
3. 失敗路徑：部分 endpoint 失敗、wrong-date payload、HTTP 200 但 HTML body、TLS 失敗、429/5xx、週末與國定假日。
4. 不變式：**任何 failure 不得推進 as_of / coverage**；success 後 row counts、distinct instrument_class counts、內容 hash 可重現。
5. Demand fast lane 與 full-market batch 走不同路徑：官方全市場 batch **不需要**每 symbol queue row。
6. 佇列既有 FinMind `permanent_auth` job：停止重試（轉 terminal 狀態）但保留 audit，**不刪歷史**。

harness：`db/r1/c/H/h34_rehearsal.sh` + fixtures 目錄，兩座全新 clone、跑完自動 destroy、輸出 full log sha256 與 start/end UTC。

## 5) H-ACL production 兩段式（避免前端斷裂）

- **P-ACL-1**：只新增 guarded `finmind_pool_reset_v2()`，**不撤**任何舊 grant。DataSourceHealth 保持可用。
- 中間：Preview 以 controlled role 測試（一般 authenticated 拒絕、company_admin 通過、service_role 通過）。
- **P-ACL-2**：取得明確 Publish 授權、且前端 caller 已改呼 v2 並上線之後，才 REVOKE 舊的 PUBLIC/anon/authenticated（含 46 支 writer 收斂）。
- 未取得 Publish 授權前，只能停在「準備完成」。

## 6) Stage 拆分

| Stage | exact mutation | 依賴 | rollback | stop point | 需 Publish 授權 |
|---|---|---|---|---|---|
| P0 read-only final preflight | 無（只讀 baseline fingerprint） | — | 不需要 | 產出報告即停 | 否 |
| P1 H0 observability | 新增 correlation_id 欄位、`freshness_run_trace` view、保留清理函式；**cron 不切** | P0 | drop view/欄位 | side-by-side 觀察，FinMind 仍 400 時不切 cron | 否 |
| P2 H1 market master | 建 `tw_market_symbols` + upsert 函式（additive） | P1 | drop table/function | 首次 ISIN 載入完成 | 否 |
| P3 H2 registry backend | 建 `symbol_demand_registry` + cap/decay 函式 | P2 | drop | 後端可用、前端未接 | 否 |
| P4 H3/H4 official batch ingest | 價量＋法人 typed ingest、rollup typed 拆面、eligibility gate、queue permanent_auth 收斂 | P2/P3 | 逐段 down script；資料 additive 不刪舊 | ingest 綠但前端未切 | 否（cron 啟用需另行確認） |
| P5 H5/H6 frontend/Publish | 前端 freshness UI、分點 unavailable 文案、E2E | P4 | 前端 revert | — | **是** |
| P-ACL-1 | 新增 v2 函式 | 無 | drop function | 前端仍用舊 | 否 |
| P-ACL-2 | REVOKE 舊 grants（46 支 writer） | P-ACL-1 + 前端已上線 v2 | 已驗證的 ACL rollback（bit-identical） | — | **是** |

P1 建議：FinMind 仍 400 時**不值得**切 cron，只做 side-by-side 觀察，避免把 400 噪音寫進新 trace 又無法區分官方來源的成敗。

## 本輪 Approve 範圍

只做第 4 節的 H3/H4 clone/harness（含第 1 節 inventory.md 文件）。不建 production 物件、不 deploy、不動 cron、不 Publish。
