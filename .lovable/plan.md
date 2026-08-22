# Stage 3B（v3）— Honest Downgrade：先關入口 → 再宣告狀態 → 最後才動 backlog

判定沿用 Stage 2（FinMind level=register，單股與 market_batch 皆 HTTP 400，deterministic terminal）。目標：**不開抽屜時持倉看板仍自動取得可取得的最新資料**；BSR 誠實標示不可更新，停止無效排隊；不升級方案、不換來源、不造假資料。本版整份取代 v2。

---

## 0. 唯讀稽核事實（本輪實測，非推測）

### 0.1 七支 DB function（#1–#5 + R1/R2）+ 一個 legacy edge call site（#6）

| # | exact signature | RETURNS | prosecdef | owner | proconfig | ACL(EXECUTE) | effective caller |
|---|---|---|---|---|---|---|---|
| 1 | `public.enqueue_chips_prefetch_gaps(integer,integer)` | `jsonb` | DEFINER | postgres | `search_path=public` | postgres, service_role | cron 106 |
| 2 | `public.enqueue_all_active_tw_holdings_bsr(integer)` | `jsonb` | DEFINER | postgres | `search_path=public` | postgres, anon, authenticated, service_role | ops/edge |
| 3 | `public.enqueue_bsr_first_fetch_on_trade()` | `trigger` | DEFINER | postgres | `search_path=public` | PUBLIC+all | `trg_trade_records_bsr_first_fetch` AFTER INSERT ON `trade_records` |
| 4 | `public.ensure_bsr_queued(text)` | `jsonb` | DEFINER | postgres | `search_path=public` | PUBLIC+all | 舊 lazy 路徑 |
| 5 | `public.enqueue_bsr_backfill(text,integer)` | `integer` | DEFINER | postgres | `search_path=public` | postgres, anon, authenticated, service_role | `useChipsBackfill.ts`（authenticated rpc） |
| R1 | `public.recover_stale_bsr_queue_jobs(integer,integer)` | `jsonb` | DEFINER | postgres | `search_path=public` | postgres, service_role | 由 #1 內部呼叫 |
| R2 | `public.recover_quota_failed_bsr_jobs(integer)` | `jsonb` | DEFINER | postgres | `search_path=public` | postgres, service_role | 由 #1 內部呼叫 |
| 6 | legacy edge `tw-chips-detail`（`chipsRepository.ts:305 CHIPS_FN_LEGACY`） | — | — | — | — | 僅 `VITE_CHIPS_ENDPOINT` 覆寫時可達 | 前端 call site，**不在 migration 內** |

**早退回傳必須型別相容**（不得改型別）：
- jsonb 五支（#1,#2,#4,R1,R2）：回既有 shape 再加 `"skipped":"bsr_provider_unsupported"`，保留原有必備鍵（#1 `inserted`、#2 `inserted`、#4 `eligible/created/status`、R1/R2 `revived`）為 0/false，前端與 worker 解析不變。
- #3 `trigger`：`RETURN NEW`。
- #5 `integer`：回 `0`（**不改型別、不加欄位**）；抑制語意由前端改讀 payload `bsr_provider_state`，不靠回傳值。

### 0.2 Gate 物件與權限（Stage 1 既有）
- `private_bsr` schema ACL = `postgres=UC/postgres`（anon/authenticated/service_role **無 USAGE**）。
- `private_bsr.gate_state()` DEFINER / `search_path=pg_catalog, private_bsr` / 僅 postgres。
- `private_bsr.gate_classify(boolean,jsonb)` INVOKER / `search_path=pg_catalog` / 僅 postgres（純函式）。
- `private_bsr.assert_sanitized(jsonb,integer)` DEFINER / 僅 postgres。

