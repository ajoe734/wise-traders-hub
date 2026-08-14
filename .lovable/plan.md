# Build2 Recovery Plan P5-R1 — Decision Memo（唯讀，尚未實作）

**首先撤回錯誤陳述**：P5 §3 路徑 C 寫「不存在 bulk upstream」是**錯誤**。FinMind 官方確實提供 sponsorpro 專屬整日全市場 parquet 端點。以下不再用舊 `/api/v4/data` 的 400 推論 bulk 能力。

## A. 官方已證實（本輪實抓官方文件核對，未使用 token）

來源：`https://finmind.github.io/tutor/TaiwanMarket/Chip/`，節錄逐字：

- 標題「一次拿特定日期，所有資料 **(只限 sponsorpro 會員使用)**」，「(由於資料量過大，單次請求只提供一天資料)」
- 「輸入 dataset、date 參數，會回傳 date 當天所有股票的分點資料」「**透過 signed URL 下載整日 parquet**，免逐檔查詢」
- 資料區間 2021-06-30 ~ now；**更新時間 週一至五 21:00**；缺失日期 2022-10-31~11-03、2023-01-11~01-17
- 端點：`GET https://api.finmindtrade.com/api/v4/storage_objects`，header `Authorization: Bearer <token>`，query `dataset=TaiwanStockTradingDailyReport&date=YYYY-MM-DD`；Python 例 `pd.read_parquet(io.BytesIO(resp.content))`，DataLoader 對應 `taiwan_stock_trading_daily_report(date=..., use_object=True)`
- Parquet schema（官方逐字）：`securities_trader:str, price:float64, buy:int32, sell:int32, securities_trader_id:str, stock_id:str, date:str`

注意兩點與原始描述的差異，會影響實作：文件同時寫「signed URL」與「resp.content 直接是 parquet」，**實際回應是 parquet bytes 或 302/JSON signed URL 尚未證實**；且**更新時間 21:00（Taipei）**，比目前 15:30 排程晚，代表 C1 的自然窗口必須在 21:00 之後。

## B. 目前 token capability — **UNPROVEN**

- repo 全域搜尋 `storage_objects|use_object|parquet|sponsorpro|arrow` → **0 命中**（排除 lockfile/tsbuildinfo；`e2e/*narrow*`、css 為 "arrow/narrow" 假陽性）。所有 FinMind 呼叫都指向 `https://api.finmindtrade.com/api/v4/data`（10 處：`_shared/finmindMarketBatch.ts:18`、`_shared/institutionalDay.ts:181`、`_shared/twPriceWaterfall.ts:206`、`tw-bsr-finmind-sync/index.ts:66`、`tw-institutional-daily-sync/index.ts:104`、`backfill-worker/index.ts:38`、`refresh-data-source/index.ts:58`、`src/pages/DataSources.tsx:119` 及 2 個 test）。
- `finmind_upstream_quota` 表 **0 列**（從未記錄過上游 header），無任何 plan/level 佐證；`tw_bsr_sync_config.market_batch` 只有舊 endpoint 的探測結果。
- 因此「FINMIND_TOKEN 是否為 sponsorpro」**UNPROVEN**，且在不暴露 secret、不 manual invoke、不寫 DB 的前提下本輪無法驗證。
- **證明方式（待核准，走自然排程）**：把 job67 的 probe 改打 `storage_objects`（見 §E M1），下一次自然輪次即產出可稽核判定；probe 只讀 header 與前 4 bytes，不落 DB 資料列，只更新 config 診斷欄位。

## C. storage_objects 回應判讀與防護（設計，尚未實作）

探測與正式抓取共用同一組判讀：

| 觀察 | 判定 |
|---|---|
| 200 + `content-type` 含 `parquet`/`octet-stream` 且前 4 bytes = `PAR1`（magic）+ 尾 4 bytes = `PAR1` | `supported`（bulk 可用） |
| 200 + JSON 且含 signed URL 欄位 | `supported`，但需 follow URL（同樣做 magic/size 檢查） |
| **401 / 403 / msg 含 permission·level·upgrade·sponsor** | **`unsupported`**（方案層級，寫 supported=false，停止重探） |
| 404 / `date not ready` / 200 但 0 bytes | `inconclusive`（日期未產生，21:00 前正常） |
| 429 / 5xx / timeout / bad magic | `inconclusive`（暫時性，維持前值） |
| 400 參數錯 | `unsupported_contract`（記錄逐字 msg，不重探） |

