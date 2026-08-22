# Stage 3B（修正版 v2）— Honest Downgrade：先關入口，再宣告狀態，最後才動 backlog

判定沿用 Stage 2：FinMind 現行方案（level=register）對單股 `TaiwanStockTradingDailyReport` 與 market_batch 皆回 HTTP 400，屬 deterministic terminal。本輪不升級方案、不換來源、不造假資料。目標：**使用者不開抽屜時，持倉看板仍自動取得可取得的最新資料（法人／OHLCV／價格）**；BSR 誠實標示不可更新，並停止無效排隊。

本版整份取代前一版 Stage 3B Plan。

---

## 0. 唯讀稽核事實（本輪實測，計畫據此設計）

### 0.1 六個 ingress + 兩個 recovery + trigger 的 exact 權限表

| # | exact signature | prosecdef | owner | proconfig | ACL（EXECUTE） | effective caller |
|---|---|---|---|---|---|---|
| 1 | `public.enqueue_chips_prefetch_gaps(integer,integer)` | **DEFINER** | postgres | `search_path=public` | postgres, service_role | cron 106（`SELECT` via pg_cron，postgres） |
| 2 | `public.enqueue_all_active_tw_holdings_bsr(integer)` | DEFINER | postgres | `search_path=public` | postgres, anon, authenticated, service_role | ops / edge |
| 3 | `public.enqueue_bsr_first_fetch_on_trade()` | DEFINER | postgres | `search_path=public` | PUBLIC + all | trigger `trg_trade_records_bsr_first_fetch` AFTER INSERT ON `public.trade_records` |
| 4 | `public.ensure_bsr_queued(text)` | DEFINER | postgres | `search_path=public` | PUBLIC + all | 舊 lazy 路徑 |
| 5 | `public.enqueue_bsr_backfill(text,integer)` | DEFINER | postgres | `search_path=public` | postgres, anon, authenticated, service_role | `src/checkup/hooks/useChipsBackfill.ts`（gateway.rpc，authenticated） |
| 6 | legacy edge `tw-chips-detail`（`chipsRepository.ts:305 CHIPS_FN_LEGACY`） | — | — | — | 僅 `VITE_CHIPS_ENDPOINT` 覆寫時可達 | 預設不可達（v2 為 read-only） |
| R1 | `public.recover_stale_bsr_queue_jobs(integer,integer)` | DEFINER | postgres | `search_path=public` | postgres, service_role | 由 #1 內部呼叫 |
| R2 | `public.recover_quota_failed_bsr_jobs(integer)` | DEFINER | postgres | `search_path=public` | postgres, service_role | 由 #1 內部呼叫 |

Gate 物件（Stage 1 已建）：
- `private_bsr` schema ACL = `postgres=UC/postgres`（**anon/authenticated/service_role 皆無 USAGE**）。
- `private_bsr.gate_state()` DEFINER / `search_path=pg_catalog, private_bsr` / ACL 僅 postgres。
- `private_bsr.gate_classify(boolean,jsonb)` **INVOKER** / `search_path=pg_catalog` / ACL 僅 postgres（純函式，不讀表）。
- `private_bsr.assert_sanitized(jsonb,integer)` DEFINER / ACL 僅 postgres。

**權限結論（取代前一版錯誤設計）**
- 前一版提的 `public.bsr_ingest_allowed()` service_role-only **取消**，不新增任何 public 面 gate 讀取器（PostgREST 不得再多一個可探測端點）。
- 改為新增 `private_bsr.ingest_allowed()`：**SECURITY DEFINER、`search_path=pg_catalog, private_bsr, public`、owner=postgres、`REVOKE ALL FROM PUBLIC`、不 GRANT 任何角色**。
- 可呼叫性論證（不是「同 owner 所以可以」）：#1–#5 全部是 **SECURITY DEFINER 且 owner=postgres**，執行期間 current_user 切換為 postgres；postgres 對 `private_bsr` 有 USAGE、對 helper 有 owner 隱含 EXECUTE → 呼叫成立。呼叫端角色（anon/authenticated/service_role）**不會**因此取得 helper 權限，因為 privilege 檢查在 definer context 完成，且 helper 未 GRANT 給任何人。
- **Security stop gate（不可照抄）**：#1–#5 的 `search_path=public` 不含 `private_bsr`，所有呼叫**必須完全 schema-qualify** 為 `private_bsr.ingest_allowed()`；migration 必須逐支重寫 `SET search_path` 為 `pg_catalog, public`（移除可被搜尋路徑攻擊的裸 `public`），且每支加註為何維持 DEFINER。任何一支若無法安全改寫，該支改為「不呼叫 helper、改讀 `public.tw_bsr_sync_config` 同一列的 `admission_blocked` 欄位」的降權方案（同一真相、無跨 schema 呼叫），並在計畫執行時明列。
- **附帶發現（不在本輪修，列 security follow-up）**：`public.claim_bsr_queue_jobs(integer,integer)` 是 SECURITY INVOKER 但 GRANT 給 anon/authenticated；`#3/#4` GRANT 給 PUBLIC。本輪不改 ACL（會擴大 scope），列入 follow-up 清單。

