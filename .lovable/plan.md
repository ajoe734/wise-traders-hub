# Staged Cutover + 原始資料新鮮度驗收計畫（S0–S6）

Plan only。本文件不執行任何 production mutation / deploy / Publish。
不可變條件：6515（穎崴）維持 `manual_review` / `incomplete`、數字 withheld；26 drift 不判定；
不刪重建 production；不長鎖；不做單一大 transaction；前端不 Publish。
每個 stage 需前一 stage 全綠證據才可執行；任一紅燈立即停止並 rollback，不自動續行。

## 唯讀預查已確認的現況（本輪實際讀取）

| 項目 | 實測值 | 來源 |
|---|---|---|
| repo migrations | 418 檔，最新 `20260816143339_9eb4c539…` | `ls supabase/migrations` |
| Edge functions | 131 個資料夾 | `ls supabase/functions` |
| cron 全表 | 60+ 個 active job（jobid 1…107） | `cron.job` |
| 全市場慢速 sweep | `chips-prefetch-enqueue-hourly`(106, `2 * * * *`)、`tw-bsr-worker-hourly`(107, `7 * * * *`)**存在且 active**，48h 內各 48 runs、pg_cron status 全 `succeeded`、0 failed | `cron.job_run_details` |
| BSR 覆蓋 | `tw_bsr_daily` 最新 `2026-08-14`，該日僅 **65 檔**；`tw_chips_rollup` 39,833 列 | 唯讀查詢 |
| 佇列 / 目標 | `tw_bsr_sync_queue` 11,605 列（pending 75）、`chips_prefetch_targets` 20 列、open trades 21、experts 12 | 唯讀查詢 |
| coverage 表欄位 | `bsr_coverage_daily(stock_id,trade_date,broker_count,broker_sum_shares,snapshot_volume_shares,coverage_pct,coverage_class,computed_at)` | information_schema |

未知（**不得假設**，S0 必須實測）：PITR/備份可回復點是否真的可用；Edge functions 各版本號與部署時間；
`cron_edge_call` 是否真的收到 2xx（pg_cron `succeeded` 只證明 SQL 呼叫成功，**不證明 worker 有做事**）；
production 目前是否有 long tx / blocking locks；R1_P_STATUS 標「11 experts」但 `experts` 表為 12（差異需先解釋）。

## Old/New client compatibility matrix（S1 前必須先簽核）

| 階段 | 已發布舊前端（live） | Unpublished Preview 新前端 | 舊 Edge writer | 新 writer/ledger |
|---|---|---|---|---|
| S0 | 正常（現況） | 正常 | 正常 | 未啟用 |
| S1 expand | 正常（新欄位/表只新增，不改語意） | 正常 | 正常 | dual-write off |
| S2 cutover | 正常或 fail-closed（讀不到 projection → 不顯示數字） | 正常 | 經 compat wrapper | 唯一經濟寫入者 |
| S3 projection | 舊前端讀 legacy path，**no_projection 一律 fail-closed，不得把 legacy 數字當 ready** | 顯示 ready / 檢核中 | — | — |
| S4 E2E | 不變 | 真資料驗收 | — | — |

---

## S0 read-only preflight（owner: agent + user 決策；估 90 min）

1. `supabase--read_query` 取 `pg_stat_activity`（`state<>'idle'`、`xact_start < now()-'60s'`）→ expect 0 long tx；`pg_locks` join → expect 0 blocking。
2. `select * from supabase_migrations.schema_migrations order by version desc limit 20` 對比 repo 418 檔 → expect remote 與 repo 完全對齊；任何 remote-only/repo-only 版本＝**BLOCKER**。
3. `bash db/r1/p/093_prod_acl_baseline.sh` → expect `named=3 / pattern=25 / 28 unique / 37 canonical keys`、watchset sha `4b789a85…`、`FAILURES=0`。
4. Hash 基線：schema catalog hash、`app_ledger` pointer、11/12 experts × 84 keys × 26 drift、6515 stored=50 / replay=10（withheld）。全部落檔 `db/r1/c/S0/`。
5. 15 DB writers / 13 Edge writers / 23 triggers 清單（`db/r1/d/writer-inventory.json`）對 production 現況重新點名 → 數量不符即 BLOCKER。
6. cron 60+ jobs 快照、queue/coverage 快照、Edge deployment 版本清單（唯讀 API）。
7. Live site 與 Unpublished Preview smoke 基線（截圖 + console/network），作為每個 stage 的比較底片。
8. **備份/PITR 真實可用證據**：需要 user 提供或確認 PITR 視窗與最近一次可回復點。若無法證明可回復 → **BLOCKER，S1 不得開始**。

