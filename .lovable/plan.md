# Staged Cutover + 原始資料新鮮度驗收計畫 v2（S0–S6）

Plan only。本輪僅請求核准 **S0（唯讀）**；S1/S2/S3/S5 各自另行送審，S4 併入對應 stage，S6 需自然 cron 觀測。
不可變：6515（穎崴）維持 manual_review/incomplete、數字 withheld；26 drift 不判定；不刪重建 production；
不長鎖；不做單一大 transaction；前端不 Publish。

## 本版修正的 v1 錯誤（逐條）

| # | v1 錯誤 | v2 修正 |
|---|---|---|
| 1 | 「repo-only migration = BLOCKER」 | 改為 lineage 判定：repo-only 允許（未部署），**remote-only 且無 repo 前綴/allowlist 對應 = BLOCKER** |
| 2 | PITR 丟給 user | 先唯讀取 backup tier/retention/restore point；無 PITR 則做 stage-specific 邏輯備份 + restore rehearsal |
| 3 | 共用 `099_rollback` 粗暴回退 | 每 stage 自帶 objects 清單 + 前版定義/hash + 獨立 rollback 與時間上限 |
| 4 | S2 canary 用「一筆 signal」未界定 | 禁止製造可見假交易；改 shadow/dry-run 或自然真寫入觀測 |
| 5 | 「11 experts」沿用 | 實測 **12 experts**，逐位分類（見 S3） |
| 6 | 假設 `system_kill_switches` 可用 | 已實測：4 個 key，`chips_keepwarm=false`（且此值可能就是空轉主因，待證） |
| 7 | P0 = `trade_records` | **錯**：`trade_records` 是專家交易。真正使用者持股在 `checkup_storage.key='pf-holdings-v2'`（38 列，RLS/使用者綁定）+ localStorage；改設計 privacy-safe demand registry |
| 8 | 「chips_prefetch_targets=20 → 全市場」 | 實測 20 列全為 `source='demo_seed'`，**不是需求來源也不是 universe** |
| 9 | 「pg_cron succeeded 即 worker 成功」 | 實測反證：106/107 各 48/48 綠，但 `tw_bsr_daily` 24h 新增 **0 列**、`tw_bsr_attempt_logs` 24h **0 筆** |
| 10 | SLO 只寫 T+1 09:30 / 七日 | 依資料種別拆 SLO，週末改為「補歷史 + backlog + 校驗 + 備份」而非不計時 |
| 11 | drawer rollback 回舊 on-demand | 改為 drawer 永不 enqueue；scheduler 失敗則 fail-closed/stale，由獨立 repair queue 處理 |

## 唯讀實測現況（本輪查得，作為計畫前提）

| 項目 | 實測 |
|---|---|
| repo migrations / Edge functions | 418 檔（最新 `20260816143339_9eb4c539…`）/ 131 個 |
| 全市場 sweep cron | `chips-prefetch-enqueue-hourly`(106, `2 * * * *`)、`tw-bsr-worker-hourly`(107, `7 * * * *`)，active，48h 各 48 runs 全 succeeded |
| **但實際產出** | `tw_bsr_daily` 24h 新增 0 列；`tw_bsr_attempt_logs` 24h 0 筆；107 每次執行僅 10–20 ms（fire-and-forget pg_net） |
| BSR 覆蓋 | 最新 `2026-08-14`：40,055 broker 列 / **65 檔**；`bsr_coverage_daily` 65 列；snapshot_status 1 列 |
| queue | 11,605 列 = done 9,956 / failed 1,574 / pending 75；unique symbols **2,084**；失敗涵蓋 941 檔 |
| 需求來源 | `chips_prefetch_targets` 20 列全 `demo_seed`（16 supported + 4 unsupported） |
| 使用者持股 | `checkup_storage` 39 users，`pf-holdings-v2` 38 列（jsonb，`user_id` 綁定） |
| 市場 master | `stock_names` 僅 74 列且 market 全為 `US` → **無台股 master universe** |
| kill switches | 4 個：`chips_all=true`、`chips_backfill=true`、`chips_interactive=true`、`chips_keepwarm=false` |
| experts | 12 位（見 S3 分類）；有 signal 者僅 5 位 |
| ACL 基線 | 28 functions / 37 canonical keys / watchset sha `4b789a85…`（pinned 相符） |

