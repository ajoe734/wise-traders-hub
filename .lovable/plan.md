# Plan v6 — Holdings freshness。分階段獨立核准，本輪只做 isolated clone/harness

## 0. 核准邊界（修正 v5 §7 的矛盾）

**本次 Approve 僅授權：在 disposable production-shape clone 與 local/Preview harness 上產出 artifacts。**
不含任何 production DDL/DML/GRANT/Edge deploy/cron 變更/Publish。

每個 stage 上 production 前，必須各自走：**stage preflight（唯讀證據）→ 單獨核准 → 執行 → stage verifier → 明確 stop point**。任一 stage 未核准，後續 stage 不得開始。

| Stage | production mutation（未來、需單獨核准） | rollback |
|---|---|---|
| H-1 provider probe | 無（唯讀／外部 probe） | 無 |
| H0 觀測 | 新 Edge `tw-bsr-finmind-sync-v2`（**新建，不覆寫**）＋唯讀 `public.freshness_run_trace` VIEW（**不新增 table**）＋既有 `tw_bsr_attempt_logs` 的欄位補寫；cron 107 target 切到 v2 | cron target 切回舊函式；v2 保留不刪；drop VIEW（無資料損失） |
| H1 market master | 新表 `tw_market_symbols`＋新 Edge `tw-market-master-sync`＋新 cron | 停 cron、drop 表；不影響 `stock_names` |
| H2 demand registry | 新表 `symbol_demand_registry`＋`SECURITY DEFINER` RPC（只給 service_role）＋新 Edge `symbol-demand-register` | drop Edge/RPC/表 |
| H3 enqueue/worker | `CREATE OR REPLACE` 兩個**自有 SQL 函式**（`enqueue_chips_prefetch_gaps`、`claim_bsr_queue_jobs`；先存前版定義）＋ v2 worker 內邏輯 | 以前版定義 replace 回去；cron 切回舊函式 |
| H4 provider 切換／weekend policy | 新 Edge `tw-market-daily-ingest`＋policy flag（`system_kill_switches` 新增列，**不改既有列**） | flag 關閉；停新 cron |
| H5 drawer 純讀 | 新 Edge `tw-chips-detail-v2`；前端 endpoint 切換 | 前端切回 `tw-chips-detail`；舊函式原封不動 |
| H6 前端 UI/E2E | 僅前端程式 | revert |

## 1. 為什麼不含 S1-min（維持 v5 結論）

`rg -l "app_ledger|public_projection_version|public_projection_withheld|replay_manifest_key" src supabase e2e` → **0 檔**。freshness 鏈沒有任何 object 依賴 S1-min。S1-min 維持 clone-only PASS、production **NO-GO**，artifacts 僅留作未來獨立 migration 證據。

## 2. B — side-by-side versioned functions（禁止覆寫未知 bundle）

現有 prod Edge bundle hash 不可取得 → **一律新建版本化函式，不 `CREATE OR REPLACE`／不 overwrite**。

Routing 與 callers（已盤點）：

`tw-bsr-finmind-sync` 呼叫端
- cron 107 `tw-bsr-worker-hourly` → `cron_edge_call('tw-bsr-finmind-sync', …)`
- `supabase/functions/tw-chips-orchestrator/index.ts`
- 測試：`supabase/functions/tw-bsr-finmind-sync/{lib_test,queue_simulator_test,manual_and_source_test,enqueue_filter_test}.ts`
- 文件：`docs/ops/bsr-finmind-runbook.md`、`docs/security/edge-function-auth-matrix.md`

`tw-chips-detail` 呼叫端
- 前端：`src/checkup/lib/chipsRepository.ts`（`fetchChipsPayload/fetchChipsStamp/fetchChipsBatch`）→ `useTwChipsDetail` → `ChipsSection`
- harness：`src/pages/ChipsSectionHarnessEntry.tsx`
- E2E：`e2e/chips-section*.spec.ts`、`chips-batch`、`chips-coalesce`、`chips-telemetry-contract`
- 契約測試：`src/test/integration/tw-chips-detail-public-contract.test.ts`

