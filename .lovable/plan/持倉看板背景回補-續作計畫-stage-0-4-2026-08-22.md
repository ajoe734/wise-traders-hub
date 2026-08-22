# 持倉看板背景回補 — 續作計畫（Stage 0→4）

只有 5 個 stage，逐階段人工放行。BSR 未前進則總狀態維持 PARTIAL。
全程不 deploy frontend、不 Publish、不做 destructive cleanup。

---

## Stage 0 — RED tests

**Actions**
1. RPC-in-migrations static contract：掃 `supabase/functions/**` 所有 `.rpc('…')` 字面量，assert 每個名稱在 `supabase/migrations/**` 有 `CREATE (OR REPLACE) FUNCTION public.<name>` 定義。
2. Gate RPC ACL/security contract：assert exact signature、owner、`prosecdef`、`proconfig` 固定 `search_path`、ACL（`service_role` 有 EXECUTE；`PUBLIC`/`anon`/`authenticated` 無）。
3. INIT_HOLDINGS ↔ registry ↔ eligibility：以 server-side registry 為唯一來源（20 檔不得硬編碼散落到 SQL），assert 16 supported / 4 unsupported，4 檔 reason ∈ {invalid_stock_id, unsupported_asset_type} 且 queue pending=failed=0。
4. authenticated `pf-holdings-v2` → universe：走真實 RLS 路徑讀 `checkup_storage.data`，assert 該代號進入 universe 且 `sources` 含 `checkup_storage`。禁止 zero-fill / fake 0 股 / mock。

**Allowlist**：`src/test/**`、`supabase/tests/**`、`scripts/audit-*.mjs`（新增測試檔）。

**Acceptance**：貼出 targeted RED 完整輸出；1 與 2 必須明確失敗並指名 missing `public.bsr_admission_status`。

**Stop condition**：任一測試意外 GREEN（代表測不到目標）→ 停止，回報測試設計錯誤，不進 Stage 1。

**Rollback**：刪除新增測試檔；production 0 變更。

---

## Stage 1 — Safe migration

**Actions**
1. 先產出 clone-vs-production diff：`db/r1/c/SB/001_stage_b.sql` 每個物件在 production 的存在/不存在、相依、ACL、`tw_bsr_sync_config` 差異，逐項標記「本次補 / 本次不補」與理由。
2. 依 diff 結果，重寫（非逐字搬）單一 idempotent migration，只補 `supabase/functions/_shared/bsrAdmissionGate.ts` 實際呼叫的 RPC：`public.bsr_admission_status()`、`public.bsr_block_and_terminalize_claims(...)`，以及其不可省略的最小相依（能內聯則內聯）。
3. 全 schema-qualified、固定 `search_path`、`SECURITY DEFINER` 逐支說明必要性、`REVOKE ALL FROM PUBLIC, anon, authenticated` + 只 `GRANT EXECUTE TO service_role`。
4. 不建立 queue 寫入 trigger、不改 queue rows、不改 RLS、不改任何 cron、不改資料、不改 UI。

**Allowlist**：`supabase/migrations/<new>.sql`、Stage 0 測試檔的 GREEN 化調整（不放寬斷言）。

**Acceptance**：下一個 worker 週期的 HTTP body 不再出現 `admission_status_rpc_error`。若 provider unsupported，`unsupported_plan` 且 `claimed=0` 即為通過。

**Stop condition**：出現任何 queue/RLS/cron/資料被動變更，或 diff 顯示需要額外物件才能運作 → 停止並回報，不擴張範圍。

**Rollback**：本次 migration 的精確 inverse，只 DROP 本次建立的物件；回滾後行為回到 `rpc_error` + `claimed=0`，資料零損失。

---

## Stage 2 — One-call capability probe

**Actions**
1. 分開量測「單股 BSR endpoint」與「market_batch 整日全市場」的 entitlement，兩者不互相推論。
2. 最多 **1 次** provider call，預算內執行。
3. 記錄 endpoint path、HTTP status、provider code/message（不回 token）、call count、`finmind_quota_pools` 的 `tokens / used_today / daily_budget` before/after。
4. 旗標（`chips_keepwarm`、`circuit_breaker_config`、`warm_chips_cache_enabled`、`degrade:finmind`）只 readback 並回報 `chips_keepwarm` 於 2026-08-22T01:20:47Z 關閉的來源；一律不 toggle。

**Allowlist**：唯讀查詢與 1 次 probe；無檔案變更（除 receipt 草稿）。

**Acceptance**：交付上述完整量測表，且單股與 market_batch 各有獨立結論。

**Stop condition**：不購買、不升級、不換供應商；probe 超過 1 call 或觸發 quota reject → 立即停止。

**Rollback**：無寫入可回滾；若 probe 更新了 `tw_bsr_sync_config` 探測欄位，記錄前後值。

---

## Stage 3 — A/B bounded outcome

**Actions（A：單股可用）**
1. canary：1 symbol × 1 date × 最多 1 call，人工檢視後才續。
2. 階梯放行 1 → 3 → 5，每階段之間人工檢視，禁止一次放行 548 pending。

**Actions（B：單股不可用）**
1. 維持 gate closed：0 provider call、0 新增同類 pending（只調整生產端節奏，既有 548 pending 不刪、不 claim）。
2. Preview 誠實降級：BSR 顯示「分點資料暫時無法更新」並標示最後資料日期 2026-08-14；不得把 stale 當最新、不得 fake 0、不得靠開抽屜修復。
3. 三大法人與 OHLCV/sparkline 各自顯示獨立 freshness，並證明這兩條 lane 不被 BSR gate 拖死。

**Allowlist**：`src/checkup/components/freecheckup/**` 之最小狀態契約與文案；不改版型、不改其他功能。

**Acceptance**：A 走到 5-symbol 小批仍無錯誤；B 交付 0 provider call、0 新同類 pending，且可用 lane 對任意真實使用者持股在不開抽屜下仍新鮮。

**Stop condition**：任何 429 / freeze / quota reject / circuit error → 立即關閘停止。

**Rollback**：A 停止排程放行即回到 gate closed；B 的 UI 狀態契約可單檔還原。

---

## Stage 4 — Preview / regression / receipt

**Actions**
1. fresh Preview 直接載入 `/holding-checkup`，**不開任何個股抽屜**，驗 INIT_HOLDINGS 20 檔 ＋ 另一個真實使用者持股；記錄 console、network、API fan-out、stale/unsupported 狀態。
2. 完整鏈證據：runid → request_id → HTTP → decision/job → coverage after（同一段 canonical SQL 對照 before），含 3017 / 4583 / 6862。
3. targeted tests、full regression、`tsgo`、build、security self-review、exact changed-files diff allowlist。
4. 產出 receipt（runid / request_id / run_id / provider code / quota before-after / coverage before-after / sha256）。

**Allowlist**：`docs/**` receipt 檔。

**Acceptance**：上述每一項皆有獨立證據；測試綠燈或空 queue 不列為證據。BSR 未前進則總狀態標記 PARTIAL，並分別標記「不靠抽屜」「可用資料新鮮」「BSR 誠實降級」三個子目標的完成狀態。

**Stop condition**：任一證據缺漏 → 維持 PARTIAL，不宣告結案。

**Rollback**：receipt 為文件，無需回滾；功能回滾依 Stage 1/3 各自條款。
