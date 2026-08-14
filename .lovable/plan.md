# P6-R1 Decision Memo — Lane A 公平性 + Probe 安全修補（Plan only）

T1 定案：token 僅 sponsor，C1/T2 終止。本票不新增 table/control plane/UI，不碰 `enqueue_bsr_backfill`/`app_role`。

## 1. Production signatures 與全部 callers（唯讀已證）

| function | identity args | RETURNS | 現行 md5(functiondef) |
|---|---|---|---|
| `detect_chip_gap_jobs` | `_target_date date, _lookback_days integer, _max_jobs integer` | `TABLE(stock_id text, start_date date, end_date date, gap_count integer)` | `ba725bea0ae8eaa096d8ebddefd9e7b0` |
| `enqueue_chips_prefetch_gaps` | `p_lookback_days integer, p_max_stocks integer` | `jsonb` | `207377a5e96c9ca54a6ef8b71f461cd1` |
| `checkup_prefetch_universe` | （無） | `TABLE(code text, supported boolean, reason text, sources text[])` | `cfcff9272446d21ce7494679be1c2c39` |
| `claim_bsr_queue_jobs`（凍結） | `_batch integer, _max_priority integer` | `SETOF tw_bsr_sync_queue` | `9180cf172f8f5e7be5af7aa789cfe48d` |

`detect_chip_gap_jobs` callers：
- `supabase/functions/backfill-gap-orchestrator/index.ts:136` — `rpc(_target_date,_lookback_days,_max_jobs)`，讀 `{stock_id,start_date,end_date,gap_count}`
- `supabase/functions/tw-trading-calendar-catchup/index.ts:94` — 同上，型別 `GapRow`
- `public.enqueue_chips_prefetch_gaps`（DB 內部 `FOR g IN SELECT * FROM ...`，**用 `SELECT *`，欄位順序敏感**）
- `supabase/tests/chips_prefetch_universe_test.sql:76`
- fixtures：`bsr_slice_functions.sql`、`bsr_e2e_functions.sql`、`bsr_slice_expected.tsv`、`scripts/bsr-slice-verify.sh`、`scripts/gen-bsr-e2e-fixture.sh`
- 型別鏡像：`src/integrations/supabase/types.ts`

`enqueue_chips_prefetch_gaps` callers：cron job 106（`SELECT public.enqueue_chips_prefetch_gaps(10, 300);`）、`chips_prefetch_universe_test.sql:94-95,189`。

**結論**：`detect_chip_gap_jobs` 對外 return columns 與順序**逐字不變**（4 欄、同名同型同序），`source_rank` 只以函式內 CTE 存在並僅參與 `ORDER BY`。Postgres `CREATE OR REPLACE` 亦因此合法（不改 return type）。撤回 P6 的「新增 source_class 欄位」設計。

## 2. 合法 priority / pool 映射（唯讀已證，不發明 4）

- `tw_bsr_sync_queue_priority_check`：`CHECK (priority = ANY (ARRAY[1,2,3]))` → **priority 只能是 1/2/3**。
- `tw-bsr-finmind-sync/index.ts:115` `tierFromPriority`：`<=1 → 1`、`=2 → 2`、其餘 → 3。
- 同檔 `poolFromTier`（L54）：tier1 → `interactive`、tier2 → `keepwarm`、tier3 → `backfill`。
- worker cron 實際 `max_priority`：
  - job 46 `tw-bsr-worker-trading`（`*/10 6-12 * * 1-5`）→ `max_priority: 3`
  - job 107 `tw-bsr-worker-hourly`（`7 * * * *`, `ignore_window: true`）→ `max_priority: 3`
  - job 51 `tw-bsr-worker-tier1-catchup`（`*/15 6-12 * * 1-5`）→ `max_priority: 1`

→ priority 3 由 job 46/107 每小時、盤中每 10 分自然 claim，**不會永不處理**。採用映射：