切換方式：只改「呼叫目標字串」——cron 的 function name、前端 repository 的 endpoint 常數。rollback = 把字串切回舊值；舊函式永遠保留、永不刪除、永不覆寫。

## 2.5 H0 觀測：不新增 sidecar table，先用既有 log ＋唯讀 VIEW

既有四張 log 的實際 schema／索引／現況（本輪唯讀查得）：

| 表 | 欄位 | 時間欄 | 相關索引 | 現況 |
|---|---|---|---|---|
| `cron.job_run_details` | pg_cron 內建（jobid, runid, status, return_message, start_time, end_time） | `start_time` | pg_cron 內建 | 有資料；近 24h 48 runs 全 `succeeded` |
| `public.cron_dispatch_log` | `id, jobname, request_id, dispatched_at` | `dispatched_at` | `idx_cdl_job_time(jobname, dispatched_at DESC)`、`idx_cdl_request(request_id)` | **0 列**（`cron_edge_call` 未寫入） |
| `public.edge_boot_events` | `id, fn, boot_at, region, deployment_id` | `boot_at` | `(fn, boot_at DESC)`、`(boot_at DESC)` | 452,163 列 / 110 MB，2026-06-08 起無 cleanup |
| `public.tw_bsr_attempt_logs` | 24 欄，已含 `correlation_id, run 相關 http_status, error_class, outcome, latency_ms, attempt_step, config_version` | `attempted_at` | 10 個索引，含 `cid_idx(correlation_id)` | **0 列**（worker 從未寫入） |
| （輔助）`public.function_run_logs` | `fn, run_id, level, stage, msg, payload` | `created_at` | — | 11,792 列，可提供 `run_id` 對應 |

**共同 correlation 欄位**：`tw_bsr_attempt_logs.correlation_id`（uuid）、`tw_bsr_fetch_failures.correlation_id`、`tw_bsr_sync_queue.correlation_id` 已一致；缺的是把同一個 `correlation_id` 帶到 `cron_dispatch_log`（目前只有 `request_id`）與 `edge_boot_events`（目前只有 `deployment_id`）。

結論：**不新增 `bsr_run_trace` table**。
- `tw_bsr_attempt_logs` 欄位已足夠涵蓋 attempt 級事件（不需擴充欄位，只需 v2 worker 真的寫入）。之所以不改用「擴充 attempt_logs」承載 cron/boot 級事件，是因為它的粒度是 (stock_id, trade_date, attempt)，塞入 run 級事件會讓 PK 語意破裂並汙染既有 10 個索引。
- cron 級與 boot 級各自有既有表，只缺兩個既有欄位的寫入：`cron_dispatch_log` 增寫 `correlation_id`、`edge_boot_events` 增寫 `correlation_id`（**這兩個是既有表的 additive column，不是新表**；若因故不可加欄，退而以 `cron_dispatch_log.request_id` ↔ `pg_net` response 對應，仍不需新表）。
- 串接以唯讀 `public.freshness_run_trace` VIEW 完成：`cron.job_run_details` ⋈ `cron_dispatch_log`（jobname+時間窗）⋈ `edge_boot_events`（fn+時間窗/correlation）⋈ `tw_bsr_attempt_logs`（correlation_id）⋈ `bsr_coverage_daily`（trade_date）。VIEW 只給 company_admin，anon/authenticated 不授權。
- **只有**在 clone 上證明某事件（例如 worker 因 OOM 未 boot 也未寫任何 log）四張表皆無法承載時，才提 sidecar table，並附「為何不能擴充 attempt_logs」的具體理由。

Retention / cleanup（H0 驗收必含，避免無限增長）：
- `edge_boot_events` 目前無 cleanup、110 MB 且持續成長 → 新增 `cleanup_old_edge_boot_events(30 days)`，比照既有 `cleanup_old_*` 家族由既有 cleanup cron 呼叫。
- `tw_bsr_attempt_logs` 開始寫入後估算：每小時 ≤ 60 attempts × 24 × 30 ≈ 43k 列/月 → 保留 60 天，新增 `cleanup_old_bsr_attempt_logs(60 days)`。
- `cron_dispatch_log` 保留 30 天。
- 驗收條件：cleanup 函式存在、被排程呼叫、且在 clone 上以合成資料驗證刪除筆數正確；三張 log 表各有明確保留期與大小上限估算。

