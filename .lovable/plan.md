# Stage 3B（v4）— Honest Downgrade：先關入口 → 再宣告狀態 → 最後才動 backlog

判定沿用 Stage 2（FinMind level=register，單股與 market_batch 皆 HTTP 400，deterministic terminal）。目標：**不開抽屜時持倉看板仍自動取得可取得的最新資料**；BSR 誠實標示不可更新、停止無效排隊；不升級方案、不換來源、不造假資料。本版整份取代 v3。

保留自 v3：7 支 DB function + 1 個 legacy edge call site；public CREATE hard stop；failed 一列不動；pending 只改 status；未開抽屜用 batch；qty 不假 0；前端 Preview only；最後 row-level 兩位使用者與 cron→runid→request_id→HTTP→run_id 證據。

---

## 0. 唯讀稽核事實（本輪 exact 量測）

### 0.1 七支 DB function + 一個 legacy edge call site
| # | exact signature | RETURNS | prosecdef | owner | proconfig | ACL(EXECUTE) | caller |
|---|---|---|---|---|---|---|---|
| 1 | `public.enqueue_chips_prefetch_gaps(integer,integer)` | `jsonb` | DEFINER | postgres | `search_path=public` | postgres, service_role | cron 106 |
| 2 | `public.enqueue_all_active_tw_holdings_bsr(integer)` | `jsonb` | DEFINER | postgres | `search_path=public` | postgres, anon, authenticated, service_role | ops/edge |
| 3 | `public.enqueue_bsr_first_fetch_on_trade()` | `trigger` | DEFINER | postgres | `search_path=public` | PUBLIC+all | `trg_trade_records_bsr_first_fetch` |
| 4 | `public.ensure_bsr_queued(text)` | `jsonb` | DEFINER | postgres | `search_path=public` | PUBLIC+all | 舊 lazy 路徑 |
| 5 | `public.enqueue_bsr_backfill(text,integer)` | `integer` | DEFINER | postgres | `search_path=public` | postgres, anon, authenticated, service_role | `useChipsBackfill.ts` |
| R1 | `public.recover_stale_bsr_queue_jobs(integer,integer)` | `jsonb` | DEFINER | postgres | `search_path=public` | postgres, service_role | #1 內部 |
| R2 | `public.recover_quota_failed_bsr_jobs(integer)` | `jsonb` | DEFINER | postgres | `search_path=public` | postgres, service_role | #1 內部 |
| 6 | legacy edge `tw-chips-detail`（`chipsRepository.ts:305`） | — | — | — | — | 僅 `VITE_CHIPS_ENDPOINT` 覆寫可達 | 前端 call site，不進 migration |

早退型別相容：jsonb 五支保留原必備鍵（`inserted`/`revived`/`eligible,created,status`）為 0/false 再加 `"skipped":"bsr_provider_unsupported"`；#3 `RETURN NEW`；#5 回 `integer 0`（不改型別）。

### 0.2 HARD STOP #1 — definer search_path（已量測 PASS）
`has_schema_privilege('anon'|'authenticated'|'service_role','public','CREATE') = f, f, f`；`public nspacl` 僅 `pg_database_owner=UC`，其餘 `=U`。→ `search_path=pg_catalog, public` 對七支安全。**執行前重跑；任一為 `t` 即停**，改 `search_path=pg_catalog` + 全 schema-qualified。

### 0.3 HARD STOP #2 — `bsr_block_and_terminalize_claims` 不適用（已讀 exact branch）
`p_terminal_code` 白名單只接受 `'finmind_admission_provider_plan_rejected'`；`IF v_blocked THEN v_transition:='already_blocked'`（不 UPDATE config、不 bump version、不寫 audit）。目前 `legacy_config_missing` 已 blocked=true → 空 claims 呼叫必走 already_blocked。**S3B-C 改為 CAS migration。**

### 0.4 `private_bsr.gate_state()` exact 契約（來源：`20260822024453_…sql`）
```sql
CREATE FUNCTION private_bsr.gate_state() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, private_bsr AS $$
  SELECT jsonb_build_object('exists',(c.key IS NOT NULL),'version',c.version,'config',c.config)
    FROM public.tw_bsr_sync_config c WHERE c.key='market_batch' $$;
```
→ RETURNS **jsonb**，keys `exists boolean / version int / config jsonb`；**列不存在時回 NULL**（0 rows）。
`private_bsr.gate_classify(p_exists boolean, p_cfg jsonb) RETURNS jsonb`（IMMUTABLE, INVOKER, `search_path=pg_catalog`），回 `{blocked, reason, detail}`；OPEN 僅在 `admission_blocked` 恰為 JSON `false`。

