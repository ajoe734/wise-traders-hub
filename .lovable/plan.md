# 持倉看板背景回補 — 修正版續作 Plan（Stage 0→4）

本輪仍是 0 變更。以下 findings 為 production 唯讀實測；Stage 0–4 待審核後才執行。
總狀態：**PARTIAL**，且「BSR 未前進」時永遠維持 PARTIAL；但三個子目標可分別完成：
(1) 不靠開抽屜 (2) 可用資料 lane 保持新鮮 (3) BSR 誠實降級。

---

## A. 唯讀 findings（證據）

### A1. 兩個獨立阻斷點（不可互相推論）

| # | 阻斷點 | 證據 |
|---|---|---|
| **P0-A 部署漂移** | Stage B 版 `tw-bsr-finmind-sync` 已在 production，但 Stage B SQL 從未套用 | worker 每次回 `{"ok":true,"note":"admission_gate_closed","admission":{"decision":"rpc_error","reason":"admission_status_rpc_error:Could not find the function public.bsr_admission_status without parameters in the schema cache"},"claimed":0,"processed":0,"provider_calls":0}`。`pg_proc` 查 `%admission%` 只有 `bsr_check_tier_admission(_api text,_tier smallint,_limit int)`，**無** `bsr_admission_status()` |
| **P0-B provider entitlement** | `tw_bsr_sync_config.market_batch`：`supported:false`、`last_probe_outcome:unsupported`、`last_probe_error:unsupported_plan:http_400:{"msg":"Your level is register…"}`、`probed_at 2026-08-17T13:30Z`、version 7 | **這只證明 market_batch（整日全市場）unsupported，不能推論單股 endpoint** — 單股 entitlement 目前無獨立證據，屬 Stage 2 待測 |

### A2. cron 真鏈（最近 ≥6 次，全部 HTTP 200 但 0 產出）

| runid | jobid | scheduled UTC | net resp id | HTTP | body |
|---|---|---|---|---|---|
| 584875 | 107 | 02:07:00 | 272088 | 200 | rpc_error, claimed 0, provider_calls 0, run_id `55940668…` |
| 584588 | 107 | 01:07:00 | 271934 | 200 | 同上 run_id `336c8eb2…` |
| — | 98 | 02:10:57 | 272098 | 200 | run_id `c838c0ae…` |
| — | 98 | 02:00:02 | 272067 | 200 | run_id `bc289e2c…` |
| — | 98 | 01:50:01 | 272044 | 200 | run_id `99760172…` |
| — | 98 | 01:40:04 | 272018 | 200 | run_id `7c9cc52f…` |
| — | 98 | 01:30:05 | 271996 | 200 | run_id `38564035…` |
| 584853 | 106 | 02:02:00 (5.3s) | 純 SQL 無 HTTP | — | enqueue 仍在生 job |

queue：`done 8432 / pending 548 / failed 1572`；pending 的 `next_run_at` 最早停在 **2026-08-17 12:58Z**；`tw_bsr_attempt_logs` 近 14 天 **0 筆**；`tw_bsr_fetch_failures` 最後一筆 **2026-08-17 07:21Z**。

### A3. Coverage（canonical SQL，INIT_HOLDINGS 20 檔）

| 分類 | 代號 | BSR | chip_fact | 三大法人 | OHLCV | pending/failed |
|---|---|---|---|---|---|---|
| TW 普通股 16 檔（eligible=true） | 1503 1717 2308 2313 2543 3006 3013 3017 3231 3443 3491 4583 6274 6770 6862 8227 | **全 2026-08-14** | 2026-08-14 | 2026-08-21（3491/6274/8227 = 08-17） | 2026-08-21 | 各 5–6 pending；2543/4583/6862 各 1 failed、3006 4 failed |
| 非普通股 4 檔 | `00637L` `702157`（invalid_stock_id）、`039108` `053848`（unsupported_asset_type） | 無 | 無 | 有 | 08-20~21 | **0 / 0（未製造假 failed job）** |

點名：**3017 / 4583 / 6862 BSR 皆停在 2026-08-14**。全表 `tw_bsr_daily` max 08-14、`tw_institutional_daily` max **08-21**。

### A4. 「不靠開抽屜／不靠登入」

`enqueue_chips_prefetch_gaps` → `detect_chip_gap_jobs` → **`checkup_prefetch_universe()`**（server-side single source of truth）UNION 四源：`trade_records`(TW/TWSE/TPEX) ∪ `expert_signals`(已發佈) ∪ **`checkup_storage` key=`pf-holdings-v2` 讀 `cs.data`（舊 `payload` bug 已修，production 定義確認）** ∪ `chips_prefetch_targets`(registry 20)。`source_rank` 1=checkup_storage / 2=open trade_records / 3=registry。
→ **enqueue 半邊成立**（實測有 `chips_prefetch_hourly:r1` 70、`:r3` 62 pending），**fulfil 半邊未成立**（claim 恆為 0）。

