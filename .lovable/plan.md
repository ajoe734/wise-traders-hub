
# 持倉抽屜籌碼面 Gap 收尾計畫（TDD 先行版）

目標：以測試先行方式收尾三個 gap — Sealing 機制、Fallback 量化、Header 文案單一來源。每個 Phase 順序：紅燈測試 → 最小實作 → 綠燈 → 重構。

---

## Phase A — Sealing 機制落地（TDD）

### A1. 紅燈：先寫測試
新增 `src/test/integration/bsr-sealing-lifecycle.test.ts`：
- 插入一筆 `tw_bsr_daily`（`stock_id=2330`, `trade_date=2026-07-24`）但不寫 `snapshot_status`。
- 呼叫 `bsr_snapshot_mark` RPC。
- 斷言 `tw_bsr_daily_snapshot_status` 出現一筆，且 `sealed_at IS NOT NULL`、`sealed_by_lane = 'manual'`、`row_count > 0`。
- 斷言嘗試 UPDATE 該 `tw_bsr_daily` 資料會被 `enforce_snapshot_immutability` trigger 拒絕（預期錯誤）。
- 斷言 `tw-chips-detail` 對 `2330` 的 payload 中 `readiness.sealed = true`。

此時測試紅燈：`bsr_snapshot_mark` 未實作、orchestrator 未呼叫 sealing、payload 未帶 sealed 欄位。

### A2. 最小實作
- 在 `supabase/functions/_shared/bsrRollup.ts` 定義 `SealedSnapshot` 型別，並讓 `computeBsrWindow()` 在入口先檢查 `bsr_snapshot_claim(stock_id, trade_date)`：若已 sealed 則鎖用該日資料；未 sealed 則走既有路徑。
- 在 `supabase/functions/tw-bsr-finmind-sync/lib.ts` 的每個 lane 完成寫入後，呼叫 `bsr_snapshot_mark(stock_id, trade_date, lane, row_count, source_hash)`。這個 RPC 已存在於 DB functions，直接調用。
- 在 `supabase/functions/tw-chips-orchestrator/index.ts` 三波結束後，針對「所有 lane 都 done」的 `(stock_id, trade_date)` 再呼叫一次 `bsr_snapshot_fulfill_jobs` 確保冪等。
- 在 `supabase/functions/tw-chips-detail/index.ts` 回傳 payload 中增加 `readiness.sealed`（boolean）與 `readiness.sealed_at`。
- 在 `src/checkup/hooks/useChipsState.ts` 的 `deriveChipsState` 中，若 `readiness.sealed === true` 且今日資料齊全，優先標為 `ready`；若未 sealed 且今日缺料，仍走 `d1_fallback`。

### A3. 綠燈與重構
跑 `bsr-sealing-lifecycle.test.ts` 直到全綠；再跑 `pr6-chips-state-machine.test.ts` 與 `bsr-window-fulfillment.test.ts` 確認既有狀態機沒被破壞。重構：把 `bsr_snapshot_mark` 的呼叫包成 `sealSnapshot()` 小函式，避免在 finmind-sync 與 orchestrator 中重複。

---

## Phase B — Fallback 觸發率量化（TDD）

### B1. 紅燈：先寫測試
新增 `src/test/integration/bsr-fallback-attribution.test.ts`：
- 對 `tw_chips_rollup` 插入兩筆 `(stock_id, as_of_date, window_days)`：一筆 `source_date = as_of_date`、`fallback_used = false`；一筆 `source_date = as_of_date - 1`、`fallback_used = true`。
- 呼叫 `get_bsr_readiness_v2`（或 `tw-chips-detail`）並斷言 20 日窗 `fallback_used = true` 時，回傳 `readiness.source_date = 昨日` 且 `readiness.fallback_used = true`。
- 新增 `src/checkup/hooks/__tests__/useChipsState.fallback.test.tsx`（或現有測試擴充）：當 payload 帶 `fallback_used = true` 時，`deriveChipsState` 狀態必為 `d1_fallback`。

此時紅燈：rollup 表沒有 `source_date` / `fallback_used` 欄位、payload 沒回傳、deriveChipsState 沒讀。

### B2. 最小實作
- Migration：
  ```sql
  ALTER TABLE public.tw_chips_rollup
    ADD COLUMN source_date DATE NOT NULL DEFAULT as_of_date,
    ADD COLUMN fallback_used BOOLEAN NOT NULL DEFAULT false;
  CREATE INDEX idx_tw_chips_rollup_fallback ON public.tw_chips_rollup(as_of_date, fallback_used);
  ```
- `bsrRollup.ts`：
  - `computeBsrWindow()` 回傳 `{ sourceDate, fallbackUsed, ... }`。
  - 寫入 `tw_chips_rollup` 時帶入 `source_date` / `fallback_used`。
  - 當「今日 sealed 資料齊全」：fallback_used = false, source_date = trade_date。
  - 當「今日未 sealed，回退到 D-1」：fallback_used = true, source_date = D-1。
- `tw-chips-detail`：payload 增加 `readiness.source_date` 與 `readiness.fallback_used`。
- `useChipsState.ts`：
  - `d1_fallback` 判定從「欠料推估」改為 `fallback_used === true`。
  - 若 `fallback_used === false` 但資料缺 5 日窗，改標 `filling_new_stock` 或 `upstream_outage`（依現有狀態機）。
- `useTwChipsDetail.ts`：成功取到資料後，送 `traffic_events` 事件：
  - `event_name = 'chips_fetch_ok'` 時帶 `metadata = { stock_id, window_days, fallback_used, source_date }`。
  - 若 `fallback_used = true`，再多送 `chips_fallback_used`。
