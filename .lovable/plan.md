# Natural Acceptance N1 — 唯讀回查結果（Taipei 2026-08-14，17:35 job81 後）

判定：**BLOCKED（主路徑 market batch 未啟用）** — probe outcome = `inconclusive`，依 P4 規則立即誠實判定，不重跑、不改方案、不以 per-stock 覆蓋冒充。

## S1 probe（job67，Taipei 15:21）

| 項目 | 值 |
|---|---|
| cron job | 67 `tw-bsr-market-batch-probe-daily`，schedule `21 7 * * 1-5`，active=true |
| run | start 2026-08-14 07:21:00.948811+00，status `succeeded` |
| net._http_response | id `243732`，created 07:21:07.536121+00，status_code `200` |
| body（逐字） | `ok:true` / `mode:"probe"` / `supported:false` / `outcome:"inconclusive"` / `stocks:0` / `probe_date:"2026-08-11"` |
| body error | `finmind_http_400:{"msg":"parameter data_id can't be none on TaiwanStockTradingDailyReport dataset","status":400,"token_tail":"...(遮罩)"}` |
| tw_bsr_sync_config `market_batch` | `enabled:true`、`supported:false`、`probed_at:2026-07-25T08:54:27Z`、`last_probe_at:2026-08-14T07:21:07.794Z`、`last_probe_outcome:inconclusive`、`last_probe_error` 同上、version 4，updated_at 07:21:07.986892+00 |

**P4 remote source 是否生效：PASS（以 response 新 tri-state 欄位為證）** — body 同時含 `mode` / `outcome` / `supported` / `probe_date`（`resolveProbeDate` 回推至 08-11），且 DB 寫入 `last_probe_outcome/last_probe_at/last_probe_error` 三欄，皆為 P4 才有的行為；job67 payload `{"mode":"probe","force":true}`（R4）確實被消費。

**Edge identity：UNPROVEN** — `function_edge_logs` 保留窗僅約 9 分鐘（現存最舊 09:36:42 UTC），07:21 該次 execution_id / version / deployment_id 已不可得。不沿用 Stage R 的 version 313 冒充。

## S2（market batch 實際輪次）

**N/A — 未觸發。** outcome ≠ supported 且 `supported=false`，Phase A market batch 不會執行；當日 `tw_chip_fact` 中 `source='finmind_market_batch'` 的 distinct stocks = 0、rows = 0（唯一 source 為 `finmind_batch`，即 per-stock，不得冒充 market batch）。因此不列 job45/53/51/46/107 的 market-batch 輪次判讀。

## S3 落地與收斂

| 指標 | 值 |
|---|---|
| tw_chip_fact 2026-08-14 | distinct stocks 61 / rows 37,774；source 僅 `finmind_batch`（market_batch = 0） |
| tw_bsr_daily 2026-08-14 | distinct stocks 61 |
| bsr_coverage_daily 2026-08-14 | 61 檔；`ok` 37、`broker_under_cover` 20、`broker_over_cover` 4 |
| tw_bsr_daily_snapshot_status | status `partial`、lane_a `partial`、lane_b `sealed`、lane_c `sealed`、sealed_by_lane `BC_ONLY`、sealed_at null、coverage_stocks 61 / coverage_brokers 37,774 |
| job81（wave2，Taipei 17:35） | runid 532582，status succeeded；HTTP body：`materialized_rows 37774`、`skipped_sealed false`、reconcile `lane_a_status partial` / `inst_stocks 20793` / `notes:"Institutional sealed, BSR coverage insufficient"`、`fallback_used_count 0`、`duration_ms 9335` |
| job33（alerts-watchdog `*/5`） | 07:25–09:40 每輪 succeeded，無 failed |
| FULL_MARKET(d) | **0**（當次 API 未回傳任何 market batch 資料） |
| OBSERVED_60D_ELIGIBLE（實算） | 1,553（近 60 日出現過且 `tw_bsr_eligibility.eligible`） |
| MISSING（eligible 無 08-14） | **1,492**；前 20（以 4 碼普通股樣式近似列示，避免逐檔 RPC 逾時）：1101,1102,1103,1104,1108,1110,1201,1210,1215,1216,1217,1218,1219,1225,1227,1229,1232,1233,1234,1240 |
| fact vs FULL_MARKET | 61 vs 0（market batch 未產生任何 fact） |
| daily / fact | 61 / 61 = 100% |
| coverage / daily | 61 / 61 = 100% |
| queue（08-14） | done 63、pending 4（現值；window 前值不可回溯，標 UNPROVEN） |
| Lane A 持股新鮮度 | TW 未平倉 10 檔：4 檔為權證（068003 / 071745 / 078397 / 079052，ineligible）；6 檔普通股中 2478、3163、6138、8299 有 08-14 資料（queue done），**6515、8028 仍 pending，latest=08-13 → Lane A 缺漏 2** |
| quota pools | interactive tokens 100.15 / used_today 240（= daily_budget 240，本日額度用盡，另有 22 筆 `borrowed`，最後 08:45:10）；keepwarm tokens 239 / used 83；backfill tokens 232 / used 134。本窗 ledger 無 `daily_exhausted` reject（最後一次為 08-12 15:07） |

## 判定（沿用 P4 門檻）

- FULL_MARKET = 0（< 500）、MISSING 1,492（> 150）、Lane A eligible 缺漏 2（> 0）→ 若以主路徑計分即為 **FAIL/STOP** 條件。
- 但根因為 probe `inconclusive`（FinMind `TaiwanStockTradingDailyReport` 拒絕缺 `data_id` 的全市場查詢），市場批次自始未執行，屬 P4 明列的「probe 非 supported → 主路徑 BLOCKED/PENDING」分支。

**Natural Acceptance N1 最終判定：BLOCKED**
- S1 probe 執行與 P4 remote source 生效：PASS
- Edge identity（version/deployment_id/execution_id）：UNPROVEN（log 保留窗過短）
- S2 market batch：未觸發（N/A）
- S3 全市場覆蓋：不達標，惟根因為 S1 BLOCKED，不另計為本次 regression
- Lane A 缺漏 2 檔（6515、8028，queue pending）：記錄為觀察事實，未授權補跑

可稽核原因：FinMind token 對 `TaiwanStockTradingDailyReport` 不支援無 `data_id` 的全市場拉取（HTTP 400）。是否為 token 權限、方案層級或 API 規格變更，需另行授權調查，本輪不動作。

停在此處等待審核；未登入 Preview、未 deploy、未 manual invoke、未改任何檔案/DB/cron。