**`private_bsr.ingest_allowed()` compile-valid body（無 placeholder）**
```sql
CREATE OR REPLACE FUNCTION private_bsr.ingest_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private_bsr
AS $$
  SELECT NOT COALESCE(
    (private_bsr.gate_classify(
        COALESCE((s.gs -> 'exists')::boolean, false),
        s.gs -> 'config'
     ) ->> 'blocked')::boolean,
    true)                                  -- gate_state()=NULL → classify 亦 NULL → fail-closed
  FROM (SELECT private_bsr.gate_state() AS gs) s;
$$;
REVOKE ALL ON FUNCTION private_bsr.ingest_allowed() FROM PUBLIC;
```
search_path 不含 public（唯一依賴是 `private_bsr.gate_state()`，其自身已 DEFINER 且完全 schema-qualify `public.tw_bsr_sync_config`）。
**Contract（三分支 + 編譯）**：`bsr_gate_ingest_allowed_test.sql` 斷言 (a) migration parse/compile（函式建立成功且 `pg_get_functiondef` 可取得）；(b) legacy（無 `admission_blocked` 鍵）→ `false`；(c) explicit blocked（`admission_blocked=true`）→ `false`；(d) open（`admission_blocked=false`）→ `true`；(e) gate row 缺 → `false`。(b)–(e) 於**測試專用暫存交易內以 savepoint 改動再 rollback**，不留痕。

### 0.5 Canonical mapping（唯一一組）
| 層 | 欄位 | 唯一值 |
|---|---|---|
| DB config | `admission_blocked` / `admission_reason` | `true` / `provider_plan_rejected` |
| DB terminal code | `admission_terminal_code` | `finmind_admission_provider_plan_rejected` |
| ingress 抑制 | `skipped` | `bsr_provider_unsupported` |
| payload | `bsr_provider_state` / `bsr_provider_code` | `terminal_provider_rejected` / `provider_plan_rejected` |
| UI | 文案 | 「資料來源目前不支援更新 · 最後可用 YYYY/MM/DD」 |

### 0.6 Worker exact body（**依現行程式碼，不改 worker contract**）
`supabase/functions/tw-bsr-finmind-sync/index.ts:539-556`（`runWorker`，gate 未通過即 return）：
```json
{"ok": true,
 "note": "admission_gate_closed",
 "admission": {"decision":"blocked","blocked":true,
               "reason":"<admission.reason ?? admission.detail>",
               "terminal_code":"<terminalCode|null>",
               "blocked_at":"<blockedAt|null>",
               "gate_version":<int|null>},
 "claimed": 0, "processed": 0, "provider_calls": 0,
 "run_id": "<uuid>", "elapsed_ms": <int>}
```
- 今日（v7 legacy）實測 `reason='legacy_config_missing'`、`terminal_code=null`、`gate_version=7`。
- **S3B-C 後預期（v8）**：`reason='provider_plan_rejected'`、`terminal_code='finmind_admission_provider_plan_rejected'`、`blocked_at='<ISO>'`、`gate_version=8`，其餘鍵不變；`claimed/processed/provider_calls` 仍為 0。
- manual 入口（`index.ts:1190-1207`）為另一 shape（含 `mode/date/requested/enqueued/jobs`），本輪不驗收。