## 3. C — demand registry 濫用防護（順序改為：先 master，後 registry）

client **不直接**碰 RPC 或 table。唯一入口是 Edge `symbol-demand-register`：

- 白名單：symbol 必須在 `tw_market_symbols` 且 `eligibility=true`；正規化（去空白、大寫、4–6 碼 TW 代號）後仍不符 → 回 `unsupported`，**不入表、不排隊**。
- 限流：每 request ≤ 30 symbols；每 IP 每 10 分鐘 ≤ 5 requests、每日 ≤ 60；每 device-id 每小時 ≤ 20；超出回 429，不寫入。
- payload schema validation（Zod）：只接受 `{symbols: string[]}`；**外部 caller 不得指定** `source_class`、`priority`、`request_count`、時間戳——一律由 Edge 以 service role 設定為 `source_class='drawer'`。
- `request_count` 有 cap（單 symbol 上限 10,000）與 decay（每日 ×0.9，30 天無需求則歸零並降級）。
- demand **只影響 fast lane 排序**，不觸發即時抓取；註冊後最快在下一個 hourly run 生效。
- 權限：表對 anon/authenticated **不授 SELECT/INSERT/UPDATE/DELETE**，RLS 全拒；RPC 只給 service_role EXECUTE；讀取僅 company_admin 視圖。
- 欄位：`market, symbol, first_requested_at, last_requested_at, request_count, source_class, updated_at`。無 `user_id`／`quantity`／`cost`。PK `(market, symbol)` → 天然去重。

Threat model 與測試
| 威脅 | 對策 | 測試 |
|---|---|---|
| 灌爆 request_count / 排序毒化 | cap + decay + 每 IP/device 限流 + 只影響排序 | harness 送 10k 次同 symbol，確認 count 封頂、fast lane 前 20 名不被單一來源佔滿 |
| 灌不存在 symbol 燒 API 配額 | master 白名單 + eligibility | 送 50 個亂碼 symbol，assert 表列數 0、queue 增量 0 |
| 表膨脹 | 上限 = master 大小（有限集合），無使用者維度 | assert 列數 ≤ master 列數 |
| aggregate privacy（由熱門度反推個人持股） | 不存 user/quantity；`request_count` 不對外曝光；小樣本 symbol 只存在與否，無時間序 | 查表 schema 斷言欄位清單完全相符 |

## 4. D — H1 market master 權威來源與 eligibility（已完成 capability probe）

實測（本輪唯讀外部 probe，皆 HTTP 200、無需授權）：

| 來源 | 內容 | 大小 | 用途 |
|---|---|---|---|
| `openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` | 上市全市場日收盤 | 319 KB | 上市 master + 價量 |
| `openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL` | 上市本益比/殖利率/PB | 116 KB | 基本面 |
| `www.twse.com.tw/rwd/zh/fund/T86?date=…&selectType=ALL` | 上市三大法人（單日全市場） | 2.0 MB | 法人 |
| `www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes` | 上櫃全市場日收盤 | 4.1 MB | 上櫃 master + 價量 |
| `www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading` | 上櫃三大法人 | 862 KB | 法人 |

- 更新頻率：交易日 T 日 15:00 之後每 30 分重試至成功，T+1 09:00 前必須落地；master 每日一次全量 diff upsert。
- eligibility 分類：`listed`（上市普通股/ETF）→ true；`otc`（上櫃）→ true；`emerging`（興櫃）→ false（來源不同、無日成交彙總）；`warrant`（權證，6 碼英數）→ false；`us_*`／期權／複式單腳 → false。所有 false 一律回 `unsupported`，**不排隊、不重試**，前端顯示「此商品不支援籌碼資料」。
- 10 檔代表商品 capability probe（H-1 交付表格）：2330、2317（上市普通股）、0050、00631L（ETF/槓桿）、6488、5347（上櫃）、6510（上櫃小型）、053040（權證）、6515（既有測資）、AAPL（美股）；逐檔標註 master 命中／價量／法人／分點 四欄可得性。

