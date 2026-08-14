# P7 Plan R0 — 持股法人/BSR 免開抽屜自然保鮮

唯讀盤點完成，未修改任何檔案/DB/cron/config，未 deploy/manual invoke/Publish/Preview/開抽屜。working tree 仍 clean。

## A. Existing inventory（唯讀）

### A1. 法人供給函式（全部 `SECURITY DEFINER`、`search_path=public`、owner `postgres`）

| 函式 | signature | vol | md5 |
|---|---|---|---|
| `detect_institutional_gap_jobs` | `(_target_date date, _lookback_days int, _max_jobs int) → TABLE(stock_id, start_date, end_date, gap_count)` | STABLE | `f9fea8b2…` |
| `enqueue_institutional_backfill_universe` | `() → integer` | VOLATILE | `479ebaef…` |
| `enqueue_institutional_new_stock` | `(_stock_id text) → TABLE(enqueued bool, reason text)` | VOLATILE | `7c3c8b58…` |
| `claim_institutional_new_stock` | `(_lease_seconds int) → TABLE(id, stock_id, attempts)` | VOLATILE | `2f838b3c…` |
| `checkup_prefetch_universe` | `() → TABLE(code, supported, reason, sources[])` | STABLE | `cfcff927…` |
| `claim_backfill_jobs` | `(_batch_size int, _max_priority_score int) → TABLE(id,dataset,stock_id,start_date,end_date,source_hint,payload,attempts)` | VOLATILE | — |
| `detect_chip_gap_jobs` | `(_target_date, _lookback_days, _max_jobs)` | STABLE | `c1c50a47…`（P6-R1 後） |
| `enqueue_chips_prefetch_gaps` | `(p_lookback_days int, p_max_stocks int) → jsonb` | VOLATILE | `2e386602…` |
| `enqueue_bsr_backfill` | `(p_stock_id text, p_days int) → integer` | VOLATILE | `019fa470…` |
| `has_role` | `(_user_id uuid, _role app_role) → boolean` | STABLE | `187a79a4…` |

`detect_institutional_gap_jobs` 在 psql/read_query session 為 **permission denied**（僅 definer 路徑可跑），與 `compute_bsr_series_readiness` 相同，屬既有 ACL，不改。

### A2. Queue 語意

- `institutional_new_stock_queue`：`UNIQUE(stock_id)`、`CHECK status IN (pending, running, done, dead)`、無 priority 欄。claim 為 `status='pending' AND next_attempt_at<=now()` `ORDER BY next_attempt_at ASC` `FOR UPDATE SKIP LOCKED LIMIT 1`，lease 由 `next_attempt_at = now()+lease` 表達。**無 stale-running 回收器** → 目前 2 列（3363、3152）自 2026-07-28 起卡 `running`，`last_error = tw_bsr_daily row … is sealed and cannot be modified`，永不回到 pending。現況 36 列：34 done、2 running。
- `backfill_job_queue`：`CHECK dataset IN (chip_fact, institutional_daily, fundamentals)`、`CHECK status IN (pending,running,done,failed,skipped,cancelled)`、欄位含 `priority_score, next_run_at, attempts, max_attempts, correlation_id, payload, fulfilled_at`。claim 先跑 `recover_stale_backfill_jobs('15 min')`（只回收 running），再 `status='pending' AND next_run_at<=now()` `ORDER BY priority_score DESC, next_run_at ASC, id ASC` `LIMIT ≤10` `SKIP LOCKED`。**`failed` 為終態，無自動重試**。
- `tw_bsr_sync_queue`：`CHECK priority IN (1,2,3)`（P6-R1 的 source_rank 即用此欄）、`CHECK status IN (pending,running,done,failed,skipped)`。

現況統計：`chip_fact` done 299 / failed 383 / pending 20；`institutional_daily` done 195 / **failed 75** / pending 31（全部 created 2026-08-05，未再動）；`fundamentals` done 29 / failed 6。失敗主因：`admission_rejected:daily_exhausted:pool=backfill`（chip 197 + inst 56）、`finmind_http_400 dataset size`（117）、`sealed` upsert（10）。pending 多列 `BUDGET_EXHAUSTED:released_before_start`。

### A3. Cron 與最近 run（全為自然觸發）

