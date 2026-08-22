# Stage 3B — Honest Downgrade（BSR 分點永久不可用）

判定沿用 Stage 2：`B = provider_unsupported_plan`（單股 `TaiwanStockTradingDailyReport` 與 market_batch 皆 HTTP 400 `Your level is register`）。本階段不升級方案、不換來源、不造假資料，只做「誠實降級 + 停止無效排隊」，並確保**未開抽屜時持倉看板仍自行取得法人／OHLCV／價格最新資料**。

---

## 0. 唯讀稽核結論（本輪已逐項確認）

**排程（cron.job）**
| jobid | name | schedule | command | 目前結果 |
|---|---|---|---|---|
| 46 | tw-bsr-worker-trading | `*/10 6-12 * * 1-5` | `cron_edge_call('tw-bsr-finmind-sync', {mode:worker,batch:30,max_priority:3})` | gate blocked |
| 51 | tw-bsr-worker-tier1-catchup | `*/15 6-12 * * 1-5` | 同上 `max_priority:1, ignore_window:true` | gate blocked |
| 98 | tw-bsr-worker-weekend | `*/10 * * * 6,0` | 同上 `max_priority:3, ignore_window:true` | gate blocked |
| 107 | tw-bsr-worker-hourly | `7 * * * *` | 同上 | gate blocked |
| 106 | chips-prefetch-enqueue-hourly | `2 * * * *` | `SELECT public.enqueue_chips_prefetch_gaps(10,300)` | **純 SQL，無 request_id / edge run_id** |

**Availability 現況（真實原因不對）**
- `private_bsr.gate_state()` 讀 `public.tw_bsr_sync_config.key='market_batch'`（v7）。
- `private_bsr.gate_classify()` 因 `config->'admission_blocked'` **鍵不存在**，回 `blocked=true, reason='legacy_config_missing'`。
- 亦即目前是「因為設定殘缺而擋住」，不是「因為已證實 provider 不支援」。Stage 3B 必須把它換成 deterministic 的 `provider_plan_rejected`。

**BSR 入列入口（全列）**
| # | 入口 | 位置 | 觸發 | 目前是否讀 availability |
|---|---|---|---|---|
| 1 | `enqueue_chips_prefetch_gaps(10,300)` | DB function（SECURITY DEFINER, search_path=public） | cron 106 每小時 | 否 |
| 2 | `enqueue_all_active_tw_holdings_bsr(p_lookback_days)` | DB function | 手動／ops | 否 |
| 3 | `enqueue_bsr_first_fetch_on_trade()` | `trade_records` AFTER INSERT trigger | 新增交易 | 否 |
| 4 | `ensure_bsr_queued(p_stock_id)` | DB function | 舊 lazy 路徑 | 否 |
| 5 | `enqueue_bsr_backfill(p_stock_id,p_days)` | DB RPC，由 `useChipsBackfill.ts:70-76`（gateway.rpc）呼叫 | 抽屜「回補歷史」＋ `useChipsAutoBackfill` 自動觸發 | 否 |
| 6 | `tw-chips-detail`（legacy edge，含 write/rebuild/enqueue） | `chipsRepository.ts:305 CHIPS_FN_LEGACY` | 僅 `VITE_CHIPS_ENDPOINT` 覆寫時 | 否（預設已切 v2 read-only） |

`useChipsAutoBackfill.ts` + `useChipsLifecycle.ts:102-116`：sparse 即觸發 `requestBackfill()`，同時 `tw-institutional-daily-sync`（獨立車道，要保留）與 `enqueue_bsr_backfill`（要抑制）並行送出。