### 0.2 Queue 狀態機與唯一索引

- `tw_bsr_sync_queue_active_uniq`：`UNIQUE (stock_id, trade_date) WHERE status = ANY ('pending','running','failed','skipped')`。
- **`skipped` 仍佔 uniqueness** → honest downgrade 後，同 (stock_id, trade_date) 無法再 INSERT。
- **恢復路徑（必須寫進計畫，避免永久鎖死）**：未來 `bsr_unblock_after_probe` 成功時，同一支 unblock 交易內執行
  `UPDATE public.tw_bsr_sync_queue SET status='pending', last_error=NULL, next_run_at=now() WHERE status='skipped' AND last_error='finmind_provider_unsupported_plan';`
  → 舊日期原地復活（不 INSERT、不撞 unique）；新日期本來就無衝突列可 INSERT。此 UPDATE **本輪不執行**，只作為 S3B-C migration 內附的「恢復 runbook SQL」與測試斷言。
- `claim_bsr_queue_jobs` 只選 `status='pending'` → `skipped` 是安全 terminal，**不需改 schema**。

### 0.3 Queue 現況（read-only，匿名化）
- total 10552 = done 8432 / failed 1572 / pending 548；trade_date 2026-04-06 ~ 2026-08-21。
- 全表 hash `73c0df1e3a38f4c8f81e49e0e8b65346`；pending+failed 子集 hash `c525fd99b4287c21ae17e21b16934df6`。
- **敏感發現**：部分既有 `last_error` 內含 provider token 尾碼字串。**本輪不匯出、不轉存、不修改**這些值；不寫進 CSV/docs/artifact/rollback。列為獨立 security follow-up（清理 `tw_bsr_sync_queue.last_error` 與同類欄位）。

### 0.4 資料車道
`tw_bsr_daily` max = 2026-08-14（3,679,883 rows）；`tw_institutional_daily` max = 2026-08-21；OHLCV／價格車道獨立且新鮮，本計畫完全不觸碰。

### 0.5 payload 既有欄位（`tw-chips-detail-v2`，已存在，非假設）
`chipsRepository.ts` 契約 + `tw-chips-detail-v2/index.ts:441-463` 實際回傳：

| field | type | 來源行 |
|---|---|---|
| `as_of` / `as_of_lag_days` | `string \| null` / `number \| null` | idx:441-442（法人 lane） |
| `bsr_as_of` | `string \| null` | idx:445 = `chosenAsOf`（由 `tw_chips_rollup.as_of_date` 最新且 `bsr_available` 決定，L80-145） |
| `bsr_as_of_lag_days` | `number \| null` | idx:446 |
| `bsr_source_date` | `string \| null` | idx:448（本次實際使用的來源日，可能早於 `bsr_as_of`） |
| `bsr_provider_state` | `BsrProviderState` | idx:461 |
| `bsr_provider_code` | `string` | idx:462 |
| `bsr_retry_promised` | `boolean` | idx:463 |

`bsrProviderState.ts:107/117` 已將 HTTP 400 `level is register` 分類為 `state='terminal_provider_rejected', code='provider_plan_rejected'`。**「最後可用日」由 `bsr_as_of ?? bsr_source_date` 取得，全部由資料查出，前端不硬編碼 2026-08-14。**

