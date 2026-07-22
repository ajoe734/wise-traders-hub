# 持倉看板 Bug 全面體檢計畫

範圍：`/checkup`（會員版 HoldingsPage / HoldingsPanel / HoldingsTable / HoldingsDetailPanel / ChipsSection）+ `/holding-checkup`（FreeCheckup HoldingsTab 卡片牆），涵蓋資料層、hooks、UI、RWD、匯出、籌碼面、抽屜互動。

## 檢查方法論

不准偷懶——每一層都窮舉，回報前列「已檢查清單 vs 漏檢清單」。

### Layer 1 — 資料源與單一憲法稽核（靜態）
1. **grep 全域**：`trade_records` / `get_expert_capital_status` / `useExpertHoldingsBundle` / `useMyTradeRecordHoldings`（應為 0）/ 直接讀 `holdings_fix_proposals` 的元件，確認無違反「單一資料源憲法」。
2. **單位憲法**：所有觸及 `quantity` / `quantity_unit` 的檔案，比對是否走 `sanitizeAssetQuantityUnit` / `resolvePositionQuantityDisplay` / `normalizeQuantityToBaseUnits`；US/期權/crypto 不得出現「張」。
3. **價格憲法**：`current_prices` vs `holding_meta_overrides` vs `daily_price_snapshots` 的 fallback 順序（對照 `mem://features/checkup/metadata-fallback-hierarchy`）。
4. **顏色憲法**：紅漲綠跌 + 單色橘紅 PnL；grep 硬編碼 `text-red-` / `text-green-` / `#22c55e` 等。

### Layer 2 — Hooks 與 Store 邏輯（單元測試 + 手算）
5. `useRouteHoldingsPage`：`missing-price` 排除、totalCost 計算、winners/losers 排序、valueKey 命中率。
6. `useHoldingsDerivations`：ink/accent/plain 配額、`firstFeatureCode`、`strategyOptions` 去重。
7. `holdingsStore`：`getTopGainers` / `getHoldingsSummary` WeakMap 快取穩定性、`reset()` 副作用。
8. 補跑 `src/test/unit/holdings-*` 與 `src/test/holdingScenario.test.ts` / `holdingsInSector.test.ts` / `holdingExport.test.tsx`。

### Layer 3 — RLS / RPC / Edge Function
9. `holdings_fix_proposals` / `holding_meta_overrides` / `holding_meta_override_history` RLS 逐條檢查。
10. `get_expert_capital_status` / `admin_generate_fix_proposals` / `admin_apply_fix_proposal` 的權限與 view-as 模式行為。
11. `current_prices` 更新排程與 `checkup-price-refresh` 是否卡在交易時段憲法。

### Layer 4 — UI 元件互動（Playwright headless）
針對每個抽屜/面板逐一截圖 + 互動測試：
- HoldingsDetailPanel（wide / narrow / roi-fontsize / volume-rwd / today-delta-wrap）
- 抽屜滾動到底（`holdings-drawer-scroll-bottom-devices`）
- Price axis dot shape/visual
- Range band dot alignment / inconsistency
- Override price debounce / recompute / scenarios
- Meta report modal（narrow / persist）
- Target price zero、error banner a11y、sync status aria-live
- Export menu、Today and price source
- FreeCheckup HoldingCard 手機三斷點（560 / 390 / 380px）

### Layer 5 — 籌碼面 ChipsSection
12. FinMind rate limit reservation lease、tier 分層排程（trading-hour gating）
13. 60s→900s 退避輪詢是否在沒有 pending 時真的停止
14. Per-stock status 錯誤原因回顯
15. 60 日回補按鈕的 queue 深度

### Layer 6 — Runtime（活體驗證）
16. Console errors / network 4xx & 5xx（Playwright 拉一次 `/checkup` + 開三個持倉抽屜）
17. `edge_boot_events` / `data_source_refresh_logs` / `perf_metrics` 最近 24 小時異常
18. Session replay 掃視覺 glitch

### Layer 7 — 匯出與整合
19. Holdings export CSV / Markdown 單位/幣別 parity
20. View-as 模式下的資料隔離（讀寫鎖）

## 交付物
1. **Bug 清單表格**：檔案:行 / 觸發條件 / 嚴重度 (P0-P3) / 建議修法 / 對應憲法 memo
2. **漏檢自述**：明確列出「這輪沒檢查什麼、為什麼」
3. **修復優先序**：分批交付計畫（P0 立刻、P1 本輪、P2 排入待辦）

## 技術細節

- Playwright 走 sandbox `localhost:8080`，viewport 固定 1280×1800，元素截圖優先
- SQL 稽核用 `supabase--read_query`（read-only）+ `supabase--linter`
- Edge function log 用 `supabase--edge_function_logs` 撈最近 7 天 error tier
- 不改任何檔案；發現 bug 只登記，修法留給下一輪 build mode 執行

## 需要你確認
1. 這輪要**只出清單**，還是**直接接續進 build mode 修 P0**？
2. 是否有你已知的痛點想優先掃（例如某個抽屜卡頓、某支股票數字對不上）？先講可以省一輪。
