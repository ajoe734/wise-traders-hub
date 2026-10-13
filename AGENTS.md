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

### Position history ledger

Treat `position_events` as the append-only source for member-visible holding changes while `useExpertHoldingsBundle` remains the only source for current positions; why: weekly content, mutable trade aggregates, and immutable transaction history have separate responsibilities.


### Domain docs

Single-context：根目錄 `CONTEXT.md`（領域語彙，禁放實作細節）加 `docs/adr/`（不可逆且有取捨的決策）。See `docs/agents/domain.md`.

### Valuation fundamentals

Holdings-drawer PE/PB/PS denominators come only from the read-only `valuation-fundamentals` Edge Function (pure math in `_shared/fundamentalsBasis.ts`, shared with Vitest); shares are DB-first `official_share_registry`, live exchanges/FinMind only as fallback; PE/PB/PS stay separate evidence, never intersected; personal scenarios stay device-local; why: keeps tokens server-side and forbids price-derived denominators.

### Valuation market-day data chain

The whole-market daily valuation sync (`valuation-sync` `market_day`) skips its FinMind call when the target date already has >= `MARKET_DAY_MIN_ROWS` (1,500) rows, writes every run to `system_jobs_log`, and raises a `valuation_market_day_low_rows` system alert when a run lands in (0, 1500) rows; a second evening cron re-runs it as a no-op catch-up. why: FinMind publishes the day's market file late and partially — the 16:30 Taipei run once silently wrote ~79 rows/day for two weeks, and cron failures must never be silent again. The gate decision lives in the pure `supabase/functions/_shared/valuationSyncGate.ts`, shared with Vitest.

### Forward valuation evidence

Forward/peer valuation evidence for the holdings drawer lives in the pure `src/checkup/lib/forwardValuation.ts`; a scenario price is computed only from a named-source forward (or TTM) per-share basis × a multiple of the same period kind, and period mismatches (historical TTM multiple × forward basis) block the scenario; why: the current provider only returns reported TTM/quarter-end denominators, so forward numbers must be user-sourced and never inferred, and peer medians/highs stay unadjusted references unless a premium/discount reason is given.

### Expert monthly payroll

Payouts come only from pure `src/lib/expertPayroll.ts`: expert_amount is recognized in the Taipei month its period ends (paid_at + cycle; yearly = 12 installments); refunds drop unmatured installments only. Paid months snapshot into `expert_payouts`; split precedence plan > `expert_split_settings` > global in `calcSplit`; why: pay only for completed service.

### Teacher articles

Blog-style teaching articles live in `expert_articles`, separate from `expert_signals`; block parsing, layout recommendation and trial excerpts come only from pure `src/lib/articleLayout.ts`, and visibility (subscription, publish time, trial) is enforced by RLS/RPC, never by the client; publish notices only via `article-push` + `_shared/articlePushCore.ts`, deduped by `claim_article_push`; why: articles must never touch holdings/signal ledgers, and layouts may restyle but never reorder content.

### Article AI assist

Article image restyle/tidy go only through `article-ai-image` / `article-ai-tidy` with pure gates in `_shared/articleAiCore.ts`; any image not confidently text-free is framed deterministically client-side (`src/lib/articleImageFrame.ts`, 1:1 pixels), and tidy output is rejected unless words and image order are identical; why: AI must never alter financial numbers or teacher wording.