## 5. E — FinMind HTTP 400 定性與替代路徑（含 BLOCKER）

證據：近 7 天 `tw_bsr_fetch_failures` 517 筆，全部 `reason=finmind_error`、`finmind_http_400:{"msg":"Your level is register. Please update your user level..."}`，最後 2026-08-17 07:21。→ **方案權限永久失敗**，非速率問題，退避無效。分類為 `permanent_auth`，circuit 直接開啟並告警，**不得繼續入 queue 讓它反覆失敗**。

替代路徑欄位映射：
- 價量、master：TWSE/TPEx OpenAPI（上表）→ 完全可取代，無授權需求。
- 三大法人：T86 + tpex_3insti → 完全可取代。
- **分點進出（券商分點 BSR）：目前沒有已驗證的免授權來源。** FinMind `TaiwanStockTradingDailyReport` 需付費層級；TWSE 分點查詢頁非開放 API。→ 標記 **BLOCKER-E1**：在找到合法可用來源（付費授權或官方管道）之前，分點區塊維持「資料檢核中／不支援」，H3 的 fast lane 只涵蓋價量＋法人。
- 「sponsor token」不列入計畫，只列為 BLOCKER-E1 的其中一個待評估選項（需商務決策）。

## 6. F — 容量計算（不是只寫百分比）

輸入參數（以 probe 實測為準，H-1 收斂）：
- N(eligible) ≈ 上市 ~1,050 + 上櫃 ~830 ≈ **1,880 檔**。
- 關鍵事實：TWSE/TPEx 是**全市場單檔 payload**（1 request = 全市場一天）。因此 slow sweep 不是 per-symbol 抓取：**每日 5 個 requests**（上市價量、上市法人、上櫃價量、上櫃法人、上市基本面）即覆蓋 100% universe。
- 每小時安全 request 上限：官方端點取 **hard cap 60 req/hour、600 req/day**（含重試），實測 latency 0.8–6 s／request，最大 payload 4.1 MB。
- 寫入量：上櫃 4.1 MB ≈ 1,880 列/日 × 5 類 ≈ 9.4k 列/日，遠低於現有 `tw_bsr_daily` 每日 40k 列規模。

結論：在全市場批次來源下，「≤5 交易日、95% 覆蓋」的達成不靠 70/30 配額，而是**每日 5 次全量批次**即達 100%；70/30 只適用於仍需 per-symbol 呼叫的資料型別（目前僅 BLOCKER-E1 的分點）。若 E1 解封並且是 per-symbol：以 60 req/h × 12 h = 720 req/日，其中 30% slow sweep = 216 檔/日 → 1,880 ÷ 216 ≈ **8.7 交易日**，**不滿足 ≤5 日** → 屆時必須提高 quota 或改用批次端點，此門檻寫入 H3 驗收條件。

- Hard quota：hourly 60 / daily 600，超出直接停止該 run 並記錄。
- Dead-letter：連續 6 次 transient 失敗 → `bsr_dead_letter`，不再自動重試，需人工釋放。
- Error taxonomy：`permanent_auth`（400 權限）／`permanent_notfound`（404、下市）／`permanent_unsupported`（非 eligible）→ 不重試；`transient_rate`（429）／`transient_net`（5xx、timeout）→ 指數退避 base 2s、cap 300s、jitter ±20%。

## 7. G — 週末 backlog 與備份政策

- 備份對象：`tw_bsr_daily`、`tw_chip_fact`、`tw_chips_rollup`、`bsr_coverage_daily`、`tw_market_symbols`、`symbol_demand_registry`、`tw_bsr_sync_queue`（僅 failed/dead-letter）。
- 形式：每週日一次，per-table CSV + `MANIFEST.json`（列數、欄位、sha256、產生時間、來源 run_id）。
- 目的地：Supabase Storage private bucket `ops-backups`，RLS 全拒，僅 service_role 可寫、company_admin 可簽名下載；傳輸 TLS，儲存側加密由平台提供。
- 保存：週備份保留 8 週，月末一份保留 12 個月，逾期自動刪除。
- Restore rehearsal：每季一次在 disposable clone 還原並逐表比對列數 + sha256，結果寫入 `S0_STATUS` 同格式報告。
- 非交易日判定：以 `tw_market_holidays` + 週末判定；週末 run **只補既有 backlog 與備份**，禁止產生新的 `trade_date`；`next_expected_trade_date` 由 holiday 表推算並寫入 trace，驗收時比對。