### A5. 旗標（不猜，只 readback）

`chips_all=true`、`chips_interactive=true`、`chips_backfill=true`（`enabled=true`＝放行）、**`chips_keepwarm=false`，updated_at `2026-08-22T01:20:47Z`** — 關閉來源未知，Stage 0 必須查明（`chips-guardian` 自動降級 vs 手動殘留）才可討論。
`circuit_breaker_config.enabled=false`、`warm_chips_cache_enabled.enabled=false`、`degrade:finmind mode=normal` — **只 readback，無 owner intent 一律不 toggle**。

### A6. clone-only、未進 production 的物件

`db/r1/c/SB/001_stage_b.sql` 內容（不得逐字搬）：
- schema `private_bsr` + 5 支 helper：`gate_state()` `gate_classify(boolean,jsonb)` `gate_blocked()` `gate_explicit_open()` `assert_sanitized(jsonb,int)`
- `public.tw_bsr_sync_queue_admission_gate()` + **trigger `trg_tw_bsr_sync_queue_admission_gate` ON `public.tw_bsr_sync_queue`**
- `public.bsr_admission_status()`、`public.bsr_block_and_terminalize_claims(uuid,bigint[],timestamptz[],int[],text,jsonb)`、`public.bsr_unblock_after_probe(int,text,jsonb,uuid)`
- 另有對 `public.recover_quota_failed_bsr_jobs` 的改寫（rollback 需 `002_recover_baseline.sql` 還原）→ **本次不搬**

`bsrAdmissionGate.ts` 實際只呼叫 **2 支**：`bsr_admission_status`（L156）、`bsr_block_and_terminalize_claims`（L303）。

---

## B. 缺口與風險

1. 沒有任何測試 assert edge function 呼叫的 RPC 都存在於 `supabase/migrations/` → P0-A 從此洞溜過。
2. 沒有 INIT_HOLDINGS ↔ registry ↔ eligibility contract test。
3. 沒有一般會員 RLS 路徑下 `pf-holdings-v2` → universe 的端對端測試。
4. gate 一旦可用，548 pending 會一次湧入 → 必須 bounded canary，禁止一次放行。
5. `trg_…admission_gate` 是寫入路徑 trigger，會影響 **所有** enqueue（含 cron 106），必須列入風險評估與 rollback。
6. 可用 lane（三大法人 08-21、OHLCV 08-21）目前未被 BSR gate 拖累，但需明確證明，不可假設。

---

## Stage 0 — RED tests 先行（0 production 變更）

**先補測試、再 migration。** 交付 targeted RED 輸出（證明現況會被抓到）。

1. **RPC-in-migrations static contract**：掃 `supabase/functions/**` 所有 `.rpc('…')` 字面量，assert 每個名稱在 `supabase/migrations/**` 有 `CREATE (OR REPLACE) FUNCTION public.<name>` 定義。
   → 預期 RED：`bsr_admission_status`、`bsr_block_and_terminalize_claims` 找不到。
2. **INIT_HOLDINGS ↔ registry ↔ eligibility**：以 server-side registry 為唯一來源（**不得把 20 檔硬編碼散落到 SQL**），assert 16 supported / 4 unsupported，且 4 檔 reason ∈ {invalid_stock_id, unsupported_asset_type} 並且 queue pending=failed=0。
3. **一般會員 pf-holdings-v2 → universe**：以真實 RLS 路徑（authenticated）寫入/讀取 `checkup_storage.data`，assert 該 code 出現在 universe 且 `sources` 含 `checkup_storage`。**禁止 zero-fill / fake 0 股 / mock**。
4. **gate RPC 契約**：assert exact signature、owner、`prosecdef`、`proconfig` 含固定 `search_path`、ACL（`service_role` 有 EXECUTE；`anon`/`authenticated`/`PUBLIC` 無）。
   → 預期 RED：物件不存在。
5. **clone vs production diff 清單**（唯讀交付，非測試）：逐項列 `001_stage_b.sql` 每個物件在 production 的 存在/不存在、相依物件、ACL、`tw_bsr_sync_config` 相關 key 差異，並標記「本次搬 / 本次不搬」與理由。

**Stage 0 驗收**：貼出 targeted RED 完整輸出（含 1 與 4 的失敗訊息明確指向 missing `bsr_admission_status`）＋ diff 清單。無 RED 證據不得進 Stage 1。

---

## Stage 1 — 單一 idempotent 最小 gate migration

僅補 `bsrAdmissionGate.ts` **實際呼叫**的必要物件，逐行 self-review 後重寫（不逐字搬 clone SQL）：