**Queue 現況（本輪實測）**
- total 10552：done 8432 / failed 1572 / pending 548；hash（全表）`73c0df1e3a38f4c8f81e49e0e8b65346`，pending+failed 子集 hash `c525fd99b4287c21ae17e21b16934df6`，trade_date 範圍 2026-04-06 ~ 2026-08-21。
- 分佈：`failed:finmind_admission_daily_exhausted:pool=keepwarm` 1237、`pending:(null)` 471、`failed:rate_limited:keepwarm` 234、`pending:quota_deferred` 75、`failed:daily_exhausted:interactive` 52、`failed:finmind_http_400 …` 49、`pending:finmind_http_400 …` 2。
- **安全發現**：現存 `last_error` 內含 `token_tail` 尾碼字串。終局化時必須覆寫成白名單 terminal code，順帶清掉這個外洩面（只改本次 WHERE 命中的列）。
- 狀態機：`status ∈ pending|running|done|failed|skipped`；`claim_bsr_queue_jobs()` **只選 `status='pending'`** → `skipped` 是現成的安全 terminal，不需改 schema。
- 但 `enqueue_chips_prefetch_gaps` 內部會呼叫 `recover_stale_bsr_queue_jobs()` 與 `recover_quota_failed_bsr_jobs()`，會把 failed 復活成 pending → **必須同一輪讓這兩支也讀 availability**，否則 failed 會被 retry。

**跨使用者 universe（不需開抽屜）**
`checkup_prefetch_universe()`（STABLE SECURITY DEFINER）以 server-side 聯集：`trade_records` ∪ 已發佈 `expert_signals` ∪ **每位會員自己的 `checkup_storage.data`（key='pf-holdings-v2'）** ∪ `chips_prefetch_targets`。sandbox 角色無 EXECUTE 權（`permission denied`），故 row-level 兩位使用者證據**留待 Stage 3B-V 以 service_role 取得**，在那之前此項標 PARTIAL。

**資料車道現況**：`tw_bsr_daily` max = **2026-08-14**（3,679,883 rows）；`tw_institutional_daily` max = **2026-08-21**；OHLCV／價格車道獨立、不受本計畫變更影響。

---

## 1. 單一 server-side availability truth

**選擇：versioned config mutation（不新增狀態表、不新增第二真相）**，理由是 gate 已是 worker 唯一判準，新增表就是第二真相。

- 執行方式：一次性 migration 內呼叫**既有** `public.bsr_block_and_terminalize_claims(p_run_id, '{}'::bigint[], '{}'::timestamptz[], '{}'::int[], 'finmind_admission_provider_plan_rejected', <sanitized evidence>)`。
  - 空 claim 陣列 → **0 queue 列變動**（該支只 UPDATE `q.status='running'` 且 lease 配對成功的列）。
  - 原子性：`SELECT … FOR UPDATE` 鎖 gate 列後才分類 → 併發安全。
  - 冪等：已 blocked 回 `already_blocked`、不再 bump version、不重複寫 audit。
  - 版本：`tw_bsr_sync_config.market_batch` v7 → **v8**，並寫入 `admission_blocked=true`、`admission_reason='provider_plan_rejected'`、`admission_terminal_code`、`admission_blocked_at`、`admission_nonce`、`admission_evidence`。
  - 稽核：自動寫 `audit_logs('bsr_admission_blocked')` 與 `tw_bsr_degrade_events`。
- **evidence 只放**：`{stage:'stage2', http_status:400, provider_code:'provider_plan_rejected', dataset:'TaiwanStockTradingDailyReport', probe_symbol:'3017', probe_date:'2026-08-21', observed_at:'2026-08-22T03:0xZ'}`。不放 token、不放原始 body、不放 URL；`private_bsr.assert_sanitized` 會再擋一次。
- `legacy_config_missing` 從此不再是正式狀態：`admission_blocked` 鍵存在後永不再落入該分支；並在 Stage 3B-2 對 `gate_classify` 加一條測試斷言（不改函式邏輯）。
- ACL 不變：三支 wrapper 仍 service_role only，PUBLIC/anon/authenticated 全 REVOKE；migration 以 owner(postgres) 身分執行。
- **Rollback**：`UPDATE tw_bsr_sync_config SET config = config - 'admission_blocked' - 'admission_reason' - 'admission_terminal_code' - 'admission_blocked_at' - 'admission_evidence' - 'admission_run_id' - 'admission_nonce', version = version + 1 WHERE key='market_batch';`（回到 v7 語意 = legacy_config_missing，仍 fail-closed）。正向復原路徑另有既有 `bsr_unblock_after_probe`（需 server probe 成功），本輪不使用。