### 0.3 **HARD STOP #1 — definer search_path 安全性（已量測，PASS）**
```
has_schema_privilege(anon,'public','CREATE')          = f
has_schema_privilege(authenticated,'public','CREATE') = f
has_schema_privilege(service_role,'public','CREATE')  = f
public nspacl = pg_database_owner=UC ; =U ; postgres=U ; anon=U ; authenticated=U ; service_role=U
```
→ 非特權角色**無法在 public 建物件**，故 definer `search_path=pg_catalog, public` 安全。
- 但 `private_bsr.ingest_allowed()` 本身**不需要** public：其唯一依賴是 `private_bsr.gate_state()`（自身已 DEFINER 讀 `public.tw_bsr_sync_config` 並完全 schema-qualified）→ **`ingest_allowed` 的 search_path = `pg_catalog, private_bsr`，不含 public**。
- 七支 ingress/recovery 因本身大量存取 public 表，`search_path=pg_catalog, public`；同時 migration 內對 `private_bsr.*` 一律完全 schema-qualify。
- **執行前必須重跑一次此三行查詢**；任一為 `t` → **停止本階段**，改為 `search_path=pg_catalog` + 全部 public 物件 schema-qualified。

### 0.4 **HARD STOP #2 — `bsr_block_and_terminalize_claims` 不能用於本 transition（已讀 exact branch）**
`pg_get_functiondef` 實測：
1. `IF p_terminal_code IS DISTINCT FROM 'finmind_admission_provider_plan_rejected' THEN RAISE EXCEPTION` → **terminal_code 白名單只接受這一個字串**。
2. `v_blocked := gate_classify(true, v_cfg)->>'blocked'`；`IF v_blocked THEN v_transition := 'already_blocked';`（**不 UPDATE config、不 bump version**）`ELSE`（才寫 admission_* 並 `version+1`）。
3. audit/degrade 僅在 `v_transition='blocked'` 時寫入。

目前 `legacy_config_missing` 已使 `blocked=true` → **空 claims 呼叫必定走 `already_blocked`，不會把 v7 轉成顯式狀態**。v2 的設計無效，v3 改為 compare-and-set migration（見 S3B-C）。

### 0.5 Canonical code mapping（唯一一組；與既有 RPC/classifier 對齊，不新造字串）

| 層 | 欄位 | 唯一值 | 依據 |
|---|---|---|---|
| DB config | `admission_blocked` / `admission_reason` | `true` / `provider_plan_rejected` | 既有 RPC 硬寫此 reason |
| DB terminal code | `admission_terminal_code` | `finmind_admission_provider_plan_rejected` | 既有 RPC 白名單唯一值 |
| Edge worker body | `reason` / `terminal_code` | `provider_plan_rejected` / `finmind_admission_provider_plan_rejected` | 同上 |
| ingress 抑制 | `skipped` | `bsr_provider_unsupported` | 新增，唯一值 |
| payload | `bsr_provider_state` / `bsr_provider_code` | `terminal_provider_rejected` / `provider_plan_rejected` | `bsrProviderState.ts:107/117` 既有常數 |
| UI | 文案 | 「資料來源目前不支援更新 · 最後可用 YYYY/MM/DD」 | 不曝光供應商帳號等級 |

`provider_unsupported_plan` 一詞**從計畫中移除**（v2 遺留），`legacy_config_missing` 在 S3B-C 後不得再是正式狀態。由 `src/test/unit/bsr-canonical-code-mapping.test.ts` 鎖定。

### 0.6 Queue 狀態機 / 索引 / 觸發器
- `tw_bsr_sync_queue_active_uniq`：`UNIQUE (stock_id, trade_date) WHERE status IN ('pending','running','failed','skipped')` → **skipped 仍佔 uniqueness**。
- 恢復 runbook（本輪不執行，寫入 S3B-C migration 註解 + 測試斷言）：未來 `bsr_unblock_after_probe` 成功時，同交易執行
  `UPDATE public.tw_bsr_sync_queue SET status='pending', next_run_at=now(), updated_at=now() WHERE status='skipped' AND id = ANY(<S3B-E ids>);` → 舊日期原地復活不撞 unique；新日期本無衝突列。