## Old/New client compatibility matrix

| 階段 | Published live 舊前端 `https://legendflow.tw` | Unpublished Preview 新前端 `https://id-preview--0f5bdae6-…lovable.app` | 舊 Edge writer | 新 ledger writer |
|---|---|---|---|---|
| S0 | 現況正常 | 現況正常 | 正常 | 未啟用 |
| S1 | 正常（僅 additive） | 正常 | 正常 | dual-write off |
| S2 | 正常（compat wrapper 吸收舊呼叫）；若 RPC 被收攏則回 403 → UI 必須顯示「資料檢核中」，**不得白屏/crash/顯示舊數字** | 正常 | 經 wrapper | 唯一經濟寫入者 |
| S3 | legacy 讀取路徑；`no_projection` 一律 fail-closed | ready/檢核中 分流 | — | — |
| S4 | 真資料驗收（獨立 URL） | 真資料驗收（獨立 URL） | — | — |

---

# S0 read-only preflight（唯讀；本輪唯一請求核准項；估 2 h）

**S0-1 migration lineage（本輪已用唯讀查詢做完，結論如下，S0 執行時只需重跑同一組查詢確認未再漂移）**

比對規則不可只做字串集合差：production 的 `schema_migrations.version` 對舊檔比 repo 檔名早 2–3 秒，新檔則以 `name = <repoVersion>_<uuid>` 記錄。正式規則為
`key = case when name ~ '^[0-9]{14}_' then split_part(name,'_',1) else version end`，再對 repo 檔名前綴做 ±60s 容差配對。

已量測（唯讀）：`remote_total=422`、`repo_total=418`。

- **remote-only（repo 無對應檔）= 5**，全部為 repo 建檔前的早期 migration，且物件現存可證：
  `20260227131741`（建 `line_binding_codes`）、`20260227155729`（seed advisor experts）、`20260308110124`（`DROP TABLE trade_signals`）、`20260316122524`（加 `quantity_unit`）、`20260408065758`（建 `stock_names`）。
  → 判定 `known_pre_repo`，非 unknown mutation；S0 需逐筆用 `to_regclass` / `information_schema.columns` 證明物件狀態與 statement 一致。
- **重複登錄 = 5**（同一 repo migration 被記兩次，version 差 17–25 秒）：
  `20260721135648`↔`20260721135623`、`20260722023140`↔`20260722023118`、`20260724071600`↔`20260724071542`、`20260725213324`↔`20260725213311`、`20260729132638`↔`20260729132621`。→ 非 BLOCKER，僅需落檔。
- **repo-only 未登錄 = 1**：`20260812211500_bsr_claim_token_slot.sql`（檔案 md5 `30b322cf…`）。production `pg_proc.claim_bsr_queue_jobs` 已含 `token_slot`（`prosrc` md5 `c28474cc…`，len 1309）⇒ 判定 **applied-not-recorded**，非待部署項，禁止重跑。

GO 判準改為：`unknown_remote = 0`（=422 筆全數歸類為 matched / known_pre_repo / duplicate-record），且上述 5+5+1 的分類與 md5 與本節記載一致；任何新增未分類 remote 版本 ⇒ BLOCKER。落檔 `db/r1/c/S0/lineage.json`（含分類、key 規則、兩側清單 sha256）。

本次 exact target migrations 與 dependency order：
1. `db/r1/d/001_compat.sql`（S1）→ 2. `db/r1/p/001_projection.sql`（S1）→ 3. `db/r1/p/010_manifest_seed.sql`（S1）
→ 4. `db/r1/d/002_cutover.sql`（S2）→ 5. `db/r1/p/002_public_contract.sql`（S2）。
（S1 三檔彼此依 1→2→3；S2 兩檔依 4→5；跨 stage 不得合併。）


