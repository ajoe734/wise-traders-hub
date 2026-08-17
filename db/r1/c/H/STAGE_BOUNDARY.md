# Freshness work — stage boundaries (production touch: none)

H-ACL is a **standalone security stage** and is deliberately *not* bundled with
H0/H1/H2 or any later freshness work. Each stage below has its own migration
file set, its own rehearsal, its own rollback, and its own go/no-go.

| stage | scope | objects | rehearsal | current state |
|---|---|---|---|---|
| H-ACL | close the PUBLIC/anon/authenticated EXECUTE holes on 48 freshness writers; add guarded `finmind_pool_reset_v2()` | `h_acl_migrate.sql`, `h_acl_v2.sql` (+ two rollbacks), generated from the clone catalog | `h_acl_rehearsal.sh` → hacl7 / hacl8, 42/42 PASS | clone-proven, **not applied to production** |
| H0 | correlation_id + freshness_run_trace view + log retention | `001_h0_observability.sql` | `hfreshA_rehearsal.sh` | clone-proven |
| H1 | `tw_market_symbols` authoritative master (see `h1_eligibility.md`) | `002_h1_market_master.sql` | `hfreshA_rehearsal.sh` | clone-proven |
| H2 | privacy-safe `symbol_demand_registry` + cap/decay | `003_h2_demand_registry.sql` | `hfreshA_rehearsal.sh` (38/38, cap/decay evidence table) | clone-proven |
| H3+ | enqueue/worker/observability repairs, weekend policy, drawer trigger removal, frontend freshness UI | — | — | **blocked**, see below |

## Ordering rules

1. H-ACL ships alone. It is ACL-only plus one new guarded function; it changes
   no table, no data, no function body of any existing object (proven by A-12).
2. H0/H1/H2 ship as their own transaction afterwards; they are additive and do
   not depend on H-ACL.
3. H4 (institutional/BSR SLO work) is gated on provider reliability — see
   `provider_probe.md`. Price and market-master paths may proceed independently.

## Frontend coupling

`src/pages/company/DataSourceHealth.tsx` currently calls
`supabase.rpc('finmind_pool_reset')`. That call must switch to
`finmind_pool_reset_v2` **in the same deploy as the H-ACL production migration**,
never before (the v2 function does not exist yet) and never after (the legacy
entry point becomes service_role-only, so the admin button would 403).
No frontend change is made in this turn because H-ACL has not been applied.