GO 條件：1–7 全綠且 8 有明確可回復點。Abort：任一 BLOCKER。Rollback：不需要（唯讀）。

## S1 expand / compat（估 2 h）

- 只做 additive DDL：`app_ledger` schema、projection 表、manifest seed（`db/r1/p/001_projection.sql`、`010_manifest_seed.sql`、`db/r1/d/001_compat.sql`），**不改任何歷史經濟資料**。
- 每個 statement 獨立小 transaction，開頭 `SET lock_timeout='3s'; SET statement_timeout='60s';`；禁止 table rewrite 型 ALTER（新欄位一律 nullable、無 volatile default）。預估鎖：僅 ACCESS EXCLUSIVE 毫秒級 metadata lock。
- read-back：新物件存在、既有表 relfilenode 未變（證明無 rewrite）、經濟資料 hash 與 S0 相同。
- 相容測試：舊 writer 寫入 → 舊前端讀取正常；新 writer 尚未啟用。
- Abort threshold：任一 statement 觸發 lock_timeout 或 read-back hash 漂移。
- Rollback：`db/r1/p/099_rollback_p.sql` + `db/r1/d/099_rollback.sql`，read-back 需回到 S0 hash（byte-identical）。

## S2 writer / ACL cutover（估 3 h）

順序：**先 DB（compat wrapper 可同時服務新舊呼叫）→ 再 Edge deploy**，因為舊 Edge 必須在新 DB 上仍可寫。
1. 套用 `db/r1/d/002_cutover.sql`（ledger_owner、trigger 路由）。
2. 套用 `db/r1/p/002_public_contract.sql`：28 functions / 37 canonical ACL keys 依 `acl-25.json` disposition（含 identity-bound wrapper 與 `*_raw` twin 封閉）。
3. 逐一 read-back：`095_acl25_verify.sql`（expect 65 / 0 fail）、`096_acl_dynamic_proof.sql`（185 / 0）、`094_rls_role_matrix.sql`（21 probes / 0）、RLS harness（16 / 0，min 15）。
4. canary writer：單一非 6515、非 drift 的 signal 走完整 pending→publish，驗 `effect_keys=1`、`economic_effects=1`（只 apply 一次）。
5. failure injection：中途失敗 → pointer 不移動（沿用 R1-D 的 pointer-held 斷言）。
6. Edge deploy：僅 13 個 economic writer functions，逐一部署後立即 curl 健康檢查。
- Abort：任一 verify 非 0 fail、canary 出現 double-apply、任何 6515 相關列被寫入。
- Rollback 且不遺失中間寫入：cutover 期間 ledger 為 append-only，回退只 revert trigger 路由與 ACL（`099_rollback.sql`），期間寫入的 ledger 列保留並可重放；read-back 比對 pointer 與 ledger 列數。

## S3 projection / public contract（估 2 h）

1. canary：先 build **1 位已證明 ready** 的 expert（不得選 6515 / drift 相關）→ pointer CAS 單語句 flip → 驗 ready 指標。
2. 全綠後才 build 其餘 experts（S0 需先解決 11 vs 12 的差異）。
3. 驗 T+7 embargo（`092_embargo.sh`，expect 27 / 0 fail，min 25）、anon 不可讀 raw `trade_records` / `user_performances` / `app_ledger`。
4. 6515 與 26 drift → `manual_review` / `incomplete`，只顯示「資料檢核中」文案，無數字/圖表/匯出。
5. no_projection 一律 fail-closed（29-case E2E ×3 + `preview_verify.py`）。
- Abort：出現 mixed-version read、任何 withheld key 被投影成數字、legacy 數字被當 ready。
- Rollback：pointer 回退到前一 `projection_version`（單語句、可逆），資料不刪。

## S4 real production E2E（真資料，仍不 Publish；估 3 h）