**S0-2 備份能力（先唯讀取得，不預設丟給 user）**
`supabase--project_info` / `cloud_status` 讀 backup tier、retention、last restore point、PITR 是否啟用。
若無 PITR：改做 stage-specific 邏輯備份（不做全庫 dump）——
(a) `pg_get_functiondef` 匯出 28 functions 前版定義；(b) `aclexplode` 匯出 37 ACL keys；
(c) 受影響表的 catalog DDL（`information_schema` + `pg_indexes` + policies）；
(d) 13 個 Edge bundle 目前版本號與 sha256；(e) `cron.job` 快照。
接著做 **restore rehearsal**：在 disposable clone 上還原上述 5 類並跑 `db/r1/p/095/096`，expect 0 fail。
未通過 rehearsal ⇒ S1 不得送審。

**S0-3 執行環境**：`pg_stat_activity`（`xact_start < now()-'60s'`）expect 0；`pg_locks` blocking expect 0。

**S0-4 ACL/hash 基線**：`bash db/r1/p/093_prod_acl_baseline.sh` → expect `named=3 / pattern=25 / 28 unique / 37 keys`、sha `4b789a85…`、`FAILURES=0`。

**S0-5 inventory 再點名**：15 DB writers / 13 Edge writers / 23 triggers（`db/r1/d/writer-inventory.json`）對 `pg_trigger`/`pg_proc`/functions 目錄核對，數量或簽名不符 ⇒ BLOCKER。

**S0-6 S5 追蹤基線**（見 S5-A，S0 先取一次快照）。

**S0-7 兩個 URL smoke 基線**：live 與 preview 各 4 身分首頁截圖 + console/network。

GO：S0-1…S0-7 全部有落檔證據且 0 BLOCKER。NO-GO：任一 BLOCKER。Rollback：不需要（唯讀）。
**S0 通過只代表回 Plan 重審，不自動授權 S1。**

---

# S1 expand（additive；獨立 rollback；估 2 h）

Objects（新增，無替換）：`app_ledger` schema 與其表、`public_nav_daily`、`public_projection_active`、
`replay_manifest_key` 及對應索引/constraint（來源即 S0-1 的 1→2→3）。
執行：每個 statement 獨立小交易，前置 `SET lock_timeout='3s'; SET statement_timeout='60s';`；
新欄位一律 nullable、無 volatile default（避免 rewrite）。
Expected read-back：新物件存在；既有表 `relfilenode` 與 S0 相同（證明 0 rewrite）；經濟資料 hash 未變。
Abort：任一 lock_timeout / hash 漂移。
Rollback（僅本 stage）：`DROP` 本 stage 新建物件（清單即上列），**不觸碰任何既有表**；時間上限 10 min；
資料相容：舊 writer 與舊前端全程未依賴新物件，故回退無資料遺失。

# S2 writer / ACL cutover（估 3 h）

順序：先 DB（wrapper 雙相容）→ 再 Edge，逐一部署。
Objects：`002_cutover.sql`（trigger 路由、`ledger_owner`）、`002_public_contract.sql`（28 functions 依 `acl-25.json` disposition、identity-bound wrapper、`*_raw` twin 封閉）。
前版保存：每個 function 的 `pg_get_functiondef` 與 ACL 快照（S0-2a/b）＋ 每個 Edge function 的 previous version + bundle sha256 + `_shared` import diff allowlist。
Read-back：`095`=65/0、`096`=185/0、`094`=21/0、RLS harness=16/0。
**Canary（不得造假交易）**：先唯讀找是否存在隔離的 inactive test expert（目前 12 位中 `status='suspended'` 的 趙鵬博 / 林修齊 signals=0，可作隔離對象，但仍需確認其不出現在任何 public 面）。
優先順序：(1) shadow/dry-run（ledger 計算但不 publish、事後比對）；(2) 隔離 suspended expert；(3) 自然發生的真實寫入作觀測 canary。
禁止刪除/偽造/污染 production 經濟紀錄，禁止碰 6515。
Edge：13 個 function **串行**部署，每個部署後 `curl` 健康檢查 + 讀 `edge_function_logs` 無新 error，再進下一個；任一失敗只 rollback 該單一 function 到 previous version。
Rollback 不遺失中間寫入：ledger 為 append-only；回退僅還原 trigger 路由與 ACL 定義。
**version watermark / idempotency bridge**：記錄 cutover 當下 `max(effect_key)` 作 watermark，legacy writer 恢復後對 `signal_trade_applications`（既有冪等表）先查存在性，watermark 之後由 ledger 寫入的 effect 一律跳過，避免 legacy 二次套用。時間上限 20 min。