**Guard（硬性）**：`content-length` 缺失或 > `MAX_BULK_BYTES`（提議 80 MB）→ 直接放棄並記 `inconclusive:oversize`，不下載；probe 階段用 `Range: bytes=0-3` 或 HEAD 只取 magic，不整檔下載；abort timeout 90 s；解析後必須驗 schema 六欄齊全且 `stock_id/date` 非空，否則 `parse_schema_mismatch`。

## D. C1 vs A（先決策 C1）

### C1 — storage_objects 每日一次全市場

- **配額效益**：1 request/日涵蓋全市場，取代目前 per-stock 4.08 req/stock（今日 ledger：interactive 265 grants / 65 distinct stocks；keepwarm 29/14；backfill 80/11）。現有 1,800 req/日只能覆蓋約 500 檔、全市場 ≈3 天一輪；C1 直接讓 Lane A 與全市場**同日 100%**。
- **量體估算（用 production 實測外推，標為估算不是事實）**：`tw_bsr_daily` 近日 `rows/stock`＝08-14 623.8（熱門股偏高）、08-11 226.8、08-07 214.5。以全市場 ~1,600 檔 × 250–400 列 → **每日 40 萬–65 萬列**；parquet 壓縮後推估 10–40 MB，解碼後 JS 物件記憶體 **數百 MB** → **單一 Edge Function 一次解析＋upsert 不可承受**（Edge 記憶體/CPU 上限）。此為估算，**runtime 可行性 UNPROVEN**。
- **既有可整合的分段 ingest（不需新表）**：`_shared/snapshotFulfillment.ts` 已有 `claimSnapshot / markSnapshot / persistAggregated`（fact upsert `CHUNK=500`、rollup RPC `RPC_CHUNK=200`）、`fulfillJobsFromSnapshot / fulfillDay`；`backfill_job_queue` + `backfill-worker`（同樣 CHUNK 500）已是既有分段執行器；`tw_bsr_daily_snapshot_status` 已有整日快照狀態機。C1 的落地形狀應為：**抓檔＋切分（by stock_id 分片）→ 交給既有 snapshot/backfill 分段 worker**，而非一支函式吃完整天。
- **Deno 端 parquet 解析**：repo 目前**沒有**任何 parquet/Arrow 解析器。需引入純 JS 解析（候選 `npm:hyparquet`，支援 row-group 逐段讀），**是否能在 Edge 記憶體內以 row-group streaming 完成 UNPROVEN**，必須先做離線/ephemeral 實測。
- **時窗**：官方 21:00 更新 → C1 排程需 Taipei 21:30 之後；當日盤後 15:30–21:00 的即時需求仍需 per-stock 補足（Lane A 少量）。

**決策**：C1 在配額與資料契約上**明顯優於任何輪轉方案，是首選主路徑**；但需依序證明兩個條件才可實作：
1. **T1 token capability = supported**（自然 probe 產生）
2. **T2 runtime 可行性**（離線／ephemeral 實測 parquet row-group 解析 + 分片 upsert 在 Edge 限制內完成）

### A — fallback（僅在 T1 判定 unsupported 時啟用）

沿用既有 queue/quota：使用者持股優先（priority 1，interactive 桶）＋其餘觀察集低速輪轉（priority 3，keepwarm/backfill 桶）。SLO 只能是「持股當日新鮮、非持股 3–4 天一輪」。**不是本 memo 的建議主案，也不得在 T1 尚未判定前先實作。**

## E. 修正後的最小提案（依序、可回滾）