| job | schedule (UTC) | 內容 | last run |
|---|---|---|---|
| 38 | `45 9 * * 1-5` | `tw-institutional-daily-sync` 預設 | 08-14 09:45 ok |
| 64/65/66 | `30 7,9,11 * * 1-5` | keep_warm lookback 3 | 08-14 11:30 ok |
| 71 | `15 22 * * *` | **`enqueue_institutional_backfill_universe()`** | 08-13 22:15 ok |
| 72 | `*/5 6-11 * * 1-5` | `fastlane` batch 10, days 60（消費 `institutional_new_stock_queue`） | 08-14 11:55 ok |
| 97 | `*/5 * * * *` | `cold_start` resume（`cold_start_status.state=done`，已無工作） | 08-14 14:25 ok |
| 103/104 | `0 10 * * 0` / `0 18 * * 1-5` | `backfill-gap-orchestrator`（掃三種 gap → `backfill_job_queue`） | 08-09 / 08-13 18:00 |
| 105 | `7 * * * *` | `backfill-worker` **batch_size 3, call_budget 8** | 08-14 14:07 ok |
| 91/92/93 | 週六/週日/每日 | `tw-trading-calendar-catchup`（亦呼叫 inst detector） | 08-13 22:30 |
| 106/107 | `2 * * * *` / `*/15…` | BSR lane（P6-R1） | 08-14 14:02 / 14:07 |

### A4. Edge / 前端呼叫端

- `tw-institutional-daily-sync`：modes `cold_start / cold_start_status / keep_warm / otc_gap_fill / backfill_stock / fastlane`；`PUBLIC_SYNC_MODES = {backfill_stock, cold_start_status}`。
- `backfill-gap-orchestrator`：`scan_only / run / enqueue`（enqueue 需 admin header）；`run` 先 `Promise.all` 三個 detector，**append 順序 chip → institutional → fundamentals 共用 `maxDispatch` 預算**，以 20 日切塊，`priority_score = gap_count (+10 if Sunday)`。
- `tw-trading-calendar-catchup`：補行事曆後同樣呼叫 inst detector。
- 前端唯一觸發：`useChipsBackfill.requestBackfill` → `tw-institutional-daily-sync{mode:'backfill_stock', days:60}` + `rpc('enqueue_bsr_backfill')`。`ensure_bsr_queued` 在 production 無呼叫端。

### A5. Quota 現況（2026-08-14，`finmind_quota_pools`）

| pool | used_today / daily_budget | tokens | 備註 |
|---|---|---|---|
| interactive | **240 / 240（已耗盡）** | 182 | 最近拒絕 `daily_exhausted`（08-12） |
| keepwarm | 110 / 960 | 236 | base 480、borrow 開啟 |
| backfill | 174 / 600 | 232 | 今日失敗大宗來源即此池耗盡日 |

kill switches：`chips_all / chips_keepwarm / chips_interactive / chips_backfill` 皆 enabled。`fastlane_enabled = {enabled:true, daily_stock_cap:500}`。

### A6. 可重用的 holdings universe

**已存在**：`checkup_prefetch_universe()` 回傳 `code / supported / reason / sources[]`，`sources` 已含 `checkup_storage`（解析 array 與 `{holdings:[]}` 兩形狀）、`trade_records`、`expert_signals`、`registry`；`supported` 由 `tw_bsr_eligibility()` 決定（6 碼權證等自動 false）。**P7 不需要新的 universe 函式，也不需要新 table。** 它是 SECURITY DEFINER 聚合函式，只輸出 code/sources，**不含 user_id**，Edge log 不會出現 PII。

## B. Root cause

1. **主因（法人歷史永不補齊）**：`enqueue_institutional_backfill_universe()`（job 71，唯一持續運作的「新股歷史」detector）的 universe 是
   `expert_signals(TW) ∪ trade_records(TW) ∪ v_active_tw_holdings`
   — **不含 `checkup_storage` saved holdings**，也沒用 `checkup_prefetch_universe()`。3529/4979/5271/6180/8086 只存在於使用者保存持股，因此 `cov<40` 的條件雖然成立（各 14 天），卻從未進入 `institutional_new_stock_queue`，fastlane（job 72，唯一會抓 60 日歷史的 lane）也就永遠拿不到它們。這正是「cold_start=done 之後哪個 detector 沒納入 saved holdings」的答案。
2. **次因（gap lane 被餓死）**：`detect_institutional_gap_jobs` 只 `ORDER BY gap_count DESC`，沒有 saved-holdings 優先；orchestrator 只在週日 10:00 / 平日 18:00 跑，且 chip 先吃掉共用 dispatch 預算；worker（job 105）每小時只認領 3 筆。這 5 檔的 60 日缺口（各約 28 天）排在整段全空（約 40 天）的冷門股後面，實務上永遠拿不到配額。
3. **失敗終態**：`backfill_job_queue.failed` 無重試器，56+ 筆 institutional 因 `daily_exhausted:pool=backfill` 直接死亡，不會回補。
4. **附帶**：`institutional_new_stock_queue` 無 stale-running 回收，2 檔（3363/3152）永久佔位（不阻塞 claim，但永不完成）。
5. **coverage=missing_snapshot（5271）與本問題無關**：readiness 不讀 `bsr_coverage_daily`（G1 §D/§E 已證）。

