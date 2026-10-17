# Edge function rules

### Valuation market-day data chain

The whole-market daily valuation sync (`valuation-sync` `market_day`) skips its FinMind call when the target date already has >= `MARKET_DAY_MIN_ROWS` (1,500) rows, writes every run to `system_jobs_log`, and raises a `valuation_market_day_low_rows` system alert when a run lands in (0, 1500) rows; a second evening cron re-runs it as a no-op catch-up. why: FinMind publishes the day's market file late and partially — the 16:30 Taipei run once silently wrote ~79 rows/day for two weeks, and cron failures must never be silent again. The gate decision lives in the pure `supabase/functions/_shared/valuationSyncGate.ts`, shared with Vitest.

### Peer PS multiples

Peer-reference PS comes only from `tw_ps_daily` (via `valuation_peer_multiples`), filled by `valuation-ps-sync`: per-share revenue uses the shared `computeCompanyBasis`/`dailyPsSeries` (DB-first shares) and is recomputed when the official index detects a new or revised filing; daily PS = exchange-wide close ÷ stored per-share revenue; pure logic in `_shared/peerPsCore.ts`, member list `_shared/peerPsUniverse.json` must equal the peer groups (Vitest-enforced); why: same basis as the drawer's own stations while keeping FinMind calls quarterly, not daily.

### Filing refresh publication

Detect issuer-quarter changes through the official filing index on the existing hourly job; publish complete statement versions and curated-peer PS basis/history only through the service-only atomic `commit_valuation_filing` RPC, matching the detected signature; why: partial input, concurrent revisions, or failed PS writes must not mark a stale financial version ready. Taipei-date expiry and client refresh share `filingRefreshCore`; peer PE/PB remain exchange-reported daily evidence, never price-derived substitutes.

Financial dataset caches and in-flight deduplication use `createFundamentalsCache` with request-start freshness and current-request ownership; official registries retain their separate TTL without financial date expiry; why: delayed financial requests must neither become new-day filings nor remove or overwrite a replacement request.