### 0.6 前端持股來源
`HoldingCard.tsx:88-95`：`h.qty`、`h.cost`、`price`。持股物件來自使用者自己的 `checkup_storage` key=`pf-holdings-v2`（`src/hooks/useFreeCheckupBootstrap.js`、`src/pages/FreeCheckup.jsx`、`src/pages/_freeCheckup/constants.jsx`）。**BSR/行情皆非 qty 來源**，任何缺漏都不得改寫 qty。

---

## Canonical code mapping（唯一一組，全鏈禁止漂移）

| 層 | 欄位 | 唯一值 |
|---|---|---|
| DB config（`tw_bsr_sync_config.market_batch`） | `admission_blocked` / `admission_reason` | `true` / `provider_unsupported_plan` |
| DB terminal code（queue `last_error`、degrade event、audit） | `terminal_code` | `finmind_provider_unsupported_plan` |
| Edge worker body | `reason` / `terminal_code` | `provider_unsupported_plan` / `finmind_provider_unsupported_plan` |
| Edge ingress 抑制回傳 | `skipped` | `bsr_provider_unsupported` |
| payload（v2，**沿用既有常數，不改分類器**） | `bsr_provider_state` / `bsr_provider_code` | `terminal_provider_rejected` / `provider_plan_rejected` |
| UI | 文案 | 「資料來源目前不支援更新 · 最後可用 YYYY/MM/DD」 |

`legacy_config_missing` 在 S3B-C 之後不得再成為正式狀態。`provider_plan_rejected` 只出現在 payload/UI 層（既有常數），`provider_unsupported_plan` 只出現在 DB/edge 決策層；mapping 由單一測試檔 `src/test/unit/bsr-canonical-code-mapping.test.ts` 鎖定。UI 文案不曝光供應商帳號等級細節。

---

## Stage S3B-0 — RED tests（先於任何 migration）

**Actions**：撰寫並跑出 RED 的：
- `supabase/tests/bsr_ingest_suppression_test.sql`：blocked 時 6 個 ingress + 2 recovery 皆 inserted/revived=0。
- `supabase/tests/bsr_gate_helper_acl_test.sql`：`private_bsr` schema 對 anon/authenticated/service_role 無 USAGE；`private_bsr.ingest_allowed()` 對任何角色無 EXECUTE；無新增 public 面 gate 函式。
- `supabase/tests/bsr_queue_terminal_test.sql`：`claim_bsr_queue_jobs` 不選 `skipped`；unique index predicate 含 `skipped`；恢復 runbook UPDATE 可讓 skipped→pending 且不違反 unique。
- `src/test/unit/bsr-canonical-code-mapping.test.ts`
- 前端測試（見 S3B-D）。

**Allowlist**：僅上述 test 檔。
**Acceptance**：全部 RED（明確指出缺哪個物件／行為）。
**Stop**：任何測試「意外 GREEN」→ 停，代表假設錯誤。
**Rollback**：刪除測試檔（無 production 影響）。

---

## Stage S3B-A — 原子部署 ingress + recovery 的 blocked early-return（**先關入口**）

此時 gate 仍是 `legacy_config_missing`（fail-closed），因此部署後入口立即全數關閉，**不留任何 unguarded 時間窗**。

**Actions**（單一 migration，單一交易）
1. 建 `private_bsr.ingest_allowed()`：DEFINER、`search_path=pg_catalog, private_bsr, public`、`REVOKE ALL ON FUNCTION ... FROM PUBLIC`、不 GRANT 任何角色；內部 `SELECT NOT (private_bsr.gate_classify(private_bsr.gate_state())).blocked`。
2. `CREATE OR REPLACE` 六支/八支 ingress+recovery（#1–#5、R1、R2；#6 legacy edge 不改 DB，於 S3B-D 前端層封死），每支：
   - 開頭 `IF NOT private_bsr.ingest_allowed() THEN RETURN <suppressed>; END IF;`（完全 schema-qualified）
   - `SET search_path = pg_catalog, public`（移除裸 public 風險）
   - 逐支註解說明維持 SECURITY DEFINER 的理由；**ACL 不變更**（不升權、不降權）
   - #1 在 suppressed 分支**不呼叫** R1/R2
3. 抑制回傳：#1 `{"skipped":"bsr_provider_unsupported","inserted":0}`；#2 同；#3 `RETURN NEW`（交易照常寫入）；#4 `{"eligible":true,"created":false,"status":"bsr_provider_unsupported"}`；#5 回 `0`；R1/R2 `{"skipped":"bsr_provider_unsupported","revived":0}`。