## C. P7-A exact design（法人供給最小修正）

沿用現有 queue / quota / cron / control plane，**不新增 table、不新增 scheduler、不改 public return signature**。

### C1. `enqueue_institutional_backfill_universe()` — 納入 saved holdings 並加內部排序

- signature 維持 `() RETURNS integer`（呼叫端只有 job 71，回傳語意不變 = 本次入列筆數）。
- universe 改為 `public.checkup_prefetch_universe() WHERE supported`，並保留既有三來源作為 UNION（等價或更寬，不會漏）。`supported` 直接排除 13 個六碼商品與其他 ineligible。
- 目標條件不變：`COALESCE(cov.d,0) < 40`（`tw_institutional_daily` 天數）。
- **內部排序（不改 return 型別）**：以 `ORDER BY source_rank, cov ASC, sid` 決定插入順序，並用既有 `next_attempt_at` 微幅錯開（rank1 `now()`、rank2 `now()+30s`、rank3 `now()+120s`）表達優先，使 `claim_institutional_new_stock`（`ORDER BY next_attempt_at ASC`）自然先取持股：
  - rank 1 = `'checkup_storage' = ANY(sources)`（saved holdings）
  - rank 2 = `'trade_records' = ANY(sources)` 且該碼有 `status='open'` 的 TW 交易
  - rank 3 = 其餘（expert_signals / registry / 冷門全市場）
- 每輪入列上限：新增內部 `LIMIT`（建議 rank1/2 不設限但實測僅 29 檔；rank3 每輪 `LIMIT 50`），確保非持股輪巡持續有進展又不爆量。
- 冪等：既有 `ON CONFLICT (stock_id) DO UPDATE … WHERE status <> 'running'` 保留 → 跨 user 相同 stock 天然去重、`pending/running` 不會被重複插入、也不佔用 batch limit（claim 只取 pending 且每次 1 檔）。
- `dead` 狀態仍可被重置為 pending（既有行為），failed 不會造成隊頭阻塞（claim 有 `SKIP LOCKED` 且以 `next_attempt_at` 排序）。

### C2. `detect_institutional_gap_jobs()` — 與 P6-R1 chip lane 對稱的 source_rank

- signature 與回傳欄位**完全不變**（`stock_id,start_date,end_date,gap_count`）。
- 只改 `ORDER BY`：`source_rank ASC, (max_date = _target_date) DESC, gap_count DESC, symbol ASC`，rank 定義同 C1（沿用 P6-R1 已在 chip lane 驗證過的寫法）。
- 併入「已在 `backfill_job_queue` 有 `pending/running` 者不再重複輸出」的 anti-join（與 P6-R1 chip lane 同款），確保 pending/running 不佔 batch limit、不重複膨脹。

### C3. Target window（明確完成條件）

分兩個獨立判準，**最新日期與歷史深度分開**：

- **最新日期（每日保鮮）**：對每個 eligible saved code，`max(tw_institutional_daily.trade_date) = expected_trade_date`（最近一個已收盤交易日）。既有 keep_warm（job 64/65/66）已達成，本次不動。
- **歷史深度（跨過前端門檻）**：`count(distinct trade_date) over last 60 trading days ≥ 20`（前端 `sparse = instDays < 20`）；目標值 60（`days:60` 的請求深度），**達標門檻取 20**，20–60 之間由 rank3 輪巡持續補。
- BSR 側門檻不變：`bsrDays ≥ 5`（現況 29/29 已滿足）。

### C4. Cadence 與 quota 保守值

- **不改任何 cron**。job 71（每日 22:15 UTC）+ job 72（`*/5 6-11 * * 1-5`，batch 10）即為現有通道；29 檔 saved holdings 以 batch 10 / 5 分鐘計，單一交易日上限遠超需求，實際受 quota 節流。
- fastlane 走 **keepwarm/backfill 池**，不碰 `interactive`（今日已 240/240 耗盡）；P7-A 不得引入任何 `interactive` 池請求，避免壓到抽屜互動。
- rank3 每輪 `LIMIT 50` 是唯一新增的節流常數，確保非持股輪巡不被餓死也不爆量。

## D. P7-B exact design（`enqueue_bsr_backfill` admin enum）— 獨立票