| 來源 | priority | tier | quota pool |
|---|---|---|---|
| `checkup_storage` `pf-holdings-v2` 使用者已保存持股 | 1 | 1 | interactive |
| `trade_records` **status='open'** 的專家部位（見 §4） | 2 | 2 | keepwarm |
| published `expert_signals`、registry、其餘 universe | 3 | 3 | backfill |

現行 `enqueue_chips_prefetch_gaps` 的 `CASE WHEN d = v_end THEN 1 ELSE 2 END` 會把冷門股的最新日也塞進 priority 1／interactive，這正是 interactive 被非持股標的吃掉的機制路徑。

## 3. 公平分頁（可證明）

現況（已讀定義）：
- `detect_chip_gap_jobs` 只比對 `tw_bsr_daily` 缺漏，**完全不看 `tw_bsr_sync_queue`**；最後 `ORDER BY g.cnt DESC LIMIT _max_jobs`。
- `enqueue_chips_prefetch_gaps` 插入時 `ON CONFLICT DO NOTHING`，對應唯一索引 `tw_bsr_sync_queue_active_uniq (stock_id, trade_date) WHERE status IN ('pending','running','failed','skipped')`。

→ 缺陷：一檔已 `failed`/`skipped` 的 code 每輪都會被 detect 選中、佔掉 `_max_jobs` 名額，插入卻被 ON CONFLICT 吃掉；當 `_max_jobs` < 待補檔數時，後段永久不被選到。

修正（皆在函式體內，contract 不變）：

`detect_chip_gap_jobs` 內部改為
```sql
missing AS (
  SELECT e.symbol, e.trade_date
    FROM expected e
    LEFT JOIN existing ex ON ex.stock_id = e.symbol AND ex.trade_date = e.trade_date
    LEFT JOIN public.tw_bsr_sync_queue q
           ON q.stock_id = e.symbol AND q.trade_date = e.trade_date
          AND q.status IN ('pending','running')      -- 已在途 → 本輪不重複佔名額
   WHERE ex.stock_id IS NULL AND q.id IS NULL
),
ranked AS (  -- 內部 CTE，不外露
  SELECT g.*,
         CASE WHEN 'checkup_storage' = ANY(u.sources) THEN 1
              WHEN 'trade_records'   = ANY(u.sources) THEN 2
              ELSE 3 END AS source_rank
    FROM gaps g JOIN universe_src u ON u.code = g.symbol
)
SELECT r.symbol AS stock_id, r.min_date AS start_date, r.max_date AS end_date, r.cnt AS gap_count
  FROM ranked r
 ORDER BY r.source_rank ASC,
          (r.max_date = _target_date) DESC,   -- latest expected trade date 優先
          r.cnt DESC,                          -- 其次才是 history gap 深度
          r.stock_id ASC                       -- 同級 deterministic
 LIMIT _max_jobs;
```
`failed`/`skipped` 仍留在候選內（由 `recover_stale_bsr_queue_jobs` / quota recovery 既有機制處理），但因排在同級末位且已在途者被排除，**單一失敗 code 不會卡住其餘 41 檔**；連續輪次會把剩餘檔數依 deterministic 順序輪完。

`enqueue_chips_prefetch_gaps` 內部：以相同 `checkup_prefetch_universe()` 的 `sources[]` 於函式內 CTE 重新判 rank（**不依賴 detect 新欄位、不新增 helper/table**），priority 直接取 `source_rank`（1/2/3），`enqueued_by` 改為 `chips_prefetch_hourly:r1|r2|r3` 供稽核。

## 4. `trade_records` 語意（誠實命名）

Schema（已讀）：`expert_id`、`signal_id`、`instrument`、`entry_date/exit_date`、`status`（enum `trade_status`: open/closed/stopped）、無 `user_id`。
→ 這是**專家發訊產生的部位紀錄**，不是使用者持股，且含已平倉 (`closed`/`stopped`) 歷史。現行 `checkup_prefetch_universe` 未過濾 status，把歷史平倉標的一併納入。