- `claim_bsr_queue_jobs(integer,integer)` INVOKER，只選 `status='pending'` → skipped 是安全 terminal，**不需改 schema**。
- `tw_bsr_sync_queue` 只有一個 trigger：`trg_tw_bsr_sync_queue_updated BEFORE UPDATE ... tw_bsr_sync_queue_touch_updated()`；欄位 `finished_at` nullable、`updated_at` NOT NULL、`last_error` nullable → **不需要在 UPDATE 中設 finished_at**（S3B-E 據此縮小）。
- 現況：total 10552（done 8432 / failed 1572 / pending 548），全表 hash `73c0df1e3a38f4c8f81e49e0e8b65346`。
- **敏感發現**：部分既有 `last_error` 含 provider token 尾碼；本輪**不讀出、不匯出、不覆寫**，列 security follow-up。

### 0.7 未開抽屜的 exact render flow（原始 bug 閉環依據）
```
FreeCheckup → HoldingsTab → HoldingsWorkbench.tsx
  L91-94  sparklineCodes = orderedDisplayed.map(h => h.code)   ← 目前顯示中的持倉
  L101    useSparklines(sparklineCodes)                        ← OHLCV lane
  L105    useChipsBatch({ codes: sparklineCodes, enabled: !isDemo })
```
`useChipsBatch.ts:37-77`：codes 變動時（`useEffect`，非 hover、非點擊）→ `fetchChipsBatch()` → `chipsRepository.ts:476` **單次 `POST /tw-chips-detail-v2`，body `{stock_ids}`**，上限 30（`CHIPS_BATCH_MAX_STOCKS`）；結果以 `qc.setQueryData(chipsQueryKey(code), …)` 灌入快取。`CHIPS_FN_DEFAULT='tw-chips-detail-v2'`（`chipsRepository.ts:304`）。
→ **batch 路徑已存在且非 N+1，不需新建 endpoint**。缺的是：`enabled: !isDemo` 與**卡片層沒有渲染 `bsr_provider_state` / `bsr_as_of` / `as_of`**，所以使用者看不到日期與狀態。S3B-D 只補渲染與 Demo 分支，不新增 fan-out。

### 0.8 payload terminal state 的 server mapping（已存在，僅需最小補強）
`tw-chips-detail-v2/index.ts:228-247`：
```
marketBatchUnsupported = marketBatch.supported === false
                      && marketBatch.last_probe_outcome === 'unsupported'
marketBatchError       = marketBatch.last_probe_error
marketBatchErrorClass  = startsWith('unsupported_plan:') ? 'provider_plan_rejected' : null
→ classifyBsrProvider({ lastErrorRaw: marketBatchError ?? …, persistedErrorClass: marketBatchErrorClass ?? … })
→ bsr_provider_state='terminal_provider_rejected', bsr_provider_code='provider_plan_rejected'
```
production 現值：`supported=false`、`last_probe_outcome=unsupported`、`last_probe_error` 以 `unsupported_plan:` 開頭 → **不需新的 provider 400，payload 已能得到 terminal**。
**最小補強（S3B-C 同批）**：mapping 增加一條 OR — `config->>'admission_blocked'='true'` 亦視為 `marketBatchUnsupported`，`persistedErrorClass='provider_plan_rejected'`，且**改用 `admission_reason` 而非 raw `last_probe_error`** 餵 classifier，避免把供應商原文（含帳號等級字樣）帶進判定輸入。此為 side-by-side v2 的最小 server mapping 修改，不改 classifier 本身。

---