### D1. 現況判定流程（唯讀節錄）

```sql
IF p_stock_id !~ '^[1-9][0-9]{3}$' THEN RAISE 'invalid stock_id';
IF auth.uid() IS NULL       THEN RAISE 'not authenticated';
SELECT public.has_role(v_uid, 'admin') INTO v_is_admin;      -- ← 缺陷行
IF NOT v_is_admin THEN
  v_is_owner := (自己的 expert trade_records 含該碼)
             OR (自己的 checkup_storage 'pf-holdings%' 含該碼);
  IF NOT v_is_owner THEN RAISE 'not authorized to backfill this stock';
END IF;
-- 迴圈插入最多 LEAST(GREATEST(p_days,1),120) 個工作日，priority 1、enqueued_by 'backfill_rpc'
```

`has_role(_user_id uuid, _role app_role)`；`public.app_role` 現值 = **`company_admin, analyst`**（無 `admin`）→ 任何呼叫在該行即拋 `invalid input value for enum app_role: "admin"`，**owner 分支永遠到不了**，RPC 恆 0 enqueue。歷史 migration 意圖顯然是「管理員可為任意股票 enqueue，一般使用者只能為自己持有的股票 enqueue」。

### D2. 候選比較

| 候選 | 內容 | 權限影響 | 回歸風險 |
|---|---|---|---|
| **B-1（建議）** | `'admin'` → `'company_admin'` | 還原原始意圖：company_admin 可任意碼；一般 user 仍受 owner 檢查 | 最低；不改 signature/ACL；`analyst` 不獲得額外能力 |
| B-2 | 刪除 admin 分支，只留 owner 檢查 | 管理員將無法為非持有碼 enqueue（能力縮減） | 低，但可能破壞既有維運腳本 |
| B-3 | 改用其他 role helper（如 `is_company_admin()` 之類） | 需確認該 helper 存在且語意等價 | 需額外盤點，非最小修正 |

### D3. 約束

保留 `public.enqueue_bsr_backfill(text,int) RETURNS integer`、`SECURITY DEFINER`、`SET search_path=public`、既有 ACL 與 RLS 不動；一般使用者仍只能為 `^[1-9][0-9]{3}$` 且自己持有的碼 enqueue，不獲得任何 admin 能力。`Promise.allSettled` 吞錯**只列為觀測性風險**，本票不碰 UI。

### D4. 是否必要

**對 P7 目標非必要**（server 自然排程不經過此 RPC），但它是「開抽屜 lazy 路徑」唯一的 BSR enqueue 入口，目前 100% 失效。建議與 P7-A **分開兩筆 migration**，可獨立批准、獨立 rollback。

## E. File / migration / deploy / cron allowlist（proposed exact）

```text
migrations（兩筆，各自單一 transaction，不重寫既有 migration）
  supabase/migrations/<ts>_p7a_institutional_saved_holdings.sql
    - CREATE OR REPLACE FUNCTION public.enqueue_institutional_backfill_universe()
    - CREATE OR REPLACE FUNCTION public.detect_institutional_gap_jobs(date,int,int)
  supabase/migrations/<ts>_p7b_enqueue_bsr_backfill_role.sql
    - CREATE OR REPLACE FUNCTION public.enqueue_bsr_backfill(text,int)

tests（新增）
  supabase/tests/institutional_saved_holdings_test.sql
  supabase/tests/enqueue_bsr_backfill_authz_test.sql

fixtures（同步既有 e2e fixture 中的兩個函式定義，維持 P6-R1 既有慣例）
  supabase/tests/fixtures/bsr_e2e_functions.sql
```

- **Edge：0 deploy**（`tw-institutional-daily-sync`、`backfill-gap-orchestrator`、`backfill-worker` 皆無需改動）。
- **Cron：0 變更**（job 71 / 72 / 103 / 104 / 105 沿用）。若審核後認為 rank3 節流需要不同 cadence，才另列 exact before/after，本 R0 不提。
- P6-R1 成果與 `bsr_e2e_schema.sql` 不再碰；`.scratch/` 只新增本次 pre-migration 只讀存證。

## F. Test matrix（ephemeral，先設計）