# S3 projection / public contract（估 2 h）

12 位 expert 分類（實測 signals / open trade_records）：

| expert | status | signals | open TR | 分類 |
|---|---|---|---|---|
| 彥愷 (sharkgu) | active | 85 | 6 | **manual_review**（含 6515，withheld） |
| brcto | active | 35 | 4 | 候選 ready（需先驗無 drift key） |
| 老周老周 | active | 36 | 5 | 候選 ready（US，需 FX 檢查） |
| 阿基米德投資學 | active | 3 | 3 | **incomplete**（us_option 組合，不支援估值） |
| Benny | pending | 14 | 3 | out-of-scope（未上架） |
| 趙鵬博 / 林修齊 | suspended | 0 | 0 | out-of-scope（可作 S2 隔離對象） |
| Ele / 老佛爺 / 永維 / Sean / MK | pending | 0 | 0 | out-of-scope（無資料） |

「11 vs 12」解釋：manifest 以有經濟資料的 expert 計數，`experts` 表含 pending/suspended 共 12。S3 開始前需以 SQL 明確輸出此對照表存證。
只有經 drift 檢查證明 ready 的 expert 才可 build 並 flip pointer（canary 先 1 位，全綠再擴）。
驗收：`092_embargo.sh` 27/0；anon 不可讀 raw `trade_records`/`user_performances`/`app_ledger`；
6515 與 26 drift 僅顯示「資料檢核中」，無數字/圖表/匯出；`no_projection` fail-closed（29-case ×3 + `preview_verify.py`）。
Rollback：pointer CAS 回前一 `projection_version`（單語句，5 min 內），資料不刪。
Kill switch：現有 4 個 key 皆為 chips 用途，**沒有 projection kill switch**；若需要，屬 S3 新增項（additive）。

# S4 real production E2E（真資料、不 Publish；隨對應 stage 執行）

矩陣：4 身分（anon / authenticated 非訂閱 / authenticated 有效訂閱 / company_admin）× 2 對象（ready expert、Sharkgu）× 2 viewport × 2 theme = 32 組，
且 **live 舊前端與 preview 新前端分別各跑一輪**（兩個實際 URL）。
舊前端若拿不到 raw RPC，預期 UI：顯示「資料檢核中」或空狀態文案，**禁止白屏、JS crash、顯示舊數字**。
32 組之外的 server-side 驗證：export 端點（`authorize-pdf-export`）回 403 對非授權者、OG meta 由 server 回應正確、cache-control header 不快取個人化內容。
預期 401/403 白名單需逐 endpoint 列出（anon 對 `expert_signals` raw、非訂閱者對 detail RPC、非 admin 對 admin RPC…），未列入的 4xx/5xx 即失敗。
Evidence：每案截圖 + HAR + console dump + sha256 清單。
Disable switch：S3 新增的 projection kill switch。

# S5 原始 holding-checkup 資料新鮮度

