# Edge function rules

### Valuation market-day data chain

The whole-market daily valuation sync (`valuation-sync` `market_day`) skips its FinMind call when the target date already has >= `MARKET_DAY_MIN_ROWS` (1,500) rows, writes every run to `system_jobs_log`, and raises a `valuation_market_day_low_rows` system alert when a run lands in (0, 1500) rows; a second evening cron re-runs it as a no-op catch-up. why: FinMind publishes the day's market file late and partially — the 16:30 Taipei run once silently wrote ~79 rows/day for two weeks, and cron failures must never be silent again. The gate decision lives in the pure `supabase/functions/_shared/valuationSyncGate.ts`, shared with Vitest.

### Peer PS multiples

Peer-reference PS comes only from `tw_ps_daily` (via `valuation_peer_multiples`), filled by `valuation-ps-sync`: per-share revenue uses the shared `computeCompanyBasis`/`dailyPsSeries` (DB-first shares) and is recomputed when the official index detects a new or revised filing; daily PS = exchange-wide close ÷ stored per-share revenue; pure logic in `_shared/peerPsCore.ts`, member list `_shared/peerPsUniverse.json` must equal the peer groups (Vitest-enforced); why: same basis as the drawer's own stations while keeping FinMind calls quarterly, not daily.

### Filing refresh publication

Detect issuer-quarter changes through the official filing index on the existing hourly job; publish complete statement versions and curated-peer PS basis/history only through the service-only atomic `commit_valuation_filing` RPC, matching the detected signature; why: partial input, concurrent revisions, or failed PS writes must not mark a stale financial version ready. Taipei-date expiry and client refresh share `filingRefreshCore`; peer PE/PB remain exchange-reported daily evidence, never price-derived substitutes.

Financial dataset caches and in-flight deduplication use `createFundamentalsCache` with request-start freshness and current-request ownership; official registries retain their separate TTL without financial date expiry; why: delayed financial requests must neither become new-day filings nor remove or overwrite a replacement request.

### Read endpoints are database-only

Page-facing read endpoints (`valuation-fundamentals`, `checkup-sparkline`) never call FinMind/TWSE/TPEx; only scheduled sync functions (`market-data-sync`, `valuation-ps-sync`, etc.) fetch externally, via `_shared/marketDataStore.ts` (Vitest `db-only-read-endpoints.test.ts` enforces); why: page refreshes and automated smoke runs must not consume upstream quota.


### Article AI assist

Article image restyle/tidy go only through `article-ai-image` / `article-ai-tidy` with pure gates in `_shared/articleAiCore.ts`; any image not confidently text-free is framed deterministically client-side (`src/lib/articleImageFrame.ts`, 1:1 pixels), and tidy output is rejected unless words and image order are identical; why: AI must never alter financial numbers or teacher wording.

### Historical backfill lifecycle

Historical-price backfill uses service-only enqueue/claim/finish RPCs and `historyBackfillRunner`; claims cap at 40, leases guard completion, persisted recent bars gate readiness, and queue writes lock scheduling before rows and unschedule on drain; why: concurrency must not lose wakeups, duplicate upstream work, or turn failed history into completed charts.

### GA4 reporting

GA4 numbers reach the admin UI only via company_admin `ga4-report` (pure `_shared/ga4ReportCore.ts`, analytics.readonly service account); never mix with own traffic tables or send GA hits; why: keys stay server-side, GA and own metrics stay separate.

### ECPay refunds

Credit-card refunds go only through company_admin `ecpay-refund` (pure `_shared/ecpayRefundCore.ts`): Action=N pre-capture, Action=R post-capture, both with TotalAmount; idempotent via `REFUND-<MerchantTradeNo>` ledger key, single attempt (no auto-retry on financial mutations), every outcome audited with payment_intents uuid as target; why: refunds must be ledgered once, never double-sent, and unknown network states must be checked manually before retry.

### Holding quote freshness

`stock-price-sync` queries MIS only through `_shared/misBatch.ts` (small batches, split-and-retry on non-OK `rtmessage`) and raises `expert_price_missing` when any open expert TW holding is unpriced; expert capital/performance RPCs read prices only via `latest_quote()` (newer of official close history and live quote, with `price_date`), and the UI labels stale dates via `src/lib/priceStaleness.ts`; `market-data-sync` daily fills TWSE via `MI_INDEX` when `STOCK_DAY_ALL` lags (plus `type=0999` warrants) and alerts `daily_close_lagging`; `daily-snapshot` writes TW rows only on open days and only for quotes updated that Taipei day, never CRYPTO, and stamps US rows with the last completed New York session; why: an oversized MIS batch once silently dropped ~70% of symbols and froze journal prices for weeks.
