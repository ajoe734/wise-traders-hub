# 持倉看板收盤價根因修復 — 完整實作計畫（TDD + Doc）

## 目標
持倉看板顯示的股價與收盤後官方價格 100% 對齊，涵蓋 TW / US / Crypto / **US Option（新增）**，並建立可觀測性與回歸測試防護。

## 現況盤點（已確認）
- 前端 `src/checkup` 走 client-side MIS + LocalStorage，忽略 DB 權威來源。
- Cron 覆蓋：TW ✅、US ✅、Crypto ✅、**US Option ❌**（`current_prices` 無 `us_option` 資料）。
- TW 13:35 過早、快取語意混淆、無 mismatch 監控。

## 實作階段（TDD，逐階段紅→綠→重構）

### Phase 1 — US Option 收盤 Snapshot（補齊缺口）
- **測試先行**：
  - `supabase/functions/us-option-price-sync/*.test.ts`：mock 上游 → 驗證寫入 `current_prices` / `daily_price_snapshots`（`asset_class=us_option`, `currency=USD`）、combo 淨值計算、失敗 retry。
- **實作**：
  - 新 Edge Function `us-option-price-sync`（單腿 mark price；combo 由 `optionCombo.ts` 聚合）。
  - Cron：EDT 16:10 / EST 16:10（沿用現有 US 時區切換模式）。
  - Auth：`requireCronKey`（依 Phase M 契約）。

### Phase 2 — 權威價 Hook（DB-first）
- **測試先行**：
  - `src/checkup/hooks/__tests__/useAuthoritativePrices.test.ts`：
    - 收盤後 → 讀 `daily_price_snapshots`。
    - 盤中 → 讀 `current_prices` + Realtime subscribe。
    - DB miss → 標記 `stale`，LocalStorage 僅作 offline fallback。
    - Market clock：TW / US / Crypto / Option 各自視窗判定。
- **實作**：
  - 新 `useAuthoritativePrices.ts`（取代 MIS 主路徑）。
  - `src/checkup/lib/marketClock.ts`：市場別收盤判定。
  - Combo 部位透過 `optionCombo.ts` 計算 net value。

### Phase 3 — 移除 MIS 主路徑 + 快取語意收斂
- **測試**：
  - 整合測試：LocalStorage 只在 `navigator.onLine === false` 時使用。
  - UI 快照：`stale` badge 呈現。
- **實作**：
  - 拔除 `src/checkup` 內 MIS 呼叫；保留 `mis*.ts` 為 offline-only fallback。
  - `HoldingsWorkbench` / `ClosingAnalysis` / `HoldingsDetailPanel` 改用新 hook。

### Phase 4 — TW 同步時機修正
- **實作**：
  - `tw-price-sync-close` cron 從 13:35 → **14:05 TPE**（保留 13:35 為 intraday snapshot、14:05 為官方收盤）。
  - Migration 更新 `cron.schedule`。

### Phase 5 — 可觀測性
- **測試**：
  - `price_source_mismatch` telemetry 寫入 `perf_metrics`。
- **實作**：
  - Hook 內比對 DB vs LocalStorage，落差 > 0.5% 記錄事件。
  - `/company/perf-metrics` 新增 Price Parity 卡片（sample rate、mismatch 次數、TW/US/Option 分組）。

### Phase 6 — E2E 回歸
- `e2e/holdings-price-parity.spec.ts`：
  - Seed DB snapshot → 開啟持倉看板 → 斷言價格 === DB。
  - Combo 部位：net value === legs 加總。
  - 離線模式：顯示 `stale` badge。
- 納入 CI `holdings.yml` workflow。

## 文件（同步產出）
- **新增** `docs/architecture/price-authority.md`：資料源優先順序、市場時鐘、快取語意、Combo 計價、監控指標、故障排除。
- **更新** `docs/architecture/holdings-modules.md`：Closing / Holdings 模組改為 DB-first。
- **更新** `.lovable/plan.md`：加入本階段 TODO 與完成標記。
- **更新** `docs/qa/holdings-dashboard-checklist.md`：新增 price parity 手動驗證項目。
- **移除** 過期段落：MIS-first 描述、13:35 TW cron 說明。

## 技術細節
- **DB schemas 已存在**：`current_prices` (21 cols)、`daily_price_snapshots` (17 cols) 直接使用。
- **Combo 定價**：`is_combo=true` 時，`useAuthoritativePrices` 讀取 `expert_signal_legs` → 逐腿抓 mark price → net = Σ(sign × price × multiplier)。
- **Realtime**：`current_prices` 已有 RLS，subscribe filter by `symbol IN (...)`。
- **Auth**：新 Edge Function 遵循 Phase M 契約（`requireCronKey`）。
- **不可觸碰**：`src/integrations/supabase/client.ts`、`types.ts`、`.env`。

## 交付檢核
- [ ] 6 個 Phase 全綠（unit + integration + E2E）。
- [ ] US Option `current_prices` 有資料（cron 跑過一次）。
- [ ] 持倉看板 3 個市場（TW/US/Option）收盤後與 DB 完全一致。
- [ ] `docs/architecture/price-authority.md` 已建立。
- [ ] `.lovable/plan.md` 標記本任務完成。