**Allowlist**
```
supabase/migrations/<ts>_bsr_ingest_suppression_gate.sql
```
**Acceptance**：S3B-0 的 suppression / ACL 測試轉 GREEN；`pg_proc` readback 顯示 8 支 proconfig 皆 `search_path=pg_catalog, public`、ACL 與部署前逐項相同；config version 仍 v7、queue hash 仍 `73c0df1e…`。
**Stop**：任一支 ACL 改變、或 config/queue 被動到 → 立即 rollback。
**Semantic rollback**：migration 內附部署前 8 支的 exact `CREATE OR REPLACE`（含原 proconfig 與原 ACL 還原語句），逐支還原。

---

## Stage S3B-B — 自然週期觀察（不 mutation）

**Actions**：等待一個 cron 106 週期（`2 * * * *`，純 SQL、**無 request_id / 無 edge run_id**，只取 `job_run_details.runid`）＋ 一個 worker 週期（46/51/98/107 → runid → request_id → HTTP → edge run_id → body）。
**Acceptance**：106 回 `skipped:bsr_provider_unsupported`、inserted=0、revived=0；queue counts 與 hash 完全不變；worker `claimed=0 / provider_calls=0`；provider counters（`finmind_quota_pools.used_today`、`finmind_quota_ledger`、`tw_bsr_api_usage`）不變。
**Stop**：inserted>0 或 revived>0 或 provider_calls>0 → 執行 S3B-A rollback，不進 C。
**Rollback**：同 S3B-A。

---

## Stage S3B-C — 顯式宣告 availability truth（config v7→v8）

**Actions**：以既有 `public.bsr_block_and_terminalize_claims(p_run_id, '{}'::bigint[], '{}'::timestamptz[], '{}'::int[], 'finmind_provider_unsupported_plan', <sanitized evidence>)` 執行（空 claim 陣列 → 0 queue 列變動；內部 `FOR UPDATE` 鎖 gate 列 → 併發安全；已 blocked 則回 `already_blocked` → 冪等）。
- config 新增鍵：`admission_blocked=true`、`admission_reason='provider_unsupported_plan'`、`admission_terminal_code='finmind_provider_unsupported_plan'`、`admission_blocked_at`、`admission_run_id`、`admission_nonce`、`admission_evidence`。
- **evidence 只含**：`{stage:'stage2', http_status:400, provider_code:'provider_unsupported_plan', dataset:'TaiwanStockTradingDailyReport', probe_symbol:'3017', probe_date:'2026-08-21', observed_at:<migration execution time, now()>}`。**不放 token、不放原始 provider body、不放 URL**；`private_bsr.assert_sanitized` 再擋一次。`observed_at` 使用 migration 執行時間（不使用模糊的 03:0xZ）。
- migration 內附「未來恢復 runbook」註解：`bsr_unblock_after_probe` + §0.2 的 skipped→pending UPDATE。

worker 46/51/98/107 之後的 exact body：
```json
{"ok":true,"mode":"worker","run_id":"<uuid>","decision":"blocked",
 "reason":"provider_unsupported_plan","terminal_code":"finmind_provider_unsupported_plan",
 "gate_version":8,"claimed":0,"processed":0,"provider_calls":0}
```

**Allowlist**
```
supabase/migrations/<ts>_bsr_admission_declare_provider_unsupported_plan.sql
supabase/tests/bsr_availability_truth_test.sql
```
**Acceptance**：config version 8、`admission_reason='provider_unsupported_plan'`；worker body 不再出現 `legacy_config_missing`；再觀察一個 106 + 一個 worker，inserted/revived/claimed/provider_calls 全 0；queue hash 不變。
**Stop**：body 未變、或 queue/provider counters 變動 → 立即語意 rollback。
**Semantic rollback（非 exact inverse，明確標示）**：
```sql
UPDATE public.tw_bsr_sync_config
   SET config = config - 'admission_blocked' - 'admission_reason' - 'admission_terminal_code'
                       - 'admission_blocked_at' - 'admission_run_id' - 'admission_nonce'
                       - 'admission_evidence',
       version = version + 1   -- 單調遞增，結果為 v9，語意等同 v7 的 fail-closed
 WHERE key = 'market_batch';
```
`audit_logs` 與 `tw_bsr_degrade_events` 為 append-only：**保留原紀錄並追加一筆 rollback audit**，不刪除、不回寫 Stage 2 原始 provider body。