### 0.7 Queue 表：單一 dataset、無 provider/job 型別 discriminator（唯讀證據）
欄位（18）：`id, stock_id, trade_date, priority, status, attempts, max_attempts, next_run_at, last_success_at, last_error, enqueued_by, enqueued_at, started_at, finished_at, created_at, updated_at, correlation_id, post_close_only` → **沒有 provider/dataset/job_type 欄位**；表名與所有 producer 皆 BSR 專用（`enqueued_by` 觀測值：`converge_bsr_windows`、`tier2_gaps:*`、`chips_prefetch_hourly[:r1|:r3]`、`trade_insert_hook_backfill`），`enqueued_by` 是產生者標籤而非 dataset discriminator。唯一消費者 `claim_bsr_queue_jobs`（BSR worker）。
**但 selector 內有 sentinel**：`claim_bsr_queue_jobs` 對 `last_error='quota_recovery_token'` 的 pending 列有專屬 token slot。目前該類 pending = **0 筆**，仍**防禦性排除**（見 S3B-E WHERE）。
pending 明細（548）：`(null)` 471、`quota_deferred` 75、`finmind_http_400{…token_tail…}` 2；其中 `post_close_only=true` 21 筆。
`tw_bsr_sync_queue_active_uniq`：`UNIQUE (stock_id, trade_date) WHERE status IN ('pending','running','failed','skipped')` → skipped 佔 uniqueness（恢復 runbook 見 §0.8）。
唯一 trigger：`trg_tw_bsr_sync_queue_updated BEFORE UPDATE … tw_bsr_sync_queue_touch_updated()`；`finished_at` nullable、`updated_at` NOT NULL 由 trigger 維護。
**敏感**：既有 `last_error` 含 token 尾碼 → 本輪不讀出、不匯出、不覆寫。

### 0.8 恢復 runbook（本輪不執行，寫入 migration 註解 + 測試斷言）
未來 `bsr_unblock_after_probe` 成功時同交易：
`UPDATE public.tw_bsr_sync_queue SET status='pending', next_run_at=now() WHERE status='skipped' AND id = ANY(<S3B-E ids>);`

### 0.9 未開抽屜 render flow（原始 bug 閉環）
```
HoldingsWorkbench.tsx:91-93  sparklineCodes = orderedDisplayed.map(h => h.code)
HoldingsWorkbench.tsx:101    useSparklines(...)                    ← OHLCV lane
HoldingsWorkbench.tsx:105    useChipsBatch({codes: sparklineCodes, enabled: !isDemo})
useChipsBatch.ts:47-77       useEffect → fetchChipsBatch → chipsRepository.ts:476
                             單次 POST /tw-chips-detail-v2 {stock_ids}（CHIPS_FN_DEFAULT:304）
                             → qc.setQueryData(chipsQueryKey(code), …)
```
**缺口（必須在 Plan 內解掉）**
1. **無 consumer**：`HoldingCard.tsx` 無任何 `useQuery`／`chipsQueryKey`／`useTwChipsDetail`（grep 0 命中）；唯一訂閱者是抽屜的 `useChipsLifecycle.ts:55 → useTwChipsDetail`。`setQueryData` 不會讓卡片 rerender → **S3B-D 必須新增卡片層 read-only 訂閱**（`useQuery({queryKey: chipsQueryKey(code), queryFn: skipToken/enabled:false})` 之類「只讀快取、絕不發請求」的訂閱，實作時以測試鎖定 0 額外 fetch）。
2. **上限截斷**：`orderedDisplayed` 無上限（`HoldingsWorkbench.tsx:260` 直接 map 全部），但 `fetchChipsBatch` `slice(0, CHIPS_BATCH_MAX_STOCKS=30)`（`chipsRepository.ts:468`）→ 第 31 檔起**靜默無資料**。S3B-D 改為 **bounded chunking**：`ceil(visible/30)` 個 POST（序列或受限並行，非 N+1），並以 31 檔案例測試斷言請求數 = 2 且第 31 檔有渲染狀態。
3. `enabled: !isDemo` → Demo 模式不預載；S3B-D 只調整顯示（Demo 顯示狀態文字），**不新增請求**。

### 0.10 payload terminal mapping（server，已存在）
`tw-chips-detail-v2/index.ts:235-247`：`marketBatchUnsupported = supported===false && last_probe_outcome==='unsupported'`；`marketBatchErrorClass = last_probe_error startsWith 'unsupported_plan:' ? 'provider_plan_rejected' : null` → `classifyBsrProvider` → `terminal_provider_rejected / provider_plan_rejected`。production 現值 `version=7, supported=false, last_probe_outcome=unsupported, last_probe_error='unsupported_plan:http_400:{…}'` → **payload 現在就已能給 terminal**。
S3B-C2 的最小補強：改讀 `admission_blocked/admission_reason` 作為 terminal 來源（不再把含帳號等級字樣的 raw `last_probe_error` 餵進 classifier 輸入）。

---

