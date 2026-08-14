# P6 Decision Memo — Lane A 保鮮 + Probe 安全修補（Plan only）

T1 已定案：FINMIND_TOKEN 為 sponsor 等級，`storage_objects` bulk 僅限 sponsorpro。C1/T2 終止，不再規劃 parquet ingest。

## A. 今晚已證實現況（唯讀）

### A1 使用者持股 universe
| 指標 | 值 |
|---|---|
| `checkup_storage` key=`pf-holdings-v2` 列數 / 使用者 | 36 列 / 36 users（全部 `jsonb` array） |
| 陣列非空、真正持有部位的使用者 | **5 users**（其餘 31 users 為空陣列） |
| 持股項目總數 / distinct codes | 45 items / **42 distinct codes** |

修正先前說法：36 是「有 checkup 儲存列」的人數，不是「有持股」的人數。

42 codes 分兩類：
- **29 檔四位數普通股**：1314 1513 1711 1717 2303 2308 2313 2330 2344 2543 3017 3042 3189 3231 3443 3481 3491 3529 3617 3702 4583 4958 4979 5271 6180 6239 6770 6862 8086
- **13 檔六位數權證／非 BSR 標的**：039452 051257 053848 055858 057581 061792 066317 067620 069239 705200 705747 708107 730636

### A2 逐檔新鮮度（2026-08-14 21:3x 快照）
| 類別 | 檔數 | `tw_bsr_daily` latest | `tw_chip_fact` latest | queue pending/running |
|---|---|---|---|---|
| 四位數普通股 | 29 | **全部 2026-08-14（今日）** | 全部 2026-08-14 | **0** |
| 六位數權證類 | 13 | 無資料（從未落地） | 無 | 0 |

結論：**Lane A 普通股今日已 fresh，且是在沒有任何人開抽屜的情況下由 server 端完成**。stale saved-eligible = 0。剩下 13 檔屬 BSR 不適用標的（權證），須以 ineligible 明確標示，不能算 stale，也不該持續佔配額。

### A3 其他 universe（分開計，不得混稱「使用者持股」）
`checkup_prefetch_universe()` 定義（已讀 production 定義）由四個來源 UNION：`trade_records`、published `expert_signals`、`checkup_storage(pf-holdings-v2)`、`chips_prefetch_targets(registry)`，並用 `tw_bsr_eligibility(code)` 判 supported。三者互為獨立集合，本輪只把 `pf-holdings-v2` 視為「使用者已保存持股」。
（受限：psql/read_query 角色無 EXECUTE 權限，無法在唯讀稽核中直接呼叫 `checkup_prefetch_universe()` 取各來源 count；此項標 **UNPROVEN**，改在 ephemeral 以相同定義複算。）

### A4 今晚自然排程證據
| job | 名稱 | 排程 | 今晚 runid | status |
|---|---|---|---|---|
| 106 | chips-prefetch-enqueue-hourly | `2 * * * *` | 533606（13:02 UTC） | succeeded |
| 107 | tw-bsr-worker-hourly | `7 * * * *` | 533628（13:07 UTC） | succeeded |
| 53 | tw-bsr-enqueue-holdings-delta | `0,30 7-12 * * 1-5` | 533449（12:30 UTC） | succeeded |
| 46 / 51 | worker-trading / tier1-catchup | `*/10`、`*/15` 6-12 | 533550 / 533523 | succeeded |

13:02–13:09 期間 `net._http_response` 無 BSR enqueue/worker 錯誤，`dispatched: []`（該時段已無缺口可派），與 A2 的「今日全 fresh」一致。

### A5 配額實況（今日）
| pool | daily_budget | used_today | tokens | 備註 |
|---|---|---|---|---|
| interactive | 240 | **240（已用盡）** | 182 | 今日 `daily_exhausted` 風險已成真 |
| keepwarm | 960（base 480＋boost） | 106 | 236 | 尚有餘裕 |
| backfill | 600 | 166 | 232 | 尚有餘裕 |

42 saved holdings 中僅 29 檔需要 BSR；以近期 worker 實測每股約 4 requests 計，Lane A 全量每日成本約 **116 requests**，遠低於 interactive 240，**容量不是瓶頸**；瓶頸是 ordering 公平性與 interactive 被冷門股回補吃光。

## B. 精確根因

