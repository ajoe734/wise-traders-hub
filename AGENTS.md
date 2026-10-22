# AGENTS.md

legendflow — React 18 + Vite + TypeScript 前台，Lovable Cloud（Supabase）後端。

## Agent skills

### Issue tracker

Issues 以本地 markdown 檔管理，放在 `.scratch/<feature-slug>/`。See `docs/agents/issue-tracker.md`.

新功能 issue 必用範本 `docs/agents/issue-template.md`，強制包含**驗收標準**、**頁面／路由清單**、**資料來源**三區塊。


### Triage labels

Use the five Status labels in `docs/agents/triage-labels.md`.

### Module boundaries

持倉看板五個深模組的邊界由機制強制，不靠自律：`npm run check:module-boundaries`（ESLint + Vitest + CI 三重）。
規則與理由見 `docs/adr/0001-checkup-five-deep-modules.md`。

### Holdings visual prototypes

Keep unapproved drawer design directions on runtime-guarded `/e2e/*` fixture routes and reuse production chart primitives; why: visual comparison must not alter live financial behavior or expose fabricated data on published hosts.

### Live holdings summary

Use `HoldingsVisualSummary` for the approved summary and its fixture preview; `buildLiveHoldingsSummary` projects existing ledger totals and `aggregateBySector` weights without querying or recalculating cost basis; why: prototype and live animations must agree without becoming a second financial ledger.

### Journal current holdings

Render the journal-detail current-holdings grid only from `useExpertHoldingsBundle` and its public projection gate; why: weekly editorial data must not become a second holdings ledger or leak unverified economic numbers.

### Position history ledger

Treat `position_events` as the append-only source for member-visible holding changes while `useExpertHoldingsBundle` remains the only source for current positions; why: weekly content, mutable trade aggregates, and immutable transaction history have separate responsibilities.


### Subdirectories

Read nested `AGENTS.md` in `src/checkup` and `supabase/functions` before edits; follow the latter's history-backfill lifecycle rule to prevent lost wakeups.

### Domain docs

Single-context：根目錄 `CONTEXT.md`（領域語彙，禁放實作細節）加 `docs/adr/`（不可逆且有取捨的決策）。See `docs/agents/domain.md`.

### Valuation fundamentals

Holdings-drawer PE/PB/PS denominators come only from the read-only `valuation-fundamentals` Edge Function (pure math in `_shared/fundamentalsBasis.ts`, shared with Vitest); it reads only the database (filings `valuation_filing_versions`, prices `tw_price_history`, month revenue `tw_month_revenue`, shares `official_share_registry`) and returns `DATA_PENDING` + enqueues `market_data_requests` when data is missing; PE/PB/PS stay separate evidence, never intersected; personal scenarios stay device-local; why: keeps tokens server-side and forbids price-derived denominators.

Client fundamentals cache freshness starts at request start; expired or Taipei-cross-day requests are not reused, and only the current in-flight request may cache or clear its entry; why: stale data must not pose as a new filing or overwrite newer requests.

Filing-refresh queue picks and state writes go only through `selectFilingQueue` / `updateFilingState` (`_shared/filingVersionStore.ts`; failures retry oldest-attempt first, writes guarded by symbol+period+source); why: errors stay retryable and runs cannot clobber newer filings.

### Expert monthly payroll

Payouts come only from pure `src/lib/expertPayroll.ts`: expert_amount is recognized in the Taipei month its period ends (paid_at + cycle; yearly = 12 installments); refunds drop unmatured installments only. Paid months snapshot into `expert_payouts`; split precedence plan > `expert_split_settings` > global in `calcSplit`; why: pay only for completed service.

### Teacher articles

Blog-style teaching articles live in `expert_articles`, separate from `expert_signals`; block parsing, layout recommendation and trial excerpts come only from pure `src/lib/articleLayout.ts`, and visibility (subscription, publish time, trial) is enforced by RLS/RPC, never by the client; publish notices only via `article-push` + `_shared/articlePushCore.ts`, deduped by `claim_article_push`; why: articles must never touch holdings/signal ledgers, and layouts may restyle but never reorder content.

### PDF export authorization

Factsheet requests must include an explicit export type and expert ID and use `requireExpertOwnerOrAdmin`; journal and legacy requests remain `requireCompanyAdmin` only. Never derive identity from request body fields; why: expert self-export must not widen journal permissions or permit cross-expert authorization.

### Campaign attribution

Persist anonymous first touch on login with original expiry; platform reports paginate and use `platformAttribution`; why: no lost sources, false signups or duplicated revenue.

### Financial quota reporting

Use `finmindUsage` with paginated job logs, completed-symbol deduplication and timestamped upstream observations; why: aggregate counts and internal pools cannot establish unique symbols or provider quota.

### Traffic metrics

Use `trafficQuality` for metrics, `trafficRecovery` for recovery, and `ga4Reconcile` for the separate GA4 comparison view; run `check:traffic` after changes. Count named pages, never infer event-time login; why: prevents invented history and mixed-source totals.