## Stage S3B-0 — RED tests（先於任何 migration）
**Actions**
- `supabase/tests/bsr_ingest_suppression_test.sql`：blocked 時 7 支皆 inserted/revived=0，且**回傳型別與必備鍵未變**（jsonb 五支逐鍵斷言、#5 回 integer 0、#3 trigger 後 trade 仍寫入）。
- `supabase/tests/bsr_gate_helper_acl_test.sql`：`private_bsr` 對 anon/auth/service_role 無 USAGE；`ingest_allowed` 對所有角色零 GRANT；無新增 public 面 gate 函式；三行 `has_schema_privilege(...,'public','CREATE')` 皆 `f`。
- `supabase/tests/bsr_availability_cas_test.sql`：legacy blocked → explicit blocked 成功；重跑冪等（第二次不再 bump version、不重複 audit）；**不會開閘**（blocked 仍 true）；0 queue mutation；preimage 不符時 raise。
- `supabase/tests/bsr_queue_terminal_test.sql`：`claim_bsr_queue_jobs` 不選 skipped；unique predicate 含 skipped；恢復 runbook UPDATE 可 skipped→pending 且不違反 unique；UPDATE 不需 finished_at（NOT NULL 僅 `updated_at`，由 trigger 維護）。
- 前端測試（見 S3B-D）+ `src/test/unit/bsr-canonical-code-mapping.test.ts`。
- **RED E2E**：`e2e/holdings-bsr-unavailable.spec.ts` — 載入持倉看板、**不點任何 row／不開抽屜**，斷言(a)發出 **恰 1 次** `POST /tw-chips-detail-v2`（bounded、含 ≤30 個 stock_ids，非 N+1）；(b)卡片渲染法人 `as_of`／價格日期；(c)BSR 顯示 unavailable 文案＋最後可用日。

**Allowlist**：僅上述測試檔。**Acceptance**：全部 RED。**Stop**：任何意外 GREEN。**Rollback**：刪測試檔。

---

## Stage S3B-A — 原子部署七支 ingress/recovery 的 blocked early-return（先關入口）
此時 gate 仍 `legacy_config_missing`（blocked=true），部署即刻全關，**零 unguarded 時間窗**。

**Actions**（單一 migration、單一交易）
1. 建 `private_bsr.ingest_allowed()`：DEFINER、`search_path=pg_catalog, private_bsr`、owner=postgres、`REVOKE ALL FROM PUBLIC`、**不 GRANT 任何角色**；body = `SELECT NOT (private_bsr.gate_classify((private_bsr.gate_state()).*) ->> 'blocked')::boolean`（依 `gate_state` exact 回傳型別於實作時對齊）。
   可呼叫性論證：#1–#5/R1/R2 皆 **DEFINER 且 owner=postgres**，執行期 current_user=postgres，postgres 對 `private_bsr` 有 USAGE、對 helper 有 owner 隱含 EXECUTE；呼叫端角色不因此獲得任何權限（privilege 檢查在 definer context 完成，helper 零 GRANT）。
2. `CREATE OR REPLACE` 七支：開頭 `IF NOT private_bsr.ingest_allowed() THEN RETURN <型別相容 suppressed>; END IF;`（完全 schema-qualified）；`SET search_path = pg_catalog, public`；逐支註記維持 DEFINER 的理由；**ACL 一字不改**；#1 在 suppressed 分支不呼叫 R1/R2。

**Allowlist**
```
supabase/migrations/<ts>_bsr_ingest_suppression_gate.sql
```
**Acceptance**：suppression / ACL 測試轉 GREEN；`pg_proc` readback 七支 proconfig=`search_path=pg_catalog, public`、RETURNS 型別與 ACL 與部署前逐項相同；`ingest_allowed` proacl 為零 GRANT；config 仍 v7、queue hash 仍 `73c0df1e…`。
**Stop**：任一 ACL/型別改變、config/queue 被動到、或 §0.3 三行查詢出現 `t`。
**Semantic rollback**：migration 內附部署前七支 exact `CREATE OR REPLACE`（含原 proconfig 與 ACL 還原）＋ `DROP FUNCTION private_bsr.ingest_allowed()`。

---