## Stage S3B-0 — 測試基線（baseline GREEN + 新功能 RED）

**必須立即 GREEN（既有 invariants，非新功能）**
| 測試 | 斷言 |
|---|---|
| `bsr_gate_helper_acl_test.sql` | `private_bsr` 對 anon/auth/service_role 無 USAGE；三行 `has_schema_privilege(...,'public','CREATE')=f`；無 public 面 gate 讀取器 |
| `bsr_queue_selector_test.sql` | `claim_bsr_queue_jobs` 不選 `skipped`；unique predicate 含 skipped；`quota_recovery_token` token slot 存在；queue 無 dataset discriminator 欄位 |
| `bsr_worker_body_shape_test.ts` | worker gate-closed body 為 `note+admission{}` 巢狀 shape（鎖定 §0.6 契約，避免未來漂移） |
| `holdings-quantity-source.test.ts` | qty/cost 僅來自 `pf-holdings-v2`；行情 null → 「—」；`qty===0` 正常顯示 |

**必須 RED（新功能，逐項預期）**
| 測試 | 預期 RED 原因 |
|---|---|
| `bsr_ingest_suppression_test.sql` | 七支尚未 early-return：inserted/revived > 0 |
| `bsr_gate_ingest_allowed_test.sql` | `private_bsr.ingest_allowed()` 不存在 |
| `bsr_availability_cas_test.sql` | config 無 `admission_blocked`，CAS 尚未實作 |
| `bsr-canonical-code-mapping.test.ts` | 常數集尚未建立 |
| `bsr-terminal-no-backfill.test.tsx` | terminal 時仍呼叫 `enqueue_bsr_backfill` |
| `holdings-nodrawer-chips-consumer.test.tsx` | 卡片無 chips 訂閱、無日期渲染 |
| `holdings-chips-chunking.test.ts`（31 檔） | 目前只發 1 次且截斷至 30 |
| `e2e/holdings-bsr-unavailable.spec.ts` | 不開抽屜時無日期、無 BSR 狀態 |

**SQL 測試隔離協定（強制，適用所有會呼叫七支 producer/recovery 或讀寫 gate/config 的 SQL test）**
1. 每個 test 檔以顯式 `BEGIN;` 開場、`ROLLBACK;` 收場；**外層交易保證回滾**——assertion 用 `RAISE EXCEPTION` 觸發，失敗時交易一併回滾，絕不留下 queue/config/audit_logs/tw_bsr_degrade_events 任何 row。
2. 交易內先 `SAVEPOINT sp_fixture;` 建立**測試專用 fixture**（自建 fixture symbol/日期的 queue 列、以及 `key='market_batch'` 的 config 值改寫），跑斷言後 `ROLLBACK TO SAVEPOINT sp_fixture;`，最後仍 `ROLLBACK;`。
3. **禁止用 production 真實 row 測 open 分支**：`admission_blocked=false` 的 open 分支只能在 fixture savepoint 內、對測試自建列或暫時改寫後再回滾的 config 上驗證；不得對 production pending/failed 列呼叫 producer。
4. 每個 test 檔第一步與最後一步各取一次 **before/after snapshot 並比對**：`tw_bsr_sync_queue` 全表 hash + `count(*) by status` + `max(updated_at)` + `max(enqueued_at)`、`tw_bsr_sync_config` 全 key `version + md5(config::text)`、`audit_logs` 與 `tw_bsr_degrade_events` 的 `count(*)`；任一不等即 `RAISE EXCEPTION 'test_left_residue'`。
5. RED 階段同樣套用此協定：RED 只允許以「函式不存在／回傳不含 `skipped` 鍵／inserted>0」等**在 fixture 上觀察**的方式失敗，不得用 production 資料變動當證據。

**Allowlist**：僅上述測試檔。**Acceptance**：baseline 四項 GREEN、新功能八項 RED 且失敗原因與上表一致；**所有 SQL test 執行前後 production queue/config/audit/degrade 的 hash 與 count 完全一致**。**Stop**：baseline 任一 RED（代表現況與稽核不符）、新功能意外 GREEN、或出現 `test_left_residue`。**Rollback**：刪測試檔（測試本身不留 DB 痕跡）。

---

## Stage S3B-A — 原子部署七支 early-return（先關入口）
gate 仍 `legacy_config_missing`（blocked=true），部署即全關，零 unguarded 窗。