---

## Stage S3B-D — 前端 honest downgrade（Preview only）

**資料契約**（全部使用 §0.5 既有欄位，無新增）
- 「最後可用日」= `bsr_as_of ?? bsr_source_date`，null 時顯示「無可用資料」而非日期。
- 狀態一律由 `bsr_provider_state` 映射，前端不重判、不推測。

**持股 quantity / cost 契約**
- 唯一來源：使用者自己的 `checkup_storage` key=`pf-holdings-v2` → holding 物件 `h.qty` / `h.cost`（`HoldingCard.tsx:88-95`）。
- 行情 null → `price` 為 null → **市值／損益顯示「—」**（不是 0）；`h.qty` **絕不** fallback 0。
- **使用者真的持有 0 股**（`h.qty === 0`，已全數出清）→ 正常顯示 0 股，不得誤判為錯誤／缺資料狀態。這兩種情況各一條測試。
- desktop render path：`HoldingsTab.tsx` → `HoldingsWorkbench.tsx` → `HoldingCard.tsx`；mobile 同一組件樹（RWD 由 `holdingsTab.css` 與 `_ui` 控制），抽屜為 `HoldingsDetailPanel.tsx` → `ChipsSection.tsx`。

**Actions**
| 位置 | 檔案 | 改法 |
|---|---|---|
| 抽屜 BSR 分段 | `chipsFreshnessSegments.ts`、`ChipsSection.tsx` | terminal 時顯示「資料來源目前不支援更新 · 最後可用 YYYY/MM/DD」，法人分段照常顯示 `as_of` |
| 文案 | `bsrHeaderLabel.ts` | `terminal_provider_rejected` 分支附最後可用日；移除任何「已排入／自動重試」字樣 |
| 自動回補 | `useChipsLifecycle.ts`、`useChipsAutoBackfill.ts`、`useChipsBackfill.ts` | terminal 時不呼叫 `enqueue_bsr_backfill`、不進 timeout 計時、無無限 loading；**法人 lane（`tw-institutional-daily-sync`）保留** |
| 手動按鈕 | `ChipsSection.tsx` | terminal 時 disabled + 說明；0 provider call |
| legacy 入口 #6 | `chipsRepository.ts` | 確認預設不可達；terminal 時不走 `CHIPS_FN_LEGACY` |
| 看板（未開抽屜） | `HoldingsTab.tsx` | 顯示法人/價格新鮮度；BSR 標「資料來源目前不支援更新」 |

Query keys 不變（`chipsQueryKey` / `stampQueryKey`）。
**Allowlist**
```
src/checkup/components/freecheckup/bsrHeaderLabel.ts
src/checkup/components/freecheckup/chipsFreshnessSegments.ts
src/checkup/components/freecheckup/ChipsSection.tsx
src/checkup/components/freecheckup/HoldingsTab.tsx
src/checkup/hooks/useChipsLifecycle.ts
src/checkup/hooks/useChipsAutoBackfill.ts
src/checkup/hooks/useChipsBackfill.ts
src/checkup/lib/chipsRepository.ts
src/test/unit/bsr-canonical-code-mapping.test.ts
src/test/unit/holdings-quantity-never-zero-fallback.test.ts
src/test/unit/bsr-terminal-no-backfill.test.tsx
e2e/holdings-bsr-unavailable.spec.ts
```
**Acceptance**：targeted + full vitest、`tsgo`、build、FreeCheckup 手機回歸清單（390/380/560）＋ desktop 截圖全 GREEN。
**Stop**：任何 provider call 或 enqueue 在 terminal 狀態被觸發 → 停。
**Rollback**：git revert 本批檔案；**不需 Publish**（Preview only）。

---

## Stage S3B-E — backlog 最小處理（**只動 pending**）

