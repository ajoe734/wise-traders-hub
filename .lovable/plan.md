# M1 Capability Probe Closure（只含 M1，待核准）

目標：用一次自然排程，判定目前 FINMIND_TOKEN 是否具 sponsorpro 整日 parquet（`/api/v4/storage_objects`）能力。**不 ingest、不解析 parquet、不引入任何依賴。**

不包含（明確排除）：M2 bulk ingest、M3 排序/優先級修正、A fallback、parquet/Arrow 依賴、UI、quota 參數、frozen slice。

## 1. Probe 契約

- `GET https://api.finmindtrade.com/api/v4/storage_objects?dataset=TaiwanStockTradingDailyReport&date=<latest eligible trading day>`
- Header：`Authorization: Bearer <FINMIND_TOKEN>`（token 不入 log、不入 response、不入 DB）
- date（**修正**）：既有 `resolveProbeDate()`（`_shared/finmindMarketBatch.ts:104–112`）簽名為 `resolveProbeDate(base: Date = now - 3d)`，**不吃 supa**，內部只用 `getUTCDay()` 把週六→週五、週日→週五，**完全不認台股國定休市**，且固定往前 3 天（N1 的 `probe_date=2026-08-11` 就是 08-14 減 3 天）。因此不可沿用。
  修正方式（不新建 resolver/table）：改為讀既有 DB 交易日曆 —— `public.tw_trading_days(_from,_to)`（`STABLE SECURITY DEFINER`，內部 `EXTRACT(DOW) NOT IN (0,6)` 且 `NOT EXISTS tw_market_holidays`），以最小唯讀查詢取
  `select max(td) from public.tw_trading_days(current_date - 10, (now() at time zone 'Asia/Taipei')::date) td`，即 **<= Taipei today 的 latest actual trading date**（自動排除國定休市）。此呼叫模式與 `enqueue_chips_prefetch_gaps` 既有寫法一致。
  `resolveProbeDate()` 本身**不刪不改**（其他呼叫點與既有測試維持），probe 改為：DB 查詢成功用 DB 值；查詢失敗才 fallback 既有 `resolveProbeDate()` 並在 `last_probe_error` 標 `calendar_fallback`。
  21:30 執行時官方（21:00）已更新當日資料；週末不排程；若該日尚未產出（404 / 0 bytes）→ `inconclusive`，不得判 unsupported。

## 2. 安全讀取（硬性）

1. `AbortSignal.timeout(90_000)`。
2. 先讀 `content-length`：> `80 * 1024 * 1024` → `inconclusive_oversize`，**不讀 body**。
3. 缺 `content-length` 或不可信：只從 `response.body.getReader()` 逐塊累積，**上限 64 KiB**；湊滿前 4 bytes 判 `PAR1` 後立即 `reader.cancel()` + abort。
4. 禁止 `response.arrayBuffer()` / `res.text()` 整檔；**不驗 tail magic**（需整檔，違反本票）。
5. `Range: bytes=0-65535` 可送，但不假設上游遵守 —— 一律用 (3) 的 64 KiB 上限自保。
6. **JSON / 錯誤 body 一樣受 64 KiB 上限**（**修正**）：signed-URL JSON 與所有錯誤訊息都只從同一個 bounded reader 取前 ≤ 64 KiB，再 `TextDecoder` 解碼、`JSON.parse`（parse 失敗即當純文字），解析後立即 cancel。**任何情況都不得呼叫 `res.text()` / `res.json()`**（兩者皆無上限）。

## 3. 判定表（tri-state；**precedence 由上而下，先看 HTTP status**）

| 順位 | 觀察 | outcome | 寫入 |
|---|---|---|---|
| 1 | **HTTP 401**（無論 body 是否含 permission/plan/sponsor 字樣） | `inconclusive`（`auth_failed`） | **保留 `supported`／`probed_at` 前值**，只寫 `last_probe_outcome/at/error='auth_failed:…'`，需告警；**永不寫 supported=false** |
| 2 | HTTP 403，或 body 明示 sponsor/plan/upgrade/permission | `unsupported_plan` | `supported=false`, `probed_at=now`，遮罩後 msg |
| 3 | HTTP 400 參數契約錯 | `unsupported_contract` | `supported=false`，遮罩後 msg |
| 4 | 200 且前 4 bytes = `PAR1` | `supported` | `supported=true`, `probed_at=now`, `format='parquet'` |
| 5 | 200 且 bounded JSON 含 signed URL 欄位 | `supported` | `supported=true`, `format='signed_url_unverified'`；**URL 不記錄、不跟隨**，T2 前不 ingest |
| 6 | 404 / date not ready / 0 bytes / 429 / 5xx / timeout / bad magic / oversize | `inconclusive` | 保留 `supported` 與 `probed_at` 前值，只更新 `last_probe_outcome/at/error` |