## Stage S3B-B — 自然週期觀察（零 mutation）
**Actions**：等一個 cron 106（`2 * * * *`，純 SQL，**無 request_id / 無 edge run_id**，只取 `job_run_details.runid`）＋一個 worker（46/51/98/107 → runid → request_id → HTTP → edge run_id → body）。
**Acceptance**：106 回 `skipped:bsr_provider_unsupported`、inserted=0、revived=0；queue counts/hash 不變；worker `claimed=0 / provider_calls=0`；provider counters（`finmind_quota_pools.used_today`、`finmind_quota_ledger`、`tw_bsr_api_usage`）不變。
**Stop**：inserted>0 / revived>0 / provider_calls>0 → 回滾 S3B-A，不進 C。

---

## Stage S3B-C — compare-and-set 宣告顯式 availability truth（v7→v8）
**不使用** `bsr_block_and_terminalize_claims`（§0.4 已證明其 `already_blocked` 分支不支援此 transition）。

**Actions**（單一 migration，單一交易）
1. `SELECT config, version FROM public.tw_bsr_sync_config WHERE key='market_batch' FOR UPDATE;`
2. **preimage 斷言**：`version = 7` 且 `md5(config::text) = 'dd747a45d3e46b2acc3f0c021bc269f8'`（執行前重讀確認；若已由他路徑改變則 `RAISE EXCEPTION 'preimage_mismatch'` → 整筆 rollback）。已具 `admission_blocked` 時視為冪等成功、不再 bump version。
3. 原子 merge：`config || jsonb_build_object('admission_blocked', true, 'admission_reason','provider_plan_rejected', 'admission_terminal_code','finmind_admission_provider_plan_rejected', 'admission_blocked_at', <txn now>, 'admission_run_id', <uuid>, 'admission_nonce', gen_random_uuid()::text, 'admission_evidence', <sanitized>)`，`version = version + 1`，`updated_at = now()`。
4. `PERFORM private_bsr.assert_sanitized(<evidence>, 0)`；**evidence 僅含** `{stage:'stage2', http_status:400, provider_code:'provider_plan_rejected', dataset:'TaiwanStockTradingDailyReport', probe_symbol:'3017', probe_date:'2026-08-21', observed_at:<migration execution timestamp>}`。**不放 token、不放 provider 原始 body、不放 URL**；`observed_at` 為精確交易時間，不使用模糊值。
5. append 一筆 `audit_logs('bsr_admission_blocked')` 與一筆 `tw_bsr_degrade_events`（append-only）。
6. 同批最小 server mapping（§0.8）：`tw-chips-detail-v2` 增 `admission_blocked=true` 視為 terminal，並以 `admission_reason` 取代 raw `last_probe_error` 餵 classifier。
7. migration 註解寫入 §0.6 恢復 runbook。

worker 之後的 exact body：
```json
{"ok":true,"mode":"worker","run_id":"<uuid>","decision":"blocked",
 "reason":"provider_plan_rejected","terminal_code":"finmind_admission_provider_plan_rejected",
 "gate_version":8,"claimed":0,"processed":0,"provider_calls":0}
```
**Allowlist**
```
supabase/migrations/<ts>_bsr_admission_declare_explicit_cas.sql
supabase/functions/tw-chips-detail-v2/index.ts
```
**Acceptance**：CAS 測試 GREEN（legacy→explicit 成功、重跑冪等、未開閘、0 queue mutation、preimage 不符即 raise）；config v8 且 `admission_reason='provider_plan_rejected'`；worker body 不再出現 `legacy_config_missing`；再觀察一個 106 + 一個 worker：inserted/revived/claimed/provider_calls 全 0、queue hash 不變；payload `bsr_provider_state='terminal_provider_rejected'`。
**Stop**：preimage 不符、body 未變、queue/provider counters 變動。
**Semantic rollback（明確非 exact inverse）**：
```sql
UPDATE public.tw_bsr_sync_config
   SET config = config - 'admission_blocked' - 'admission_reason' - 'admission_terminal_code'
                       - 'admission_blocked_at' - 'admission_run_id' - 'admission_nonce'
                       - 'admission_evidence',
       version = version + 1,          -- 單調遞增（結果 v9），語意等同 v7 fail-closed
       updated_at = now()
 WHERE key = 'market_batch';
```
`audit_logs` / `tw_bsr_degrade_events` 為 append-only：**保留原紀錄並追加 rollback audit**，不刪除、不回寫 Stage 2 原始 provider body。edge 變更以 git revert。