- 矩陣：3 身分（anon / authenticated / company_admin）× 2 對象（ready expert / Sharkgu 6515）× 2 viewport × 2 theme。
- 檢查面：card、chart、ranking、export、OG meta、cache header、console 0 error、network 無 4xx/5xx（預期的 401/403 需列白名單）。
- **禁止 interception**，全部真實 production data。
- Evidence：每案截圖 + HAR + console dump + sha256 清單。
- Abort：任何 withheld 數字外洩、任何身分越權讀到 raw 經濟資料。
- Disable switch：`system_kill_switches` 關閉 projection 讀取，退回 fail-closed。

## S5 原始 holding-checkup 資料新鮮度（估 4 h + 24 h 觀測）

**先唯讀追蹤鏈（不得用空 worker 綠燈交差）**：
`cron.job_run_details.runid`(106/107) → `cron_dispatch_log` / pg_net response → `edge_function_logs`(`chips-prefetch-enqueue`、`tw-bsr-finmind-sync` worker) → `tw_bsr_sync_queue` claim/checkpoint → `tw_bsr_attempt_logs` → `tw_bsr_daily` / `tw_chips_rollup` / `bsr_coverage_daily`。
必須證明「每小時緩慢全市場」是否**真的在做事**：現況 `2026-08-14` 只有 65 檔、queue 仍 11,605 列，pg_cron 綠燈但覆蓋率明顯偏低 —— 這是待證的核心疑點，非結論。

設計（實作前需再簽核）：
- 佇列分層：P0 = 所有使用者實際持股（由 `trade_records` open + `chips_prefetch_targets` 推導）；P1 = 全市場慢速 sweep（每小時固定配額）。drawer 開啟只讀 ready 資料，**不再首次 enqueue/backfill**。
- 邊界案例逐項驗收：任意帳號/任意股票、新增持股、週末/休市、歷史缺口補齊、FinMind rate limit、冪等鍵、重試/指數退避、死信佇列、備份與保留期、每日成本上限。
- 真實案例 ≥ 4 種：ready hit、stale、unknown（未曾抓過）、failed provider。
- Freshness SLO：交易日 P0 ≤ T+1 09:30(TPE) 可用；P1 全市場 ≤ 7 個交易日輪完；非交易日不計時。
- Coverage SQL：以 `bsr_coverage_daily` 依 `trade_date` 統計 `coverage_class` 分布 + P0 清單的 ready 比率，需連續 2 個交易日達標。
- Abort：FinMind quota 觸頂或 P0 ready 比率下降。Rollback：關閉新 enqueue cron，回舊 on-demand 路徑。

## S6 closeout（估 24 h 觀測 + 1 h）

- 監控 24 小時、且**至少跨兩個自然小時的 106/107 真實 cron run**（禁止手動觸發代替）。
- 全 app vitest ×3 0 fail、tsgo、production build、consumer/DB/backdoor scanner 全綠、background processes = 0。
- 文件與證據 hash 更新後自我對讀。
- 前端仍不 Publish。
- **交回使用者決定**：是否 Publish 前端；6515 的 10 或 50 人工定案；26 drift 是否逐筆裁決；S5 全市場 sweep 的成本上限。

## 執行順序一頁表

| # | Stage | 前置 | 主要產出 | GO 判準 | NO-GO 立即動作 |
|---|---|---|---|---|---|
| 1 | S0 preflight（唯讀） | — | baseline hashes / PITR 證據 | 全部快照完成且 PITR 可回復 | 停，回報 BLOCKER |
| 2 | S1 expand | S0 綠 | additive DDL | 無 rewrite、hash 未漂移 | `099_rollback_p` + `099_rollback` |
| 3 | S2 writer/ACL | S1 綠 | ledger 為唯一寫入者 | 095=65 / 096=185 / matrix=21 / RLS=16 / canary once | revert 路由與 ACL，保留 ledger |
| 4 | S3 projection | S2 綠 | canary→全部 experts | embargo 27/0、no_projection fail-closed | pointer 回退前版 |
| 5 | S4 real E2E | S3 綠 | 真資料證據包 | 0 洩漏、0 console error | kill switch 關閉 projection |
| 6 | S5 freshness | S4 綠 | P0/P1 佇列 + SLO | 連 2 交易日達標、4 案例齊全 | 關新 cron，回舊路徑 |
| 7 | S6 closeout | S5 綠 | 24h 監控 + 文件 | 全綠、background=0 | 保持 NO-GO |

每個 stage 的 GO/NO-GO checklist 即上表該列的「GO 判準」逐項打勾，缺一即 NO-GO。