**worker 46/51/98/107 變更後 exact body**（`tw-bsr-finmind-sync` mode=worker）：
```json
{"ok":true,"mode":"worker","run_id":"<uuid>","decision":"blocked",
 "reason":"provider_plan_rejected","terminal_code":"finmind_admission_provider_plan_rejected",
 "gate_version":8,"claimed":0,"processed":0,"provider_calls":0}
```
（今日觀測到的 `reason:"legacy_config_missing"` 消失；HTTP 仍 200，`claimed=0 / provider_calls=0` 不變。）

---

## 2. 入列抑制（每個入口都讀同一真相）

新增**唯一**讀取器 `public.bsr_ingest_allowed()`（STABLE、SECURITY DEFINER、`search_path=pg_catalog,private_bsr`），內部只呼叫 `private_bsr.gate_classify(private_bsr.gate_state())`，回 `boolean`。ACL：`REVOKE ALL FROM PUBLIC, anon, authenticated`，只 GRANT service_role；其餘 DB function 因同 owner 可呼叫。

改寫（各自最小 early-return，不動其他邏輯）：
| 入口 | 抑制後回傳 |
|---|---|
| `enqueue_chips_prefetch_gaps` | `{"skipped":"bsr_provider_unsupported","reason":"provider_plan_rejected","inserted":0}`（仍**不**呼叫 recovery） |
| `enqueue_all_active_tw_holdings_bsr` | `{"skipped":"bsr_provider_unsupported","inserted":0}` |
| `enqueue_bsr_first_fetch_on_trade` | `RETURN NEW`（交易照常寫入，0 job） |
| `ensure_bsr_queued` | `{"eligible":true,"created":false,"status":"provider_unsupported"}` |
| `enqueue_bsr_backfill` | 回 `0`，並附 `suppressed_reason`（保持既有回傳型別相容） |
| `recover_stale_bsr_queue_jobs` / `recover_quota_failed_bsr_jobs` | `{"skipped":"bsr_provider_unsupported"}`，0 列復活 |

不觸碰：`tw-institutional-daily-sync`、OHLCV/`daily_price_snapshots`、`current_prices`、fx、其他 dataset 或 job 類型。

前端可讀的公開面：**不新增 public RPC**，沿用 `tw-chips-detail-v2` payload 既有欄位 `bsr_provider_state='terminal_provider_rejected'` / `bsr_provider_code='provider_plan_rejected'` / `bsr_retry_promised=false`，避免第二真相。

---

## 3. 既有 pending=548 / failed=1572 的最小終局化

- 不 DELETE、不改 schema（`skipped` 已是安全 terminal，`claim_bsr_queue_jobs` 不選它）。
- 精確 WHERE（單一 migration、單一 statement）：
```sql
UPDATE public.tw_bsr_sync_queue
   SET status = 'skipped',
       last_error = 'finmind_admission_provider_plan_rejected',
       finished_at = now(), updated_at = now()
 WHERE status IN ('pending','failed');
```
  - 預估 affected rows = **2120**（548 + 1572，以執行當下重讀為準；差異 > 5% 立即中止）。
  - before hash（pending+failed 子集）`c525fd99b4287c21ae17e21b16934df6`；全表 hash `73c0df1e3a38f4c8f81e49e0e8b65346`。after 另存。
  - 不動 `running`（避免搶 lease）、不動 `done`。
  - 唯一索引 `tw_bsr_sync_queue_active_uniq` 的 partial 集合已含 `skipped`，pending/failed → skipped 不會衝突（同 (stock_id,trade_date) 本來就只能有一列在該集合中）。