| # | 斷言 |
|---|---|
| F1 | `enqueue_institutional_backfill_universe` / `detect_institutional_gap_jobs` public signature、回傳欄位、`prosecdef`、`proconfig`、ACL 與 migration 前逐一相同（hash freeze 只針對未改動函式） |
| F2 | saved holdings 缺 1 日 → 進 queue 且 rank1 最先被 claim |
| F3 | saved holdings 僅 14 天（<20）→ 進 queue，`cov<40` 命中 |
| F4 | 同一 stock 被 2 個 user 保存 → queue 僅 1 列（`UNIQUE(stock_id)`） |
| F5 | 已 `pending`/`running` 的 stock 不被重複插入、不佔 claim batch |
| F6 | `dead`/失敗列可被重置為 pending，且不阻塞後續 claim（隊頭阻塞測試） |
| F7 | 分頁公平：連續 N 輪後 rank3 有進展，rank1 不被 rank3 擠出 |
| F8 | 13 個 ineligible（六碼/權證）全數被 `supported=false` 排除 |
| F9 | 非持股（registry-only）在 rank1/2 清空前仍每輪取得 ≥1 名額 |
| F10 | P7-B 權限矩陣：一般 user 自持碼 → 成功；一般 user 非自持碼 → `not authorized`；company_admin 任意碼 → 成功；analyst 非自持碼 → 拒絕；unauth → `not authenticated`；invalid code（`0123`/`2330A`/六碼） → `invalid stock_id` |
| F11 | 既有 scoped regressions 全跑：`chips_lane_a_fairness`、`market_batch_fulfill_e2e`、`snapshotFulfillment`、`finmindMarketBatch`、`bsr-claim-equivalence.sh` pinned hash |

`bsr_metrics_contract_test.sql` 與 `chips_prefetch_universe_test.sql` case1 的既有失敗維持 **UNPROVEN**，只證明「與 pre-P7 baseline 字串相同 → 非本次 regression」。

## G. Natural acceptance chain（禁止 manual worker / 補跑）

```text
cron job 71 (22:15 UTC 每日) runid
  → cron_dispatch_log / request_id
  → enqueue_institutional_backfill_universe 回傳筆數
  → institutional_new_stock_queue 新增 rank1 列（3529,4979,5271,6180,8086）
cron job 72 (*/5 6-11 UTC Mon-Fri) runid
  → request_id → HTTP 200 → claim_institutional_new_stock
  → tw_institutional_daily rows/depth 增加
  → 5 檔 distinct trade_date 由 14 → ≥20（目標 60）
  → 29 檔 hypothetical drawer readiness 全 ready、0 enqueue
```

下一次精確自然時間（UTC）：**job 71 = 2026-08-14 22:15**（Taipei 08-15 06:15，週六仍執行）；**job 72 下一次有效視窗 = 2026-08-17 06:00–11:55（週一，Taipei 14:00–19:55）**，因 `* * 1-5` 排除週末。故最早可完成驗收時點為 **Taipei 2026-08-17 傍晚**。耐心等，不補跑、不 manual invoke。

Preview 僅允許專用 E2E 帳號，0 holdings 只能證明 page load 0-enqueue；不得造假持股、不得開真實使用者抽屜。

## H. 風險與 rollback

| 風險 | 緩解 |
|---|---|
| saved holdings 灌爆 `institutional_new_stock_queue` | 實測 rank1 僅 29 檔；`daily_stock_cap=500` 仍生效；rank3 每輪 `LIMIT 50` |
| 壓到 interactive 池 | fastlane 不走 interactive；P7-A 不新增 interactive 請求 |
| 非持股輪巡被餓死 | F7/F9 明確斷言 rank3 每輪保底名額 |
| `detect_institutional_gap_jobs` 改 ORDER BY 影響 orchestrator | 回傳型別不變；orchestrator 只讀順序；F1 凍結 signature |
| `institutional_new_stock_queue` 2 列永久 running | **本票不修**，僅列為既有缺陷（無 stale-running 回收器）；不影響 claim |
| P7-B 誤放權 | owner 檢查邏輯與 signature 完全不動，只換 enum 值；F10 權限矩陣把關 |

Rollback：兩筆 migration 各自為單一 `CREATE OR REPLACE`，回復即以 pre-migration 定義（migration 前會先只讀存下 `pg_get_functiondef` 原文與 md5）再 `CREATE OR REPLACE` 一次；無 schema 變更、無資料遷移、無 cron 變更 → rollback 為純函式還原。

## I. 建議批准範圍

1. **P7-A**（C1 + C2 一筆 migration）— 解決 B1/B2 主因，建議優先批准。
2. **P7-B**（D1–D3，B-1 候選，獨立 migration）— 修復 lazy 路徑，建議一併批准但可分開執行。
3. **不含**：`backfill_job_queue` failed 重試器、`institutional_new_stock_queue` stale-running 回收、5271 的 `daily_price_snapshots` 供給、UI 觀測性 — 各自另立票。

停在此處等你審核，不實作。