實作順序即上表順序：`if (status === 401) → auth_failed` 必須是第一個分支，body 字樣比對只能在 401 分支**之後**執行。所有 error 字串一律遮罩 token 尾碼後截斷 300 字。


## 4. 精確 diff 邊界

允許變更（僅三處）：

1. `supabase/functions/_shared/finmindMarketBatch.ts`
   - 新增 `probeStorageObjectsCapability()`：實作 §1–§3；沿用既有 `loadMarketBatchConfig/updateMarketBatchConfig`。
   - `MarketBatchConfig` 診斷欄位擴充：`last_probe_format?`（僅在既有 diagnostics 區塊擴充，不動既有欄位語意）。
   - `isCapabilityFailure()` 擴充為 §3 分類；舊 `/v4/data` 無 `data_id` 的 400 明確歸 `unsupported_contract`。
   - `probeMarketBatchSupport()` 改為呼叫新 probe（保持既有 24h idempotency 與 `force` 語意），**回傳物件既有 top-level keys 不增不減**（`supported/outcome/stocks/probe_date/sample?/skipped?/error?`），新診斷只寫進 config。
2. 對應測試：`supabase/functions/_shared/finmindMarketBatch_test.ts`。
3. 一筆 migration：`cron.alter_job(67, schedule => '30 13 * * 1-5')`，**command 原樣保留**（含 payload `{"mode":"probe","force":true}`）；不 unschedule/reschedule、不改 jobid/jobname/active/database/username。

`supabase/functions/tw-bsr-finmind-sync/index.ts`：**預期 0 行變更**。`mode === 'probe'` 分支（L1002–L1007）已是 `probeMarketBatchSupport(supa,{force,probeDate})` 並 `json({ok:true, mode, ...result})`；因為回傳 shape 不變，無需 wire-up。若實作中發現必須改，先回報再改，不自行擴張。

Frozen：`claim_bsr_queue_jobs`、`finmind_admit_v2`、quota pools、`snapshotFulfillment.ts`、`enqueue_bsr_backfill`/`app_role`、所有其他 cron 與 UI。

回滾：Edge 單檔 revert + 一筆 `cron.alter_job(67, schedule => '21 7 * * 1-5')`。

## 5. 測試（先行、離線）

- 200 + `PAR1`，上游忽略 Range 回大 body → 讀取量 ≤ 64 KiB 且 reader 被 cancel。
- `content-length` = 100 MB → body **未被讀取**，outcome `inconclusive`（oversize）。
- 200 JSON signed URL → `supported`、`format=signed_url_unverified`、輸出與 config 皆**不含 URL**、無第二次 fetch；且 JSON 只從 bounded reader 讀（斷言未呼叫 `res.text()`/`res.json()`，讀取量 ≤ 64 KiB）。
- **401 且 body 含 `permission`/`sponsor` 字樣** → 必須是 `inconclusive`/`auth_failed`，斷言 `supported` 與 `probed_at` **前值不變**（不得落到 `unsupported_plan`）。
- 403/plan 字樣 → `unsupported_plan`；400 contract → `unsupported_contract`；404 / 0 bytes / 429 / 5xx / timeout / bad magic → inconclusive 保留前值。
- probe date：mock DB 回傳含國定休市的情境，斷言取到 `tw_trading_days` 的 latest trading date（非單純 weekday roll-back）；DB 查詢失敗 → fallback `resolveProbeDate()` 且 error 含 `calendar_fallback`。
- success response top-level keys added/removed = 0（快照比對）。
- 既有 `finmindMarketBatch_test.ts`、`snapshotFulfillment_test.ts`、ephemeral BSR scoped SQL regressions 全綠。

## 6. 上線與稽核步驟（核准後執行一次）

1. 離線測試全綠（含既有回歸）。
2. Migration 前：只讀存 job67 完整 row + 其他 cron hash。
3. 套用 migration 一次 → read-back job67 完整 row（schedule=`30 13 * * 1-5`、command 逐字不變）、其他 cron exact diff = 0。
4. Deploy `tw-bsr-finmind-sync` 一次（若最終 index.ts 0 行變更，仍需 deploy 以帶入 `_shared` 改動）；read-back remote version / deployment_id，取不到即標 **UNPROVEN**，不得沿用舊 version。
5. **不得** manual invoke、不得 Publish、不得開任何個股抽屜。

## 7. 驗收（implementation green ≠ acceptance）

停在等待**今晚 Taipei 21:30（UTC 13:30）自然 job67**。屆時以 `cron.job_run_details runid → cron_edge_call request_id → net._http_response status/body → tw_bsr_sync_config.market_batch` 判定 T1：

- `supported=true` → T1 PASS，才可討論 T2（parquet runtime 可行性）。
- `unsupported_plan` / `unsupported_contract` → T1 FAIL，改談 A fallback（另票）。
- `inconclusive`（含 401）→ T1 PENDING，記錄原因，不重跑、不改方案。
