# AGENTS.md

legendflow — React 18 + Vite + TypeScript 前台，Lovable Cloud（Supabase）後端。

## Agent skills

### Issue tracker

Issues 以本地 markdown 檔管理，放在 `.scratch/<feature-slug>/`。See `docs/agents/issue-tracker.md`.

新功能 issue 必用範本 `docs/agents/issue-template.md`，強制包含**驗收標準**、**頁面／路由清單**、**資料來源**三區塊。


### Triage labels

沿用五個標準 triage 角色字串（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`），記錄在每個 issue 檔的 `Status:` 行。See `docs/agents/triage-labels.md`.

### Module boundaries

持倉看板五個深模組的邊界由機制強制，不靠自律：`npm run check:module-boundaries`（ESLint + Vitest + CI 三重）。
規則與理由見 `docs/adr/0001-checkup-five-deep-modules.md`。

### Holdings price spectrum

Keep target price and the independently selected PE/PB/PS scenario on the drawer's single TWD scale in the reusable PriceSpectrum presentation component; valuation calculation and fetching stay in their existing modules, so visual changes cannot alter financial inputs or intersect rulers.

### Holdings institutional palette

Use fixed identity colors for foreign investors, investment trusts, and dealers in every drawer institutional surface; show direction with the zero line and signed values, preserving red/green exclusively for market-price and volume direction.

### Holdings visual prototypes

Keep unapproved drawer design directions on runtime-guarded `/e2e/*` fixture routes and reuse production chart primitives; why: visual comparison must not alter live financial behavior or expose fabricated data on published hosts.

### Journal current holdings

Render the journal-detail current-holdings grid only from `useExpertHoldingsBundle` and its public projection gate; why: weekly editorial data must not become a second holdings ledger or leak unverified economic numbers.


### Domain docs

Single-context：根目錄 `CONTEXT.md`（領域語彙，禁放實作細節）加 `docs/adr/`（不可逆且有取捨的決策）。See `docs/agents/domain.md`.

### Valuation fundamentals

Holdings-drawer PE/PB/PS denominators and multiples come only from the read-only `valuation-fundamentals` Edge Function (pure math in `supabase/functions/_shared/fundamentalsBasis.ts`, shared with Vitest). Share counts use official par from the DB-first `official_share_registry` table (kept fresh by the `official-registry-sync` cron, which logs every run to `system_jobs_log`; live TWSE/TPEx fetch is only a fallback, and FinMind issued shares ÷ capital snapped to a standard par is the last resort, with preferred shares treated as unverified) and parent net income must reconcile by `origin_name`; the share-count verification gate uses EPS rounding-interval intersection across the last 4 quarters (FinMind EPS has only 2 decimals, so weighted shares are a range, and IFRS deemed-treasury gaps are legitimate), not a fixed ±2% bracket; why: keeps the FinMind token server-side, keeps `stock_fundamentals` admin-only, forbids price-derived denominators, and keeps a slow official list from blocking the drawer. Target financials are fetched 7 years (prices 5) so TTM YoY has its base years; PE/PB/PS remain separate evidence and are never intersected into a system price. Personal scenarios stay device-local, use exactly one selected ruler with explicit expected/stress inputs, and are never presented as teacher or system fair-value output.

### Valuation market-day data chain

The whole-market daily valuation sync (`valuation-sync` `market_day`) skips its FinMind call when the target date already has >= `MARKET_DAY_MIN_ROWS` (1,500) rows, writes every run to `system_jobs_log`, and raises a `valuation_market_day_low_rows` system alert when a run lands in (0, 1500) rows; a second evening cron re-runs it as a no-op catch-up. why: FinMind publishes the day's market file late and partially — the 16:30 Taipei run once silently wrote ~79 rows/day for two weeks, and cron failures must never be silent again. The gate decision lives in the pure `supabase/functions/_shared/valuationSyncGate.ts`, shared with Vitest.

### Forward valuation evidence

Forward/peer valuation evidence for the holdings drawer lives in the pure `src/checkup/lib/forwardValuation.ts`; a scenario price is computed only from a named-source forward (or TTM) per-share basis × a multiple of the same period kind, and period mismatches (historical TTM multiple × forward basis) block the scenario; why: the current provider only returns reported TTM/quarter-end denominators, so forward numbers must be user-sourced and never inferred, and peer medians/highs stay unadjusted references unless a premium/discount reason is given.