**S5-A 唯讀追蹤（先做，不得跳過）**
對 job 106 與 107 各取最近 ≥3 個自然 runid（例：107 = 552338 / 552048 / 551764；106 = 552316 / 552025 / 551742），逐個追：
`cron.job_run_details` → `cron_dispatch_log(jobname, request_id, dispatched_at)` → `net._http_response`（status/body）
→ Edge log（`tw-bsr-finmind-sync`、`chips-prefetch-enqueue`）→ `tw_bsr_sync_queue` claim/`started_at`/`finished_at`
→ `tw_bsr_attempt_logs` → `tw_bsr_daily` 寫入列數 → `bsr_coverage_daily` delta。
已知反證：24h 內 `tw_bsr_daily` 0 列、`tw_bsr_attempt_logs` 0 筆 ⇒ 綠燈但無產出。
首要待驗假說（不預設結論）：`chips_keepwarm=false` kill switch、107 的 10–20 ms fire-and-forget 未實際觸發 worker、
或 worker 在 claim 前即因 quota/交易日判定 early-return。

**S5-B universe 與分母**
先建立台股 master：目前 `stock_names` 僅 74 列且皆為 US ⇒ **無台股 master = BLOCKER for P1**。
需先從 TWSE/TPEx 上市櫃清單建 master 表（symbol/market/上市日/下市日/類型），
再定義 eligible universe（排除下市、權證、ETN…）。分母確定後才可計算「65 / eligible」覆蓋率。
Queue 需以 unique symbol 統計（2,084 unique、941 檔 failed），**不得用 11,605 row count 當 universe**。

**S5-C 需求來源（privacy-safe）**
真實使用者持股在 `checkup_storage.key='pf-holdings-v2'`（38 列，RLS 綁 `user_id`）與瀏覽器 localStorage。
不得直接把個人持股表當排程來源。設計 **global demand registry**：`(symbol, market, last_requested_at, request_count)`，
**不存 user_id、不存數量成本**，由前端讀取時以 service 端聚合寫入（或由既有 telemetry 聚合），保留期 90 天。
P0 = demand registry 全部 symbol（涵蓋所有目前需求，不綁任一帳號）；P1 = master universe 慢速 sweep。
`chips_prefetch_targets` 的 20 筆 demo_seed 降為 demo 專用，不再視為需求。

**S5-D drawer 只讀**
drawer 只讀 ready/stale/incomplete 狀態，永不 enqueue。需移除/封死的路徑：
`src/checkup/hooks/useChipsBackfill.ts`、`src/checkup/lib/chipsLifecycle.ts`、`useChipsLifecycle.ts` 中觸發 `ensure_bsr_queued`／backfill Edge 的分支。
證明方式：(1) 單元/整合測試 spy `supabase.rpc`/`functions.invoke`，開啟 drawer 後 enqueue 類呼叫次數 = 0；
(2) Playwright 攔截 network，開 drawer 期間對 `tw-bsr-*`／`ensure_bsr_queued` 的請求數 = 0；
(3) 開 drawer 前後 `tw_bsr_sync_queue` 列數與 `max(enqueued_at)` 不變。
S5 rollback **不回舊 on-demand**：scheduler 失效時 drawer 維持 fail-closed / stale 標示，缺口由獨立 repair queue + 專屬 cron 處理。

**S5-E 分資料種別 SLO（依可得時點）**

| 資料種別 | 來源可得時點（TPE） | 交易日 SLO | 盤中 | 收盤後 | 週末/休市 |
|---|---|---|---|---|---|
| 價格 / OHLCV | 盤中即時、收盤 ~14:00 | P0 ≤ 15 min stale | 逐 tick/分鐘更新 | 收盤價 ≤ 15:00 落地 | 不產生新交易日資料，僅校驗最近交易日 |
| 三大法人 / BSR | 券商分點約 T 日 ~17:00–21:00 | P0 ≤ T+1 09:30、P1 ≤ 7 交易日輪完 | 不更新（顯示 T-1） | ≤ 22:00 完成當日 P0 | 補歷史缺口 + 消化 backlog + 校驗 latest session + 備份 |
| 基本面 / 營收 | 每月 10 日前、季報依法定期限 | ≤ 公布日 +1 日 | — | — | 可補 |
| FX | 每 30 min cron | ≤ 60 min | — | — | 沿用最後值並標示 |