**Actions**（單一 migration / 單一交易）
1. 建 `private_bsr.ingest_allowed()`（§0.4 exact body，零 GRANT）。
   可呼叫性論證：七支皆 DEFINER 且 owner=postgres → 執行期 current_user=postgres，postgres 對 `private_bsr` 有 USAGE、對 helper 有 owner 隱含 EXECUTE；呼叫端角色不獲任何權限。
2. `CREATE OR REPLACE` 七支：開頭 `IF NOT private_bsr.ingest_allowed() THEN RETURN <型別相容 suppressed>; END IF;`；`SET search_path = pg_catalog, public`；ACL 一字不改；#1 suppressed 分支不呼叫 R1/R2。

**Allowlist**：`supabase/migrations/<ts>_bsr_ingest_suppression_gate.sql`
**Acceptance**：`bsr_ingest_suppression_test` / `bsr_gate_ingest_allowed_test` 轉 GREEN；baseline 四項仍 GREEN；`pg_proc` readback 七支 RETURNS/ACL 與部署前逐項相同、proconfig=`pg_catalog, public`；`ingest_allowed` proacl 零 GRANT；config 仍 v7；queue 全表 hash 仍 `73c0df1e3a38f4c8f81e49e0e8b65346`。
**Stop**：ACL/型別改變、config/queue 變動、§0.2 三行出現 `t`。
**Semantic rollback**：migration 內附七支部署前 exact `CREATE OR REPLACE` + `DROP FUNCTION private_bsr.ingest_allowed()`。

---

## Stage S3B-B — 自然週期觀察（0 mutation；不冒充 cron body）
**cron 106 是純 SQL**（`SELECT public.enqueue_chips_prefetch_gaps(10,300);`），`job_run_details.return_message` 只會是 `'1 row'`，**無法**提供 JSON `skipped/inserted/revived`。

**B1 自然證據（唯讀）**：106 的 `runid / status / start / end / return_message`；worker（46/51/98/107）`runid → request_id → HTTP → edge run_id → body`（§0.6 shape）。
**B2 0-mutation 證明（唯讀）**：週期前後比對 queue `count(*) by status`、全表 hash、`max(updated_at)`、`max(enqueued_at)`、**recovery 候選集合**（stale/quota-failed 條件命中列的 id hash 與 count）、config 全 key 的 version+md5、`finmind_quota_pools.used_today`、`finmind_quota_ledger`、`tw_bsr_api_usage`。
**B3 synthetic 早退驗證（明確標記 synthetic，非自然 cron）**：以 service_role 直接 `SELECT public.enqueue_chips_prefetch_gaps(1,1);` 取回 JSON，證明含 `"skipped":"bsr_provider_unsupported"`、`inserted=0`；前後再跑一次 B2 全套 snapshot 證明 0 mutation。報告中此段標題必須寫 **synthetic RPC call**，不得與自然 cron 混用。

**Acceptance**：B1 取得完整鏈；B2 前後完全相同；B3 JSON 早退且 0 mutation；worker `claimed=0 / provider_calls=0`。
**Stop**：任何 count/hash/counter 變動 → 回滾 S3B-A，不進 C。

---

## Stage S3B-C1 — CAS 宣告顯式 availability truth（**只有 SQL，不含 edge**）
**Actions**（單一 migration / 單一交易）
1. `SELECT config, version INTO … FROM public.tw_bsr_sync_config WHERE key='market_batch' FOR UPDATE;`（列缺 → `RAISE EXCEPTION 'gate_row_missing'`）
2. **冪等優先判定（canonical v8 = row `version`=8 且 7 個 `admission_*` 鍵全齊全且值/型別正確）**：
   `version = 8` **且** `admission_blocked = true`（JSON boolean）**且** `admission_reason = 'provider_plan_rejected'` **且** `admission_terminal_code = 'finmind_admission_provider_plan_rejected'` **且** `admission_blocked_at`（ISO timestamptz 字串）、`admission_run_id`（uuid 字串）、`admission_nonce`（非空字串）、`admission_evidence`（jsonb object，含 §C1-6 欄位）皆存在且型別正確 → **no-op 成功返回**（不 bump version、不再寫 audit/degrade）。
   canonical 鍵集合恰為 **7 鍵**：`admission_blocked, admission_reason, admission_terminal_code, admission_blocked_at, admission_run_id, admission_nonce, admission_evidence`。