- 納入：`public.bsr_admission_status()`、`public.bsr_block_and_terminalize_claims(...)`、以及這兩支「不可省略」的最小相依（`private_bsr` helper 視 diff 結果決定，能內聯就內聯）。
- **不納入**：`trg_tw_bsr_sync_queue_admission_gate` trigger、`bsr_unblock_after_probe`、`recover_quota_failed_bsr_jobs` 改寫（若 Stage 2 需要 unblock 再獨立評估）。
- 全 schema-qualified、`SET search_path = public/pg_catalog`（固定）、`SECURITY DEFINER` 逐支說明必要性。
- ACL：`REVOKE ALL FROM PUBLIC, anon, authenticated`；只 `GRANT EXECUTE TO service_role`。
- **不改** queue rows、不改 RLS、不改其他 cron、不改 UI、不做 destructive cleanup。
- Idempotent：`CREATE OR REPLACE` / `IF NOT EXISTS`，可重跑。

**Rollback**：本次 migration 的精確 inverse（只 DROP 本次建立的物件，不引用 `099_rollback.sql`，不碰 `002_recover_baseline.sql`）。回滾後行為＝今天的 `rpc_error`＋claimed=0，資料零損失。

**Stage 1 驗收**：下一個 `:07`／`*/10` worker 的 HTTP body **不再出現 `admission_status_rpc_error`**。
若 provider unsupported，**正確結果是 fail-closed `unsupported_plan`、`claimed=0`**，此即 PASS；**不得要求 claimed>0**。

---

## Stage 2 — provider capability probe（**最多 1 次**，budgeted）

目標：分別確認 **單股 BSR endpoint** 與 **market_batch** 的 exact entitlement，兩者不互相推論。
限制：**不購買、不升級、不換供應商**；只允許 **1 次** capability probe。

交付：endpoint path、HTTP status、provider 回傳 code/message（不回 token）、call count、`finmind_quota_pools` 的 `tokens/used_today/daily_budget` **before/after**。

分支：
- **單股 unsupported** → 維持 gate closed；**不得 claim 548 backlog、不得刪 queue**；**停止每小時重複製造同類 pending**（僅調整生產端，不刪既有 rows）；走 **Stage 3(c) 誠實降級**。
- **單股可用** → 進 Stage 3(a) canary。

---

## Stage 3 — bounded outcome A / B

### 3(a) 單股可用：canary 階梯
`1 symbol × 1 date × 最多 1 call` → 觀察 → `1 → 3 → 5` 小批，每階段之間人工檢視。
任何 429 / freeze / quota reject / circuit error **立即關閘停止**。**禁止一次放行 548 pending**。

### 3(c) 單股不可用：誠實降級（UI 最小狀態契約）
- Preview 明示「**分點資料暫時無法更新**」＋顯示**最後資料日期 2026-08-14**；不得把 08-14 stale 當最新、不得 fake 0、不得靠開抽屜修復。
- 三大法人／價量各自顯示 **獨立 freshness**（分段新鮮度元件已存在，只補文案與狀態值）。
- ETF／權證／美股維持 unsupported，不建 failed job。
- **只改狀態契約，不改版型、不動其他功能。不 deploy frontend、不 Publish。**

### 兩條 lane 解耦（不論 A/B 都要證明）
證明三大法人（cron 38/72）與 OHLCV/sparkline（cron 87/99）**不被 BSR gate 拖死**：任意真實使用者持股，在**不開抽屜**的前提下仍維持 freshness，附 job → coverage after 證據。

---

## Stage 4 — Preview / regression / receipt

- **fresh Preview 載入 `/holding-checkup`，不開任何個股抽屜**：驗 INIT_HOLDINGS 20 檔 ＋ 另一個真實使用者持股；記錄 console（0 error）、network、API fan-out、前端 stale / unsupported 狀態。
- exact changed-files allowlist（migration 檔 ＋ 測試檔 ＋ 最小 UI 狀態檔，其餘一律不得出現在 diff）。
- before snapshot（本文件 A2/A3 即為 before，Stage 4 重跑同一段 canonical SQL 做 after 對照）。
- targeted tests ＋ full regression ＋ `tsgo` ＋ build。
- security self-review（SECURITY DEFINER 必要性、search_path、ACL、無新 anon 曝露）。
- receipt 檔（含 runid / request_id / run_id / provider code / quota before-after / coverage before-after / sha256）。

### 驗收 A / B（二選一，缺一項即 PARTIAL）
- **A（單股可用）**：runid → request_id → HTTP → run_id → job → provider call → coverage after（含 3017 / 4583 / 6862）。
- **B（不可用）**：runid → request_id → HTTP → **`unsupported_plan`（非 `rpc_error`）**、**0 provider call**、**0 新增同類 pending**；再獨立證明可用 lane 的 job → coverage after。

測試綠燈或空 queue 皆不列為證據。

---

## 目前可觀測 ID（不重排第二個 worker）

cron 106（`:02`）、107（`:07`）、98（週末 `*/10`）皆 active。最新 worker run_id：`c838c0ae-1b0b-4125-9caa-b50d35c5f333`（02:10:57Z, net 272098）、`55940668-ea43-403f-ae94-c42c8642a36f`（02:07Z, net 272088）。兩者 claimed=0，屬空轉，非進行中的有效任務。