Calendar/timezone：一律 Asia/Taipei，交易日以 `tw_market_holidays` 判定（S5 需先驗此表最新年度是否齊備）。
Queue latency SLO：P0 job 從 enqueue 到 done p95 ≤ 30 min；死信（attempts ≥ max_attempts）比率 ≤ 1%。
最大 staleness：P0 > 2 交易日即告警；P1 > 10 交易日即告警。
Coverage SQL：`select trade_date, count(distinct stock_id), count(*) filter (where coverage_class='full') from bsr_coverage_daily group by trade_date order by trade_date desc limit 10`
＋ P0 清單 ready 比率（demand registry left join `bsr_coverage_daily`）。
成本上限：由 `finmind_quota_pools`（`daily_budget`/`capacity`/`refill_per_min`）與 S5-A 實測吞吐推導區間；
未知參數（單 symbol 平均請求數、失敗重試率）列為待測，不先要求 user 決定。
新增持股 / unknown symbol：寫入 demand registry，由 scheduler 下一輪拾取，**不由 drawer 觸發**。
驗收案例 ≥ 4 種真實情境：ready hit、stale、unknown（從未抓過）、failed provider（941 檔 failed 中取樣）。

# S6 closeout

24 h 監控且至少跨 2 個自然小時的 106/107 run（**禁止手動觸發代替**）；
全 app vitest ×3 0 fail、tsgo、production build、consumer/DB/backdoor scanner 全綠、background processes = 0；
文件與 evidence hash 更新後自我對讀；前端仍不 Publish。
交回 user 決定：是否 Publish、6515 的 10 或 50、26 drift 逐筆裁決、S5 成本上限最終值。

---

## 執行順序一頁表（授權切割）

| # | Stage | 授權狀態 | 前置 | GO 判準 | NO-GO 動作 |
|---|---|---|---|---|---|
| 1 | S0 唯讀 preflight | **本輪送審** | — | unknown_remote=0、restore rehearsal 綠、ACL 28/37 sha 相符、inventory 15/13/23 相符、0 long tx | 停，回報 BLOCKER |
| 2 | S1 expand | 需另行核准 | S0 綠 + 回 Plan 重審 | 0 rewrite、hash 未漂移 | DROP 本 stage 物件（≤10 min） |
| 3 | S2 writer/ACL | 需另行核准 | S1 綠 | 095=65 / 096=185 / 094=21 / RLS=16、canary apply-once、13 Edge 串行健康 | 單函式回滾 + watermark bridge（≤20 min） |
| 4 | S3 projection | 需另行核准 | S2 綠 | 12 位分類存證、canary ready、embargo 27/0、no_projection fail-closed | pointer CAS 回前版（≤5 min） |
| 5 | S4 real E2E | 隨 stage 執行 | 對應 stage 綠 | 32 組 ×2 URL、0 洩漏、0 crash/白屏、401/403 全在白名單 | projection kill switch 關閉 |
| 6 | S5 freshness | 需另行核准 | S4 綠 | S5-A 追出真因、master universe 建立、demand registry 上線、drawer 0 enqueue 三重證明、各種別 SLO 連 2 交易日達標 | 關新 cron，drawer 維持 fail-closed |
| 7 | S6 closeout | — | S5 綠 | 24h + 2 個自然 cron run、全綠、background=0 | 保持 NO-GO |

## 尚未知、必須實測（不得假設）

PITR/backup tier 與 retention；Edge functions 各自版本號與 bundle hash；106/107 空轉真因；
台股 master universe 分母；FinMind 實際可用吞吐；`tw_market_holidays` 是否涵蓋當年度；
demand registry 的寫入時機（前端聚合 vs telemetry）；是否需要新增 projection kill switch。
