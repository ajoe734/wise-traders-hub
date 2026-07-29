# 持倉看板收盤價根因修復 — 完整實作計畫（TDD + Doc）

> 詳細架構與規則見 [`docs/architecture/price-authority.md`](../docs/architecture/price-authority.md)。本檔只追蹤 Phase 進度。

## 目標
持倉看板顯示的股價與收盤後官方價格 100% 對齊，涵蓋 TW / US / Crypto / **US Option（新增）**，並建立可觀測性與回歸測試防護。

## 進度總覽

| Phase | 內容                                                            | 狀態             | 交付檔                                                                                                       |
|-------|-----------------------------------------------------------------|------------------|--------------------------------------------------------------------------------------------------------------|
| 1     | US Option 收盤 Snapshot Edge Function + Yahoo + cron            | ✅ 完成 2026-07-29 | `supabase/functions/us-option-price-sync/{index,occ,yahoo,index_test}.ts` + migration 89                     |
| 2a    | `marketClock.ts`（DB-first 判定基礎）+ 單元測試                 | ✅ 完成 2026-07-29 | `src/checkup/lib/marketClock.ts`、`src/checkup/lib/__tests__/marketClock.test.ts`                            |
| 2b    | `useAuthoritativePrices` hook（DB → Realtime → offline cache）  | ✅ 完成 2026-07-29 | `src/checkup/hooks/useAuthoritativePrices.ts` + `__tests__/useAuthoritativePrices.test.ts`（7 綠燈）           |
| 3     | 拔除 MIS 主路徑；HoldingsWorkbench/ClosingAnalysis 改用新 hook  | 🚧 待實作         | `useMarketData.js`（僅保留 offline fallback）、components 改 hook                                            |
| 4     | TW `tw-price-sync-close-correction` 移到 14:05 TPE              | ✅ 完成 2026-07-29 | Migration（`cron.schedule` id 89）                                                                           |
| 5     | `price_source_mismatch` telemetry + Perf-metrics 卡片           | ✅ 完成 2026-07-29 | `price_parity_events` 表、`get_price_parity_summary` RPC、`PriceParityCard.tsx`、hook 內 `reportParityMismatches` |
| 6     | E2E 回歸 `e2e/holdings-price-parity.spec.ts` + CI               | ✅ 完成 2026-07-29 | `e2e/holdings-price-parity.spec.ts`、`playwright.config.ts`（project）、`.github/workflows/holdings-price-parity.yml` |

## Phase 2b 規格（下一步）

`useAuthoritativePrices(rows: HoldingRow[])`：
1. 用 `detectHoldingMarket` 分組後查 `marketPhase(m, now)`。
2. `hasSettledSnapshot=true` → `daily_price_snapshots WHERE market_date=marketDate AND symbol=ANY(...)`。
3. 否則 → `current_prices WHERE symbol=ANY(...)` + supabase Realtime subscribe（單一 channel、useEffect cleanup）。
4. Combo（`is_combo=true`）→ 讀 `expert_signal_legs`，用 `optionCombo.calcNetPremium` 聚合。
5. Miss 且 `navigator.onLine` → 標記 `stale`；`false` 才讀 LocalStorage。
6. 回傳 `{ price, source: 'snapshot'|'current'|'combo'|'offline'|'stale', updatedAt }`。

測試（`__tests__/useAuthoritativePrices.test.ts`）：
- Mock `supabase.from` → snapshot vs current 分支。
- Combo 部位 net value 對得起 legs 加總。
- Offline 模式讀 LocalStorage。
- 每次 Realtime subscribe 都在 unmount 時 removeChannel。

## Phase 3 影響面

拔除位置：
- `src/checkup/hooks/useMarketData.js`：`fetchPostCloseQuotes` 改為 fallback-only。
- `src/checkup/lib/marketSyncRuntime.js`：`buildTwseBatchQueries` 只在 offline 呼叫。
- `HoldingsWorkbench` / `HoldingsPanel` / `ClosingAnalysis` / `HoldingsDetailPanel`：改 `useAuthoritativePrices`。
- `FreeCheckup.jsx`（**RWD 憲法**：不改 hero，只換價格 source）。

## Phase 5 telemetry

寫入 `perf_metrics`（現有表）：
```ts
{ metric_name: 'price_source_mismatch', metric_value: diffPct, metadata: { symbol, market, db_price, cache_price } }
```
儀表板：`src/pages/company/PerfMetrics.tsx` 新增卡片。

## Phase 6 E2E

`e2e/holdings-price-parity.spec.ts`：
1. Seed `daily_price_snapshots` (符合 marketClock settled)。
2. Playwright 開持倉抽屜 → 讀 DOM 價格 === seed 值。
3. Combo 部位 net value === legs 加總。
4. `navigator.offline` 模擬 → 顯示 `stale` badge。
CI：加入 `.github/workflows/holdings.yml`。

## 交付檢核

- [x] Phase 1 US Option cron 已啟用（EDT 20:10 UTC / EST 21:10 UTC）
- [x] Phase 2a marketClock + 10 綠色測試
- [x] Phase 4 TW 14:05 cron
- [x] `docs/architecture/price-authority.md` 建立
- [x] Phase 2b useAuthoritativePrices（7/7 tests green）
- [ ] Phase 3 components 改用新 hook
- [x] Phase 5 telemetry（`price_parity_events` + `/company/perf-metrics` 卡片）
- [ ] Phase 6 E2E CI 綠燈

## 不可觸碰
`src/integrations/supabase/{client,types}.ts`、`.env`、`supabase/config.toml`（project 層設定）。