- **M1（唯一先做的一步，待核准）**：`_shared/finmindMarketBatch.ts` 的 probe 改打 `storage_objects`（HEAD/Range 只驗 magic 與 size），並依 §C 表寫 tri-state；同時把舊 `/v4/data` 無 data_id 的 400 明確分類為 `unsupported_contract`（逐字證據：`parameter data_id can't be none on TaiwanStockTradingDailyReport dataset`），不再重探舊路徑。job67 排程維持每日直到 T1 有定論；判定 unsupported 後改月頻。
- **M2（T1=supported 後）**：新增 `mode=bulk_ingest`，用既有 snapshot/backfill 分段器落地；不新增表。
- **M3（撤回原 P5 D1/D2 的即刻改動）**：`detect_chip_gap_jobs` 的 `ORDER BY gap_count DESC` 造成使用者持股（只缺 1 天）被冷門股（缺 60 天）擠掉；`enqueue_chips_prefetch_gaps` 只用日期決定 priority 1/2、不分是否被持有。此二者仍是真缺陷，但若 C1 成立即自然消失 → **延後到 T1 判定後再決定是否要改**。
- **M4（撤回）**：原「`finmind_empty` 不計 attempts、每日最多 2 次」**沒有現成欄位可表達**。`tw_bsr_sync_queue` 只有 `attempts / max_attempts(5) / next_run_at / status ∈ (pending,running,done,failed,skipped) / post_close_only`，沒有 per-day retry 計數欄位；不計 attempts 會造成無限重試。**撤回**。可證明的替代（若 fallback 才需要）：`finmind_empty` 時把 `next_run_at` 推到下一個整點且**照常累加 attempts**，行為完全用現有欄位表達。今日 `finmind_empty` 相關 job 7 天內僅 4 筆，影響有限。

**frozen（不得動）**：`claim_bsr_queue_jobs`（Build1f 位元凍結）、`finmind_admit_v2`、quota pool 參數、`enqueue_bsr_backfill`/`app_role`（out-of-scope，call graph 已證非必經）、所有 UI、其他 cron。

## F. Lane A 與 checkup_storage 事實更正（production 實查）

`checkup_prefetch_universe()` 四個來源的 distinct code 數（今日實查，非估算）：

| source | distinct codes |
|---|---|
| trade_records | 50 |
| expert_signals（published） | 50 |
| checkup_storage（pf-holdings-v2） | **42** |
| registry（chips_prefetch_targets active） | 20 |
| **UNION 去重** | **97** |

→ P5 寫的「Lane A 約 150 檔」**錯誤**，實際 union 97 檔；其中「真正的使用者持股」只有 checkup_storage 42 檔（36 位使用者、共 45 筆持股列），不可與 published expert_signals 混為一談。

`checkup_storage` key 確認為 **`pf-holdings-v2`**（表中確實存在該 key）。格式檢查：該 key 的 36 列**全部** `jsonb_typeof(data)='array'`，無 `data->'holdings'` 形態；每個 holding 物件鍵為 `code,cost,fee,name,pct,pnl,price,priceError,priceReason,priceSource,priceState,priceTradeDate,priceUpdatedAt,qty,totalCost,type,userOrigin,value`，`coalesce(code,symbol) IS NULL` 的筆數 = **0**。→ 現行 JSON extraction 對**目前所有實際儲存格式**有效；對未來 object-with-holdings 形態也已有分支，但目前無資料可證，標 UNPROVEN（不影響現況）。

## G. 狀態總表

| 項目 | 狀態 |
|---|---|
| 官方存在 sponsorpro 整日 parquet bulk 端點 | **已證實**（官方文件逐字） |
| 舊 `/v4/data` 無 data_id 固定 400 | **已證實**（不再用以推論 bulk 不存在） |
| 目前 FINMIND_TOKEN 具 sponsorpro bulk 權限（T1） | **UNPROVEN** |
| C1 runtime（Edge parquet 解析 + 全市場 upsert）可行性（T2） | **UNPROVEN** |
| Lane A = 97 檔（使用者持股 42 檔） | 已證實 |
| M4 原語意不可實現 | 已證實（欄位不存在）→ 撤回 |

## H. 測試與自然驗收門檻

1. 離線：`finmindMarketBatch_test.ts` 擴充——401/403 → `unsupported`；404/0 bytes → `inconclusive`；200+`PAR1` → `supported`；`content-length` 超限 → 不下載並記 oversize。
2. ephemeral／離線：parquet row-group 解析 40–65 萬列的記憶體與時間實測（T2 門檻），失敗即改分片 ingest 或宣告 C1 不可行。
3. 自然驗收鏈一律 `cron runid → cron_edge_call request_id → net._http_response → config 診斷欄位 → （T1 通過後）snapshot/coverage`；**不得 manual invoke、不得建立假持股**。
4. Preview：dedicated E2E 帳號 `checkup_storage` 仍 0 列 → **per-holding Preview BLOCKED**，只做「登入 /holding-checkup 0 enqueue」與 server-side 覆蓋兩段。

**在 T1 與 T2 均未證明前，不 Approve 任何 implementation；亦不再宣稱沒有 bulk。** 本輪唯一請求核准的候選動作是 M1（改 probe 端點），是否核准由你決定。