- Inverse rollback：migration 前先建 `db/r1/c/S3B/queue_before.csv`（id,status,last_error,finished_at），rollback 以 `UPDATE … FROM (VALUES …)` 逐列還原原 status/last_error/finished_at。
- 必須在 §2 抑制上線後才執行，否則 106 會立刻補回 pending。

---

## 4. 前端資料契約（未開抽屜也要有真實資料）

**絕對禁止**：任何 BSR/行情缺漏改寫持股數量或成本。持股永遠只來自使用者自己的 `checkup_storage.data`（`pf-holdings-v2`）／既有持倉來源；缺價只影響「市值/損益」顯示為 `—`，不得顯示 0 股。

| 位置 | 檔案 | 改法 |
|---|---|---|
| 看板（未開抽屜） | `HoldingsTab.tsx` / `HoldingsWorkbench.tsx` + `useChipsBatch.ts`（單次 POST 批次） | 讀批次 payload 的 `bsr_provider_state` 與各 lane 日期，卡片列顯示法人/價格新鮮度；BSR 標記「資料來源目前不支援更新」 |
| 抽屜 | `HoldingsDetailPanel.tsx` → `ChipsSection.tsx`（`chips-freshness-segments`） | BSR 分段顯示「資料來源目前不支援更新 · 最後可用 YYYY/MM/DD」，日期取自 payload `bsr_as_of` / `bsr_source_date`（**查出來的**，不硬編碼 2026-08-14） |
| 文案來源 | `bsrHeaderLabel.ts` | `terminal_provider_rejected` 分支已存在，改為附「最後可用日」，並保證不出現「已排入／自動重試」 |
| 自動回補 | `useChipsLifecycle.ts:102`、`useChipsAutoBackfill.ts`、`useChipsBackfill.ts` | provider terminal 時 **不觸發** `enqueue_bsr_backfill`（法人 lane 保留），phase 直接落 `suppressed`，不進 30 分鐘 timeout 計時、無無限 loading |
| 手動按鈕 | `ChipsSection.tsx` 回補按鈕 | terminal 時 disabled + 說明；點擊 0 provider call |

Query keys 不變（`chipsQueryKey(code)`、`stampQueryKey(code)`），避免快取污染；狀態映射一律 `payload.bsr_provider_state` → UI，前端不重判。RWD：桌機（≥768）與手機（390/380/560）皆需截圖，套用既有 FreeCheckup 手機回歸清單。

---

## 5. 全體使用者證據（Stage 3B-V，read-only）

以 service_role 執行並匿名化（僅列 `user_ref=sha256(user_id)[0:8]`，不得曝露 user_id）：
1. `checkup_prefetch_universe()` 取至少 2 位真實使用者、各 1 個**不在** `INIT_HOLDINGS` 與 `chips_prefetch_targets` 的 symbol，列 `sources`（需含 `checkup_storage` 或 `trade_records`）。
2. 每個 symbol 列各 lane max date：`tw_institutional_daily`、OHLCV/`daily_price_snapshots`、`current_prices`、`tw_bsr_daily`。
3. 證明未開抽屜時法人/OHLCV/價格排程照常（對應 cron 與最近 run）。
無 row-level 證據 → 本項維持 **PARTIAL**（同時解 Stage 1 遺留的兩角色 RLS 缺口）。

---

## 6. 測試（先 RED 後 GREEN）

- DB contract（`supabase/tests/`）：gate 回 `provider_plan_rejected` 且非 `legacy_config_missing`；`bsr_ingest_allowed` ACL（anon/authenticated 無 EXECUTE）；六個入列入口在 blocked 時 inserted=0；`claim_bsr_queue_jobs` 不選 `skipped`；recovery 兩支 0 復活。
- unit/integration（vitest）：`bsrHeaderLabel` terminal 文案含最後可用日、`useChipsAutoBackfill` terminal 不呼叫 requestBackfill、持股數量不因缺價變 0、`chipsFreshnessSegments` 分段語意。
- targeted → full vitest、`tsgo`、build、security scan、schema diff。
- E2E（Playwright）：不開抽屜 → 看板顯示真實持股與法人/價格日期；開抽屜 → BSR unavailable 且 queue/config/provider counters 不變。