1. **公平性**：`detect_chip_gap_jobs` 最後一行 `ORDER BY g.cnt DESC LIMIT _max_jobs` — 依缺口數排序。冷門股缺 60 日會排在「持股缺 1 日」之前；一旦 universe 擴張且 `p_max_stocks` 截斷，saved holdings 可能整批被擠出當輪。今日之所以沒出事，是缺口總量小，不是機制保證。
2. **priority flattening**：`enqueue_chips_prefetch_gaps` 只用 `CASE WHEN d = v_end THEN 1 ELSE 2 END` 決定 priority，**完全不看來源**；`detect_chip_gap_jobs` 的 RETURNS TABLE 也沒有 source 欄位，所以 saved holding 與 registry 冷門股在 queue 中不可區分。
3. **token 洩漏**：`maskProbeError`（`finmindMarketBatch.ts` L139-144）只處理「完整 token 字串」「`token=`」「`Bearer `」三種形態。上游 400 body 自帶 JSON key `token_tail`（token 尾碼），三條規則都不命中，於是原樣寫進 Edge response、`net._http_response`、`tw_bsr_sync_config.market_batch.last_probe_error`。
4. **job67**：deterministic `unsupported_plan`，每工作日重探無新資訊。

## C. 建議最小方案（不新增 table / control plane / UI）

### C1 安全修補（必做）
- 在 `finmindMarketBatch.ts` 新增單一 `sanitizeUpstreamError(input)`，取代所有 `maskProbeError` 呼叫點（8 處）：
  - 先嘗試 bounded JSON parse；遞迴走訪物件，key 名（不分大小寫）符合 `token|access_token|api_key|authorization|secret|signed_url|url` 一律替換為 `***`，只保留白名單 `msg|status|code|detail`。
  - 非 JSON 走純文字：先以實際 `FINMIND_TOKEN` 全字串替換，再以 token-like regex（`[A-Za-z0-9_\-]{20,}`、`Bearer\s+\S+`、`token\w*\s*[=:]\s*\S+`）遮罩。
  - 最後統一截斷 300 字。
  - 只有 sanitized 字串可進 Edge response / `tw_bsr_sync_config` / `console.log`；signed URL 一律不落地。
- 保留既有 401 precedence 與 bounded reader 行為，不動。

### C2 清除既有落地尾碼
一筆 migration，只做一次精確 UPDATE：
```sql
UPDATE public.tw_bsr_sync_config
   SET config = jsonb_set(config, '{last_probe_error}', '"unsupported_plan:sponsor_level"'),
       version = version + 1, updated_at = now()
 WHERE key = 'market_batch'
   AND config->>'last_probe_error' LIKE 'unsupported_plan:http_400:%';
```
- 回滾：同形 UPDATE 寫回 `unsupported_plan:http_400`（不含尾碼）之安全摘要；不還原原字串。
- **保留風險**：`net._http_response` id 244777 與 function edge logs 仍含尾碼。這兩者屬審計/系統表，本票不刪除。`net._http_response` 依既有 retention 自然淘汰（另列觀察項）；如需提前清除，需另開票並取得授權。

### C3 job67 降頻
單一 `cron.alter_job(67, schedule => '30 13 * * 1')`；jobid/name/command/payload/active/database/username 全不變；其他 cron exact diff = 0。

### C4 Lane A 公平性（沿用既有物件）
- `detect_chip_gap_jobs`：RETURNS TABLE 增加 `source_class smallint`（1 = saved holdings、2 = trade_records、3 = 其他 universe），改以
  `ORDER BY source_class ASC, (end_date = _target_date) DESC, gap_count DESC, stock_id ASC`
  取代單一 `cnt DESC`；分級來源以 `checkup_prefetch_universe()` 已回傳的 `sources[]` 直接 join，不新增表。ordering 完全 deterministic。
- `enqueue_chips_prefetch_gaps`：priority 改為
  `CASE WHEN source_class = 1 THEN 1 WHEN source_class = 2 THEN 2 ELSE CASE WHEN d = v_end THEN 3 ELSE 4 END END`，
  並讓 `enqueued_by` 帶上來源（`chips_prefetch_hourly:h1|h2|h3`）以利稽核；`ON CONFLICT DO NOTHING` 冪等語意不變。