3. **partial / mismatched**：只要含任一 `admission_*` 鍵而**未完整符合上述 v8 canonical**（含 `version <> 8`、缺任一鍵、多出未定義 `admission_*` 鍵、型別或值不符）→ `RAISE EXCEPTION 'admission_state_partial_or_mismatched'`（**不吞掉、不自動修補**）。
4. **否則（完全無 `admission_*` 鍵）要求 exact preimage**：`version = 7` 且 `md5(config::text) = 'dd747a45d3e46b2acc3f0c021bc269f8'`；不符 → `RAISE EXCEPTION 'preimage_mismatch'`。
5. 原子 merge canonical **7 鍵** + `version = 7 + 1 = 8` + `updated_at = now()`；`PERFORM private_bsr.assert_sanitized(<evidence>,0)`。
6. **evidence 欄位命名（時間語意分離）**：
   `{stage:'stage2', http_status:400, provider_code:'provider_plan_rejected', dataset:'TaiwanStockTradingDailyReport', probe_symbol:'3017', probe_date:'2026-08-21', recorded_at:<migration txn now()>}`。
   **不寫 `observed_at`**（Stage 2 外呼的精確時戳未逐秒留存）；若日後取得 exact probe 時間才新增 `probe_observed_at`。不放 token / provider 原始 body / URL。
7. append `audit_logs('bsr_admission_blocked')` + `tw_bsr_degrade_events`（append-only）。migration 註解寫入 §0.8 恢復 runbook。

**Allowlist**：`supabase/migrations/<ts>_bsr_admission_declare_explicit_cas.sql`
**Acceptance**：`bsr_availability_cas_test` GREEN（依 §S3B-0 SQL 測試隔離協定於 fixture savepoint 內驗：legacy→explicit 成功且結果為 `version=8` + 7 鍵齊全／canonical v8 重跑 no-op 冪等（version 仍 8、無新 audit/degrade）／`version<>8` 或缺任一鍵或型別值不符一律 `admission_state_partial_or_mismatched` raise／preimage 不符 raise／未開閘 `blocked=true`／0 queue mutation，測試前後 production hash 不變）；production readback `version=8` 且 **7 鍵**齊全；**下一個自然 worker** body 為 §0.6 v8 形式；再跑一次 B2 snapshot：queue/counter 全不變。**此時 payload 已可 terminal（§0.10 舊 mapping 生效）**，先觀察不動 edge。
**Stop**：任何 raise、body 未變為 v8、queue/counter 變動。
**Semantic rollback（非 exact inverse，明示）**：
```sql
UPDATE public.tw_bsr_sync_config
   SET config = config - 'admission_blocked' - 'admission_reason' - 'admission_terminal_code'
                       - 'admission_blocked_at' - 'admission_run_id' - 'admission_nonce'
                       - 'admission_evidence',
       version = version + 1, updated_at = now()
 WHERE key='market_batch';
```
audit/degrade append-only：保留原紀錄並追加 rollback audit，不刪除、不回寫 provider 原文。

## Stage S3B-C2 — edge：sanitized config mapping（**獨立部署，非同一 transaction**）
SQL migration 與 edge deploy 不共享交易，故分段。
**Actions**：`tw-chips-detail-v2` 的 terminal 判定改為：`config->>'admission_blocked'='true'` 亦視為 unsupported，`persistedErrorClass` 取自 `admission_reason`（`provider_plan_rejected`），**不再把 raw `last_probe_error` 當 classifier 輸入**。
**Allowlist**：`supabase/functions/tw-chips-detail-v2/index.ts`
**Acceptance**：部署前後對同一組 stock_ids 取 payload diff — `bsr_provider_state/bsr_provider_code` 皆為 `terminal_provider_rejected/provider_plan_rejected`（前後一致），且 diff 顯示 payload 不再出現任何供應商原文字樣；0 queue/config mutation。
**Stop**：C1 未 GREEN 不得進 C2；payload 任一欄位語意改變或出現原文 → 回滾。
**Rollback**：git revert 該檔並重新部署（純讀端點，無資料副作用）。

---