---

## Stage S3B-D — 前端 honest downgrade（Preview only）
**未開抽屜資料流（沿用既有 batch，不新增 endpoint / 不增 fan-out）**
`HoldingsWorkbench.tsx:91-105` → `useChipsBatch`（單次 `POST /tw-chips-detail-v2`，≤30 codes）→ `qc.setQueryData(chipsQueryKey(code))` → 卡片層直接讀快取。
變更：(a) 卡片渲染 `as_of`（法人）／價格日期／`bsr_provider_state`；(b) Demo 分支改為顯示狀態而非空白（`enabled` 策略於實作時保守處理，不新增請求）；(c) query key 不變。

**持股 quantity / cost 契約**
- 唯一來源：使用者自己的 `checkup_storage` key=`pf-holdings-v2` → holding 物件 `h.qty` / `h.cost`（`HoldingCard.tsx:88-95`），經 `useFreeCheckupBootstrap.js` / `FreeCheckup.jsx` 載入。BSR/行情**皆非** qty 來源。
- 行情 null → `price` null → **市值／損益顯示「—」**；`h.qty` **絕不** fallback 0。
- `h.qty === 0`（真的出清）→ 正常顯示 0 股，**不得**判為錯誤/缺資料。兩情境各一測試。
- desktop：`HoldingsTab → HoldingsWorkbench → HoldingCard`；mobile 同組件樹（`holdingsTab.css` + `_ui`）；抽屜 `HoldingsDetailPanel → ChipsSection`。

**其他變更**：`bsrHeaderLabel.ts` terminal 文案附最後可用日（`bsr_as_of ?? bsr_source_date`，null 時顯示「無可用資料」，**不硬編碼 2026-08-14**）、移除「已排入／自動重試」字樣；`chipsFreshnessSegments.ts` 分段語意；`useChipsLifecycle/useChipsAutoBackfill/useChipsBackfill` terminal 時不呼叫 `enqueue_bsr_backfill`、不進 timeout、無無限 loading（法人 lane 保留）；`ChipsSection.tsx` 手動回補按鈕 disabled；`chipsRepository.ts` 確認 terminal 時不走 `CHIPS_FN_LEGACY`。

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
src/test/unit/holdings-quantity-never-zero-fallback.test.ts
src/test/unit/bsr-terminal-no-backfill.test.tsx
e2e/holdings-bsr-unavailable.spec.ts
```
**Acceptance**：RED E2E 轉 GREEN（不開抽屜即 1 次 bounded batch + 渲染日期 + BSR unavailable）；targeted + full vitest、`tsgo`、build；FreeCheckup 手機回歸（390/380/560）＋ desktop 截圖。
**Stop**：terminal 狀態下仍出現 provider call 或 enqueue、或 batch 退化成 N+1。
**Rollback**：git revert 本批；Preview only，**不需 Publish**。

---

## Stage S3B-E — backlog 最小處理（只動 pending，且只改 status）
**Actions**（A/B/C 全綠後）
```sql
UPDATE public.tw_bsr_sync_queue
   SET status = 'skipped'          -- updated_at 由 trg_tw_bsr_sync_queue_touch_updated 維護
 WHERE status = 'pending';