- **反飢餓**：priority 3/4 仍保留既有 recovery/backfill 預算（`bsr_recovery_budget`），不得因 Lane A 優先而永久不執行；每輪至少保留既有 token slot 機制（Build 1f 的 claim 邏輯**凍結不動**）。
- `trade_records` 定位：`checkup_prefetch_universe` 用其 `instrument` 前綴解析代號，代表專家/使用者實際部位紀錄 → 給 priority 2（次於 saved holdings、先於 registry）。

### C5 排程整合
不新增 cron。沿用 job106（每小時 :02 enqueue）＋ job107（每小時 :07 worker）＋ job53 holdings-delta。FinMind 21:00 更新後，21:02 enqueue → 21:07 worker 自然補當日 saved holdings。盤前／盤中若上游回空，維持既有 `finmind_empty` 語意不消耗 attempts 上限之外的配額；不改 quota 表。

### C6 失敗語意（不變）
quota exhausted → deferred/skipped；failed date → partial；stale running → `recover_stale_bsr_queue_jobs`。worker succeeded ≠ 完成，驗收一律看 saved-eligible freshness。

## D. Exact diff / frozen / 測試 / 驗收

### 允許變更（僅此）
- `supabase/functions/_shared/finmindMarketBatch.ts`（sanitizer）
- `supabase/functions/_shared/finmindMarketBatch_test.ts`（sanitizer cases）
- migration #1：`tw_bsr_sync_config.market_batch.last_probe_error` 清洗
- migration #2：`cron.alter_job(67, schedule => '30 13 * * 1')`
- migration #3：`CREATE OR REPLACE` `detect_chip_gap_jobs` + `enqueue_chips_prefetch_gaps`
- 對應 ephemeral SQL test 檔

### 凍結（diff 必須為 0）
`claim_bsr_queue_jobs`（Build 1f pinned hash）、quota pools/ledger、snapshot fulfillment、`tw-bsr-finmind-sync/index.ts`、所有 UI、`enqueue_bsr_backfill` / `app_role` out-of-scope 缺陷。

### 測試門檻（任何 FAIL 即 STOP）
1. sanitizer：nested `token_tail`、大小寫變體（`Token_Tail`/`ACCESS_TOKEN`）、signed URL key、純文字 `Bearer xxx`／`token=xxx`、長 token-like 字串、正常 `msg/status` 必須保留、300 字截斷。
2. ephemeral SQL：持股缺 1 日 vs 冷門股缺 60 日 → 持股先入隊且 priority=1；42 codes > batch limit 時公平分頁、無持股永久漏；priority/pool 對應正確；重跑冪等（inserted=0）；quota exhausted → deferred；partial failed date；stale running recovery。
3. 完整 M1 / Build 1f scoped regression：`finmindMarketBatch_test.ts`、`snapshotFulfillment_test.ts`、`market_batch_fulfill_e2e_test.sql`、`bsr_metrics_contract_test.sql`、`ensure_bsr_queued_test.sql`、`bsr_claim_token_slot_test.sql`、`finmind_admit_v2_test.sql`、`orchestrator_snapshot_test.sql`、`bsr-claim-equivalence.sh` pinned hashes。

### 自然驗收（不得 manual invoke）
- Implementation 後只 deploy 一次 Edge、套 migration，之後等下一個自然 job106（:02）→ job107（:07）；錯過 22:02/22:07 就等 23:02/23:07。
- 證據鏈：cron runid → request_id → `net._http_response` → `tw_bsr_sync_queue`（priority 分佈）→ 29 檔 saved eligible 的 `tw_bsr_daily`/`coverage`。
- **PASS 條件**：saved eligible stale = 0、13 檔權證明確標 ineligible（非 stale）、interactive pool 未因 Lane A 而 daily_exhausted、其他 cron diff = 0、`last_probe_error` 不含尾碼。
- Preview：E2E 帳號仍 0 holdings → per-holding Preview **BLOCKED**，不建立假持股；只做 authenticated page 0-enqueue 與 server-side 36 users / 42 codes 兩段。

## 待確認事項
- `detect_chip_gap_jobs` / `enqueue_chips_prefetch_gaps` 目前皆為 `CREATE OR REPLACE` 可回滾（保留現行定義全文作 rollback SQL）。
- 各來源 distinct code counts 需在 ephemeral 以相同定義複算（production 角色無 EXECUTE 權限），此數字在實作票中補齊，不得沿用推測值。