- `ChipsCacheTelemetryCard.tsx`：
  - 讀 `traffic_events` 過去 24 小時 `chips_fetch_ok` 與 `chips_fallback_used`。
  - 新增「Fallback 命中率」區塊，拆 5 / 20 / 60 日窗計算 `fallback_used / fetch_ok` 比例。
  - 顯示「資料來源日期」分佈（今日 vs 昨日）。

### B3. 綠燈與重構
跑 `bsr-fallback-attribution.test.ts` 到綠燈；再跑 `pr6-chips-state-machine.test.ts` 與 `useChipsState` 相關測試。重構：把 `fallback_used` 的比率計算抽出成 `useChipsFallbackTelemetry()` hook，避免 `ChipsCacheTelemetryCard` 與未來其他 telemetry 卡重複 SQL。

---

## Phase C — `bsrHeaderLabel` 重複邏輯收斂（TDD）

### C1. 紅燈：先寫測試
擴充 `src/checkup/components/freecheckup/__tests__/bsrHeaderLabel.test.ts`：
- 新增 case：當輸入 `state = 'd1_fallback'` 時，回傳字串必須包含「昨日」或「D-1」標示（依設計決定）。
- 新增 case：當輸入 `state = 'ready'` 時，回傳字串不含 fallback 標示。
- 新增 case：當 `state = 'filling_new_stock'` 時回傳「累積中」文案。

同時新增 `src/test/components/chips-section-header-single-source.test.tsx`：
- mount 一個 mock `ChipsSection` 並檢查它渲染的 header 文字與 `bsrHeaderLabel(state)` 回傳一致。
- 紅燈：因 `ChipsSection.tsx` 內仍有獨立判定，某些 state 會輸出不同文字。

### C2. 最小實作
- 刪除 `ChipsSection.tsx:295-316` 的 `bsrHeaderLabel` 內建函式。
- `ChipsSection.tsx` 改為 `import { bsrHeaderLabel } from './bsrHeaderLabel'`。
- 把 `d1_fallback` 的「昨日資料」語意合併進 `bsrHeaderLabel.ts`，確保狀態機與 UI 顯示一致。
- 如果 `ChipsSection` 需要額外 className 或 suffix，統一透過 `bsrHeaderLabel` 回傳 `{ label, subLabel, intent }` 物件而非純字串。

### C3. 綠燈與重構
跑 `bsrHeaderLabel.test.ts` 與 `chips-section-header-single-source.test.tsx` 到綠燈；再跑 `chips-section.spec.ts` 與 `chips-section-visual.spec.ts` 確認 8 張視覺快照未破。重構：在 `ChipsSection.tsx` 內建立 ESLint `no-restricted-syntax` 註解或團隊規範，禁止再次定義 `bsrHeaderLabel`。

---

## 執行順序（嚴格紅綠重構）

每個 Phase 內步驟：
1. 寫/擴充測試，提交，確認紅燈。
2. 寫最小實作，確認綠燈。
3. 重構，確認仍綠燈。
4. 進入下一個 Phase。

Phase 順序：A → B → C。原因：A 改 sealing 會影響 B 的 fallback 判定（sealed 是 fallback 的輸入），C 只動 UI 文案，最獨立。

---

## 檔案清單

### 新增測試
- `src/test/integration/bsr-sealing-lifecycle.test.ts`
- `src/test/integration/bsr-fallback-attribution.test.ts`
- `src/test/components/chips-section-header-single-source.test.tsx`
- 擴充 `src/checkup/components/freecheckup/__tests__/bsrHeaderLabel.test.ts`

### 新增/修改程式碼
- `supabase/migrations/<timestamp>_chips_fallback_columns.sql`
- `supabase/functions/_shared/bsrRollup.ts`
- `supabase/functions/tw-bsr-finmind-sync/lib.ts`
- `supabase/functions/tw-chips-orchestrator/index.ts`
- `supabase/functions/tw-chips-detail/index.ts`
- `src/checkup/hooks/useChipsState.ts`
- `src/checkup/hooks/useTwChipsDetail.ts`
- `src/checkup/components/freecheckup/ChipsSection.tsx`
- `src/checkup/components/freecheckup/bsrHeaderLabel.ts`
- `src/pages/company/_bsr/ChipsCacheTelemetryCard.tsx`

### 文件更新
- `docs/runbooks/chips-lanes.md` 更新 sealing 觸發路徑
- `docs/ops/chips-pipeline-runbook.md` §7 增加 fallback_used 監控 SOP

---

## 最終驗證（窮舉）

- 所有新增單元/整合測試綠燈。
- 既有 `bsrRollup.test.ts`（19）、`pr6-chips-state-machine.test.ts`（11）、`bsr-window-fulfillment.test.ts`（16）、`chips-coalesced-badge.test.tsx` 全綠。
- 既有 E2E `chips-section.spec.ts`、`chips-section-visual.spec.ts`、`chips-section-mobile.spec.ts` 全綠，視覺快照無漂移。
- `tsgo` 或 `bunx tsc --noEmit` 無型別錯誤。
- Sandbox 手動：觸發一次 `tw-chips-orchestrator` 三波，撈 `tw_bsr_daily_snapshot_status` 非 0、`tw_chips_rollup.fallback_used` 有 true 與 false 兩種值。
- `ChipsCacheTelemetryCard` 能看到 5/20/60 窗 fallback 命中率。