## Stage S3B-D — 前端 honest downgrade（Preview only）
**Actions**
1. **卡片層 chips 訂閱（新增，解 §0.9-1）**：`HoldingCard.tsx` 以 read-only 方式訂閱 `chipsQueryKey(code)`（不設 queryFn / 不 enable 抓取），只渲染 `as_of`（法人）、價格日期、`bsr_provider_state`；測試斷言此訂閱**不產生任何額外 request**。
2. **bounded chunking（解 §0.9-2）**：`useChipsBatch` 依 30 為單位切 `ceil(visible/30)` 個 POST（受限並行），移除靜默截斷；31 檔測試斷言請求數=2 且第 31 檔有狀態。
3. Demo 分支只調整顯示，不新增請求。
4. `bsrHeaderLabel.ts`：terminal 文案附最後可用日 = `bsr_as_of ?? bsr_source_date`（null → 「無可用資料」，**不硬編碼 2026-08-14**），移除「已排入／自動重試」。
5. `chipsFreshnessSegments.ts` 分段語意；`useChipsLifecycle/useChipsAutoBackfill/useChipsBackfill` terminal 時不呼叫 `enqueue_bsr_backfill`、不進 timeout、無無限 loading（法人 lane 保留）；`ChipsSection.tsx` 手動回補 disabled；`chipsRepository.ts` terminal 時不走 `CHIPS_FN_LEGACY`。
6. **qty 契約**：唯一來源 `checkup_storage` key=`pf-holdings-v2` → `h.qty`/`h.cost`（`HoldingCard.tsx:88-95`）；行情 null → 市值/損益「—」，qty **絕不** fallback 0；`h.qty===0`（真出清）正常顯示 0 股。desktop `HoldingsTab → HoldingsWorkbench → HoldingCard`；mobile 同組件樹；抽屜 `HoldingsDetailPanel → ChipsSection`。

**Allowlist**
```
src/checkup/components/freecheckup/HoldingCard.tsx
src/checkup/components/freecheckup/HoldingsWorkbench.tsx
src/checkup/components/freecheckup/bsrHeaderLabel.ts
src/checkup/components/freecheckup/chipsFreshnessSegments.ts
src/checkup/components/freecheckup/ChipsSection.tsx
src/checkup/hooks/useChipsBatch.ts
src/checkup/hooks/useChipsLifecycle.ts
src/checkup/hooks/useChipsAutoBackfill.ts
src/checkup/hooks/useChipsBackfill.ts
src/checkup/lib/chipsRepository.ts
src/test/unit/bsr-canonical-code-mapping.test.ts
src/test/unit/holdings-quantity-source.test.ts
src/test/unit/holdings-nodrawer-chips-consumer.test.tsx
src/test/unit/holdings-chips-chunking.test.ts
src/test/unit/bsr-terminal-no-backfill.test.tsx
e2e/holdings-bsr-unavailable.spec.ts
```
**Acceptance**：八項 RED 全轉 GREEN；E2E 不開抽屜即渲染日期與 BSR unavailable、請求數 = `ceil(visible/30)`；targeted + full vitest、`tsgo`、build；FreeCheckup 手機回歸（390/380/560）＋ desktop 截圖。
**Stop**：terminal 下出現 provider call/enqueue、或請求退化成 N+1。
**Rollback**：git revert 本批；Preview only，不需 Publish。

---

## Stage S3B-E — backlog 最小處理（只動 pending、只改 status）
**Actions**
```sql
-- 1) 先持久保存 ids（只存 id，不碰 last_error）
CREATE TABLE IF NOT EXISTS private_bsr.terminalized_pending_20260822 (
  id bigint PRIMARY KEY, captured_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON TABLE private_bsr.terminalized_pending_20260822 FROM PUBLIC;
INSERT INTO private_bsr.terminalized_pending_20260822(id)
SELECT id FROM public.tw_bsr_sync_queue
 WHERE status='pending' AND last_error IS DISTINCT FROM 'quota_recovery_token';

-- 2) 只改 status（updated_at 由 trg_tw_bsr_sync_queue_touch_updated 維護）
UPDATE public.tw_bsr_sync_queue SET status='skipped'
 WHERE status='pending' AND last_error IS DISTINCT FROM 'quota_recovery_token';
```
- ids 持久保存在 `private_bsr` 內部表（無 PostgREST 可達、零 GRANT），同時輸出 `count` 與 `md5(string_agg(id::text,',' ORDER BY id))` 到 receipt；**不存、不讀、不輸出 `last_error`**。
- 排除 `quota_recovery_token` sentinel（現為 0 筆，防禦性）；`failed` / `running` / `done` 完全不動；不設 `finished_at`、不覆寫 `last_error`。
- **前提**：§0.7 已證明本表為單一 BSR dataset、無 provider/job 型別 discriminator；唯一消費者 selector 是 `claim_bsr_queue_jobs`，其額外條件（priority/next_run_at/post_close_only）只會縮小抓取範圍，不影響 terminal 語意。
- 預估 affected rows ≈ **548**（執行當下重讀，偏差 >5% 中止）。