---

## 7. Rollout（分段，每段有 stop gate）

| 段 | 內容 | 觀察 | Stop / Rollback |
|---|---|---|---|
| S3B-1 | gate config v7→v8（0 queue 變動） | 一個自然 worker 週期（46/51/98/107 任一）＋ 一個 106 週期 | body 未出現 `provider_plan_rejected`、或 `claimed>0`／`provider_calls>0`／queue hash 改變 → 立即跑 §1 rollback SQL |
| S3B-2 | 入列抑制 migration（含 recovery 兩支） | 一個 106 週期：`inserted=0`、queue hash 不變 | 任何 inserted>0 → 還原前一版函式定義（migration 內附 exact CREATE OR REPLACE 舊版） |
| S3B-3 | 既有 pending/failed → skipped | affected rows 與預估比對、after hash | 差異 >5% 或 running 被動到 → 用 `queue_before.csv` 逐列還原 |
| S3B-4 | 前端 honest downgrade（Preview only，不 Publish） | Preview 驗收 §8 | 前端 revert = git revert 該批 changed files |

S3B-1~3 皆不需要 Publish（純後端）。**S3B-4 若要進 production UI，必須另經你明確授權 Publish。**

---

## 8. 最終 Preview 驗收

- 20 檔 INIT_HOLDINGS + 至少 1 位其他真實使用者，**先不開抽屜**：持股數量非假 0、法人/OHLCV/價格日期可見、BSR 顯示「資料來源目前不支援更新 · 最後可用 2026/08/14（查詢值）」。
- 之後開抽屜：queue counts/hash、config version、provider counters（`finmind_quota_pools.used_today`、`finmind_quota_ledger`、`tw_bsr_api_usage`）全部不變。
- 附證據鏈：cron 106 → runid（**純 SQL job，誠實標無 request_id / 無 edge run_id**）；worker 46/51/98/107 → runid → request_id → HTTP → edge run_id → body。

---

## 9. Changed-files allowlist

```
supabase/migrations/<ts>_bsr_admission_terminalize_provider_plan_rejected.sql   # S3B-1
supabase/migrations/<ts>_bsr_ingest_suppression_gate.sql                        # S3B-2
supabase/migrations/<ts>_bsr_queue_terminalize_backlog.sql                      # S3B-3
supabase/tests/bsr_availability_truth_test.sql
supabase/tests/bsr_ingest_suppression_test.sql
src/checkup/components/freecheckup/bsrHeaderLabel.ts
src/checkup/components/freecheckup/chipsFreshnessSegments.ts
src/checkup/components/freecheckup/ChipsSection.tsx
src/checkup/components/freecheckup/HoldingsTab.tsx
src/checkup/hooks/useChipsBackfill.ts
src/checkup/hooks/useChipsLifecycle.ts
src/checkup/hooks/useChipsAutoBackfill.ts
src/test/unit/*（對應新測試）
e2e/holdings-bsr-unavailable.spec.ts
db/r1/c/S3B/*（證據 artifacts）
docs/bsr/stage3b-receipt.md
```
不碰：`exec_count` / `backfill-daily-snapshots`、週記與其他頁面、法人/OHLCV/價格車道、`expert_signals` RLS。

## 10. 風險矩陣

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| gate mutation 誤動 queue | 低 | 中 | 空 claim 陣列＋前後 hash 比對 |
| 抑制過寬，誤停法人/OHLCV | 低 | 高 | 抑制只加在 6 個 BSR 入列函式；法人 lane 有獨立測試 |
| 終局化把 running 誤標 | 低 | 中 | WHERE 排除 running；before CSV 可逐列還原 |
| 前端誤把缺價顯示成 0 股 | 中 | 高 | 專屬 unit test + Preview 兩裝置截圖 |
| 未來方案升級後 gate 卡住 | 低 | 低 | 既有 `bsr_unblock_after_probe`（需 server probe 成功）為正向復原路徑 |