```
- **不覆寫 `last_error`、不設 `finished_at`**（`finished_at` nullable、`updated_at` 由 trigger 維護，已由 §0.6 contract test 證明），避免丟失 `quota_deferred` 或複製敏感字串。
- `failed=1572` 完全不動（R1/R2 已 early-return，不會復活）；`running`/`done` 不動。
- 預估 affected rows ≈ **548**（執行當下重讀，偏差 >5% 中止）。
- 證據**只記錄** id 清單、`count(*)`、`md5(string_agg(id::text,','))`、狀態分佈；**不讀出、不匯出任何 `last_error` 原文**。

**Allowlist**
```
supabase/migrations/<ts>_bsr_queue_terminalize_pending_only.sql
```
**Acceptance**：pending=0；failed 仍 1572 且其列 `last_error` 未被本 UPDATE 觸及（以 WHERE 條件與 row count 證明，不輸出內容）；done 不變；下一個 106 inserted=0。
**Stop**：affected rows 偏差 >5%、或 failed/running row count 改變。
**Semantic rollback**（只用本輪 ids，其他欄位保持原值）：
```sql
UPDATE public.tw_bsr_sync_queue SET status='pending'
 WHERE id = ANY(<saved ids>) AND status='skipped';
```

---

## Stage S3B-V — 全體使用者 row-level 驗收（read-only，必要）
service_role 執行、匿名化（僅 `user_ref=left(sha256(user_id),8)`）：
1. `checkup_prefetch_universe()` 取**至少 2 位真實使用者**，各 1 個不在 `INIT_HOLDINGS` 與 `chips_prefetch_targets` 的 symbol，列 `sources`。
2. 各 symbol 各 lane max date：`tw_institutional_daily`、OHLCV/`daily_price_snapshots`、`current_prices`、`tw_bsr_daily`。
3. 未開抽屜時法人/OHLCV/價格排程照常（cron + 最近 run）。
拿不到 row-level 證據 → **誠實標 PARTIAL**（亦是 Stage 1 兩角色 RLS 缺口的解）。

## Preview 最終 gate
20 檔 INIT_HOLDINGS + 至少 1 位其他真實使用者，**先不開抽屜**：qty 為真值（含真 0 股情境）、缺價顯示「—」、法人/OHLCV/價格日期可見、BSR 顯示「資料來源目前不支援更新 · 最後可用 <查詢值>」。之後開抽屜：queue counts/hash、config version、provider counters 全部不變。證據鏈：cron 106 → runid（誠實標無 request_id/edge run_id）；worker → runid → request_id → HTTP → edge run_id → body。

## Publish 授權
S3B-0/A/B/C/E 為後端（含 C 的 edge 部署），**不需 Publish**。S3B-D 為 Preview only；**進 production UI 必須另經你明確授權 Publish**。

## Security follow-up（本輪不做）
1. `tw_bsr_sync_queue.last_error` 既有 token 尾碼清理。
2. `claim_bsr_queue_jobs`（INVOKER）GRANT 給 anon/authenticated、#3/#4 GRANT 給 PUBLIC 的 ACL 收斂。
3. `exec_count` known debt 維持 debt=1。

## 風險矩陣
| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| 七支改寫漏一支 → unguarded 窗 | 中 | 高 | 單一 migration 原子部署 + 逐支斷言 |
| early-return 破壞回傳契約 | 中 | 高 | §0.1 型別表 + 逐鍵 contract test |
| CAS preimage 競態 | 低 | 中 | `FOR UPDATE` + version/md5 斷言 + 例外回滾 |
| definer search_path 提權 | 低 | 高 | §0.3 hard stop，執行前重測 |
| skipped 佔 uniqueness 造成鎖死 | 中 | 中 | 恢復 runbook + 測試斷言 + 保存 ids |
| 前端缺價顯示成 0 股 | 中 | 高 | 兩條專屬測試 + 雙裝置截圖 |
| 敏感字串外洩到 artifact | 中 | 高 | 只記 id/count/hash，不讀 raw last_error |