**Allowlist**：`supabase/migrations/<ts>_bsr_queue_terminalize_pending_only.sql`
**Acceptance**：pending 剩 0（或僅剩 token sentinel）；`failed` 仍 1572、`done` 8432、`running` 不變；`captured_at` 表列數 = affected rows；下一個 106 週期 inserted=0。
**Stop**：affected rows 偏差 >5%、failed/running/done count 改變。
**Semantic rollback**：
```sql
UPDATE public.tw_bsr_sync_queue q SET status='pending'
  FROM private_bsr.terminalized_pending_20260822 t
 WHERE q.id=t.id AND q.status='skipped';
```
（只改 status，其餘欄位維持原值。）

---

## Stage S3B-V — 全體使用者 row-level 驗收（read-only，必要）
service_role 執行、匿名化（`user_ref=left(sha256(user_id),8)`）：
1. `checkup_prefetch_universe()` 取**至少 2 位真實使用者**，各 1 個不在 `INIT_HOLDINGS` / `chips_prefetch_targets` 的 symbol，列 `sources`。
2. 各 symbol 各 lane max date：`tw_institutional_daily`、`daily_price_snapshots`、`current_prices`、`tw_bsr_daily`。
3. 未開抽屜時法人/OHLCV/價格排程照常（cron + 最近 run）。
拿不到 row-level 證據 → **誠實標 PARTIAL**（亦解 Stage 1 兩角色 RLS 缺口）。

## Preview 最終 gate
20 檔 INIT_HOLDINGS + 至少 1 位其他真實使用者、**先不開抽屜**：qty 真值（含真 0 股）、缺價「—」、法人/OHLCV/價格日期可見、BSR 顯示「資料來源目前不支援更新 · 最後可用 <查詢值>」。開抽屜後：queue counts/hash、config version、provider counters 全不變。證據鏈：cron 106 → runid（純 SQL，誠實標無 request_id/edge run_id）；worker → runid → request_id → HTTP → edge run_id → §0.6 body。

## Publish 授權
S3B-0/A/B/C1/C2/E 為後端（C2 含 edge deploy），**不需 Publish**。S3B-D Preview only；**進 production UI 必須另經你明確授權 Publish**。

## Security follow-up（本輪不做）
1. `tw_bsr_sync_queue.last_error` 既有 token 尾碼清理。
2. `claim_bsr_queue_jobs`（INVOKER）GRANT anon/authenticated、#3/#4 GRANT PUBLIC 的 ACL 收斂。
3. `exec_count` known debt 維持 debt=1。

## 風險矩陣
| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| 七支漏改 → unguarded 窗 | 中 | 高 | 單一 migration 原子部署 + 逐支斷言 |
| early-return 破壞回傳契約 | 中 | 高 | §0.1 型別表 + 逐鍵 contract test |
| CAS 吞掉 partial 狀態 | 中 | 高 | canonical 全欄驗證，partial 一律 raise |
| C1/C2 非原子造成中間態 | 中 | 中 | C1 後舊 mapping 已可 terminal；C2 失敗可單獨 revert |
| chunking 遺漏第 31 檔 | 中 | 高 | 31 檔專屬測試 + 請求數斷言 |
| 卡片未 rerender（僅 setQueryData） | 高 | 高 | 新增 read-only 訂閱 + no-extra-request 測試 |
| 誤動 token sentinel 列 | 低 | 中 | WHERE 排除 `quota_recovery_token` |
| 敏感字串外洩到 artifact | 中 | 高 | 只存 id/count/hash，不讀 raw last_error |