決議：`trade_records` 一律 **priority 2 / keepwarm**，命名為「專家在倉部位」；且 rank 2 僅在 `status='open'` 時成立，`closed`/`stopped` 落 rank 3。此判斷在 `enqueue_chips_prefetch_gaps`/`detect_chip_gap_jobs` 的內部 CTE 直接查 `trade_records`，不改 `checkup_prefetch_universe` contract。

## 5. Migration 收斂（單一 transaction）

一筆 migration，依序：
1. 清洗 `tw_bsr_sync_config` market_batch 的 `last_probe_error` → `"unsupported_plan:sponsor_level"`（`WHERE key='market_batch' AND config->>'last_probe_error' LIKE 'unsupported_plan:http_400:%'`，`version = version + 1`）。
2. `cron.alter_job(67, schedule => '30 13 * * 1')`（jobid/name/command/payload/active/database/username 不變）。
3. `CREATE OR REPLACE FUNCTION public.detect_chip_gap_jobs(...)`（contract 逐字不變）。
4. `CREATE OR REPLACE FUNCTION public.enqueue_chips_prefetch_gaps(...)`。

四步同一 migration = 同一 transaction，無需拆分（`cron.alter_job` 為一般 SQL 函式呼叫，可在 transaction 內）。Rollback：migration 前先唯讀保存兩支 `pg_get_functiondef` 全文與 md5（見 §1 hash），回滾即以原文 `CREATE OR REPLACE` 還原 + `cron.alter_job(67,'30 13 * * 1-5')` + config 寫回安全摘要。

## 6. Edge sanitizer（收緊）

`supabase/functions/_shared/finmindMarketBatch.ts` 新增單一 `sanitizeUpstreamError(input)`，取代全部 8 個 `maskProbeError` 呼叫點：
- bounded JSON parse（沿用 64KiB 上限緩衝，不新增讀取）；遞迴走訪 object **與 array**，key 名（case-insensitive）符合 `token|access_token|api_key|authorization|secret|signed_url|url` → 值一律 `***`；只保留白名單 `msg|status|code|detail`。
- **白名單值仍需二次過濾**：對保留下來的 `msg`/`detail` 文字再跑 token-like/Bearer/signed-URL sanitizer（完整 `FINMIND_TOKEN` 全字串、`Bearer\s+\S+`、`token\w*\s*[=:]\s*\S+`、`https?://\S*(sig|token|X-Amz|Signature)\S*`、`[A-Za-z0-9_\-]{20,}`）。
- 非 JSON / 解析失敗 / 循環引用 → 直接走純文字 sanitizer。
- 統一截斷 300 字；只有 sanitized 字串可進 Edge response、`tw_bsr_sync_config`、`console.log`；signed URL 永不落地。
- 401 precedence 與 bounded reader 行為不變。

既有 `net._http_response`（id 244777）與 edge logs 仍含尾碼：**不刪**，屬審計表，依既有 retention 自然淘汰；本票只精確清洗 config。

## 7. Exact diff 邊界

允許變更：
- `supabase/functions/_shared/finmindMarketBatch.ts`（sanitizer）
- `supabase/functions/_shared/finmindMarketBatch_test.ts`
- 新增 ephemeral SQL test（fairness/priority routing）
- **一筆** migration（§5 四步）

凍結（diff = 0）：`tw-bsr-finmind-sync/index.ts`、`claim_bsr_queue_jobs`（Build 1f pinned hash）、quota pools/ledger/admission、snapshot fulfillment、`checkup_prefetch_universe`、所有 UI、`enqueue_bsr_backfill`/`app_role`。
非 production：`.lovable/plan.md` 自動 rename/歸檔。
Edge 只 deploy 一次；migration 只套一次。

## 8. 測試門檻（任何 FAIL 即 STOP）