**Actions**（在 A/B/C 全綠後）
```sql
UPDATE public.tw_bsr_sync_queue
   SET status='skipped',
       last_error='finmind_provider_unsupported_plan',
       finished_at=now(), updated_at=now()
 WHERE status='pending';
```
- **`failed=1572` 完全不動**（recovery R1/R2 已在 S3B-A early-return，不會復活）。
- 排除 `running`（WHERE 只選 pending）。
- 預估 affected rows ≈ **548**（以執行當下重讀為準；偏差 >5% 立即中止）。
- **證據只記錄匿名化資訊**：`count(*)`、`md5(string_agg(id::text,','))`、狀態分佈；**不匯出、不保存 raw `last_error`**（避免複製含 token 尾碼的字串）。
**Allowlist**
```
supabase/migrations/<ts>_bsr_queue_terminalize_pending_only.sql
```
**Acceptance**：pending=0；failed 仍 1572 且其 `last_error` **逐字未變**（以 hash 比對，不輸出內容）；`done` 不變；下一個 106 週期 inserted=0。
**Stop**：affected rows 偏差 >5%、或 failed/running 被動到 → 中止。
**Semantic rollback**：預先只保存受影響 **pending** 列的 `id` 清單（pending 的 last_error 多為 NULL 或 `quota_deferred`，rollback 以固定值還原，不重建任何敏感字串）：
```sql
UPDATE public.tw_bsr_sync_queue SET status='pending', last_error=NULL, finished_at=NULL, updated_at=now()
 WHERE id = ANY(<saved ids>) AND status='skipped';
```

---

## Stage S3B-V — 全體使用者 row-level 驗收（read-only）

以 service_role 執行、匿名化（僅 `user_ref = left(sha256(user_id),8)`，不得曝露 user_id）：
1. `checkup_prefetch_universe()` 取 **至少 2 位真實使用者**，各 1 個**不在** `INIT_HOLDINGS` 與 `chips_prefetch_targets` 的 symbol，列 `sources`（需含 `checkup_storage` 或 `trade_records`）。
2. 各 symbol 的各 lane max date：`tw_institutional_daily`、OHLCV/`daily_price_snapshots`、`current_prices`、`tw_bsr_daily`。
3. 未開抽屜時法人/OHLCV/價格排程照常（對應 cron + 最近 run）。
**拿不到 row-level 證據 → 誠實標 PARTIAL**（同時仍是 Stage 1 兩角色 RLS 缺口的解法）。

---

## Preview 最終驗收
- 20 檔 INIT_HOLDINGS + 至少 1 位其他真實使用者，**先不開抽屜**：qty 為真實值（含真 0 股情境正確顯示）、缺價顯示「—」、法人/OHLCV/價格日期可見、BSR 顯示「資料來源目前不支援更新 · 最後可用 <查詢值>」。
- 之後開抽屜：queue counts/hash、config version、provider counters 全部不變。
- 證據鏈：cron 106 → runid（誠實標無 request_id / 無 edge run_id）；worker → runid → request_id → HTTP → edge run_id → body。

## Publish 授權
S3B-0/A/B/C/E 為純後端，**不需 Publish**。S3B-D 為 Preview only；**若要進 production UI，必須另經你明確授權 Publish**。

## Security follow-up（本輪不做，需另立）
1. `tw_bsr_sync_queue.last_error` 既有含 token 尾碼字串的清理。
2. `claim_bsr_queue_jobs` GRANT 給 anon/authenticated（INVOKER）、`ensure_bsr_queued` / `enqueue_bsr_first_fetch_on_trade` GRANT 給 PUBLIC 的 ACL 收斂。
3. `exec_count` known debt（維持 debt=1，不順手修）。

## 風險矩陣
| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| ingress 改寫時漏一支 → unguarded 時間窗 | 中 | 高 | 8 支同一 migration 原子部署；suppression 測試逐支斷言 |
| 跨 schema 呼叫 search_path 誤用 | 中 | 高 | 全 schema-qualify + proconfig readback 斷言 |
| helper 意外升權暴露 | 低 | 高 | 不建 public 函式；ACL 測試斷言零 GRANT |
| skipped 佔 uniqueness 造成永久鎖死 | 中 | 中 | §0.2 恢復 runbook + 測試斷言 |
| backlog 動到 failed / running | 低 | 中 | WHERE 僅 pending；偏差 >5% 中止 |
| 前端把缺價顯示成 0 股 | 中 | 高 | 兩條專屬測試（null 價格 / 真 0 股）＋雙裝置截圖 |
| 敏感字串外洩到 artifact | 中 | 高 | 只記 count/hash/id，不匯出 raw last_error |