## 8. H — drawer 純讀的證明標準

`tw-chips-detail-v2` 必須是 **precompute / read-only**：
- 只做 `SELECT`（`get_bsr_daily_series`、`tw_bsr_eligibility` 皆為 stable 讀取），**不呼叫 `rebuild_bsr_rollup`**；rollup 由 worker/cron 預先物化。
- cache miss → 回 `state: 'pending' | 'unavailable'` 與 `as_of: null`，不得同步 rebuild、不得 enqueue。
- 驗收證明（不只 queue/attempt 增量 0）：
  1. 以 `pg_stat_statements`／session 層 statement log 擷取抽屜請求期間所有 SQL，assert **0 筆 INSERT/UPDATE/DELETE/TRUNCATE**、0 筆 volatile function 呼叫。
  2. `rebuild_bsr_rollup` 呼叫次數 = 0（以函式內 counter 或 statements 比對）。
  3. `tw_bsr_sync_queue`、`tw_bsr_attempt_logs`、`tw_chips_rollup`、`bsr_coverage_daily` 四表 before/after 列數與 `max(updated_at)` 完全不變。
  4. 以只有 SELECT 權限的 DB 角色跑 v2 全部路徑，全綠即證明無寫入路徑。

## 9. Stage dependency DAG

```text
H-1 provider probe ──┬── H1 market master ── H2 demand registry ──┐
                     │                                            ├── H3 enqueue/worker ── H4 provider切換+weekend
                     └── H0 觀測(v2 worker + trace) ───────────────┘                             │
                                                                                  H5 drawer v2 純讀 ── H6 前端 UI/E2E
```
- H0 與 H1 可並行；H2 必須在 H1 之後（白名單相依）。
- H3 需要 H0（可觀測）與 H2（需求來源）同時就緒。
- H5 需要 H3/H4 讓 rollup 有背景維護者，否則抽屜改純讀會拿不到資料。
- BLOCKER-E1 只擋「分點」資料型別，不擋 H0–H2、H5、H6。

## 10. 先做哪個 isolated clone / harness（本輪唯一授權範圍）

1. **Clone `hfreshA`**（production-shape，disposable）：套 H0＋H1＋H2 的 DDL 與 RPC，跑 registry abuse 測試（灌量、亂碼 symbol、限流）與 master upsert 冪等測試。
2. **Local harness `harness/provider-probe`**：對五個官方端點 + 10 檔代表商品做 capability probe，輸出欄位映射表與 `unsupported` 判定表（H-1 交付物）。
3. **Clone `hfreshB`**（第二座全新）：只驗 H5 —— 以 SELECT-only 角色跑 `tw-chips-detail-v2` 全路徑，證明 §8 的四項寫入零增量。

三者完成後各自出 stage preflight 報告，再逐一請求 production 核准。

## 11. 驗收（沿用並強化）

1. 連續 3 個自然 hourly run_id 完整串鏈：`cron.job_run_details` → `cron_dispatch_log` → `edge_boot_events` → claim → attempt log → 寫入 → coverage，`correlation_id` 一致。
2. 週末 run 不得出現非交易日 `trade_date`；`next_expected_trade_date` 正確。
3. 抽屜開啟前後：§8 的四項零增量全部成立。
4. registry 抽樣：欄位清單與規格完全一致，無 user/quantity/cost。
5. 測試邊界分欄：production read-only／anon 可測者（cron 鏈、覆蓋率、週末判定、anon 抽屜唯讀）與 Preview fixture 可測者（登入態註冊、view-as）分開計分；**mocked E2E 不得計入 production 真資料證據**。

## 12. 本輪邊界

不執行、不 deploy、不 Publish、production 0 touch。Approve 僅代表授權 §10 的 clone/harness 產出。