Sanitizer（Deno）：nested `token_tail`、array 內含敏感 key、mixed case（`Token_Tail`/`ACCESS_TOKEN`/`Signed_URL`）、`msg` 內含 signed URL、`msg` 內含 `Bearer xxx`、`msg` 內含 `token=xxx`、長 token-like 字串、循環引用物件、非 JSON 純文字、正常 `msg/status` 保留、300 字截斷。

Ephemeral SQL：
- `detect_chip_gap_jobs` return columns/順序/型別逐字不變（`information_schema` 斷言）。
- 持股缺 1 日 vs 冷門股缺 60 日 → 持股先返回、priority=1。
- 42 saved codes、`_max_jobs = 10`：連續 5 輪等價呼叫（每輪把上輪入隊者標為 done）後，42 檔全部被選到過；其中 1 檔設為 `failed` 不得阻塞其餘 41 檔。
- 已 `pending`/`running` 的 (stock, date) 不再佔用 `_max_jobs` 名額。
- priority ↔ pool 映射：1→interactive、2→keepwarm、3→backfill，且皆在 `CHECK (1,2,3)` 內。
- `trade_records` `closed` 標的落 rank 3、`open` 落 rank 2。
- 冪等：連兩次 `enqueue_chips_prefetch_gaps` 第二次 inserted=0。
- quota exhausted → deferred/skipped；failed date → partial；stale running recovery。

完整 scoped regression：`finmindMarketBatch_test.ts`、`snapshotFulfillment_test.ts`、`chips_prefetch_universe_test.sql`、`market_batch_fulfill_e2e_test.sql`、`bsr_metrics_contract_test.sql`、`ensure_bsr_queued_test.sql`、`bsr_claim_token_slot_test.sql`、`finmind_admit_v2_test.sql`、`orchestrator_snapshot_test.sql`、`bsr-claim-equivalence.sh` pinned hashes、`bsr-slice-verify.sh`（slice fixture 含 detect 定義，需確認 hash 是否納入 pinned 範圍；若納入，同步更新 fixture 並在票中逐字列出差異）。

## 9. 修正後的自然驗收門檻

Implementation 後不 manual invoke。等下一個自然 job106（:02）→ job107（:07）。

**Production 只證明**：
1. 29 檔 saved eligible 普通股 stale = 0；
2. 13 檔六位數權證類明確標 ineligible（不計 stale）；
3. job106/107 runid → request_id → HTTP 200，無新增錯誤、無非預期寫入；
4. `tw_bsr_sync_config.market_batch.last_probe_error` 不含尾碼；
5. job67 schedule = `30 13 * * 1`，其他 cron exact diff = 0；
6. quota：以 **implementation timestamp 之後** 的 `finmind_quota_ledger` delta 與 `last_reject_*` 判定 —— 不得出現由 Lane A 新增造成的 `daily_exhausted`。今日 interactive `used_today=240` 為既成事實，不列入門檻；次日 reset 後再觀察正常行為。
7. **routing branch**：若自然輪次無缺口（`dispatched: []`），標 **N/A — not observed**，不得以空派送冒充 PASS；priority routing 一律以 offline/ephemeral 證明。

**Preview**：E2E 帳號 0 holdings → per-holding Preview **BLOCKED**，不建立假持股。可分開做 (a) authenticated page 0-enqueue，(b) server-side 5 users（36 列中僅 5 位有非空持股）/ 42 codes 的 freshness 稽核。

## 10. 待補（實作票內完成，不得沿用推測）

- 各來源 distinct code counts 需在 ephemeral 用相同定義複算（production 角色無 `EXECUTE` 權限，無法直接呼叫 `checkup_prefetch_universe()`）。
- `bsr_slice_expected.tsv` / `bsr_slice_functions.sql` 是否含 `detect_chip_gap_jobs` 定義的 pinned hash，需先確認再決定 fixture 更新範圍。
