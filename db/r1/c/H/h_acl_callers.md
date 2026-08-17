# Caller inventory for the three keep-list candidates

Read-only catalog + repo scan, 2026-08-17. Production ACL as observed today:

| function | secdef | in-body guard | current EXECUTE holders |
|---|---|---|---|
| `public.enqueue_bsr_backfill(text,integer)` | yes | `auth.uid()` required + `has_role(company_admin)` or holding-owner check | postgres, **anon**, authenticated, service_role |
| `public.finmind_pool_set_budget(text,integer)` | yes | `has_role(auth.uid(),'company_admin')` → else `unauthorized` | postgres, **anon**, authenticated, service_role |
| `public.finmind_pool_reset()` | yes | **none** | postgres, **anon**, **authenticated**, service_role |

`finmind_pool_reset()` is the real hole: any signed-in (in practice any anon)
caller can zero `finmind_quota_pools.used_today` and delete 7-day-old
`finmind_quota_ledger` rows — i.e. defeat the FinMind quota accounting.

## Callers

### `finmind_pool_reset()`
| kind | location | purpose |
|---|---|---|
| frontend | `src/pages/company/DataSourceHealth.tsx:197` — `supabase.rpc('finmind_pool_reset')` | admin console "重置配額" button |
| edge functions | none (`rg` over `supabase/functions`: 0 hits) | — |
| SQL / cron | none (no `cron.schedule`, no other function body references it) | — |

### `finmind_pool_set_budget(text,integer)`
| kind | location | purpose |
|---|---|---|
| frontend | `src/pages/company/DataSourceHealth.tsx:183` | admin console daily-budget editor |
| edge functions | none | — |
| SQL / cron | none | — |

### `enqueue_bsr_backfill(text,integer)`
| kind | location | purpose |
|---|---|---|
| frontend | `src/checkup/hooks/useChipsBackfill.ts:72` (via `gateway.rpc`) | holdings drawer "回補籌碼" button |
| tests | `src/test/unit/useChipsBackfill.test.ts`, `src/test/unit/checkup-gateway-seam.test.ts`, `supabase/tests/enqueue_bsr_backfill_authz_test.sql` | seam + authz coverage |
| edge functions | none | — |
| SQL / cron | none (`20260723070430` only mentions it in a comment) | — |

## Decision

1. `finmind_pool_reset()` — **converged to service_role-only** (no keep-list
   entry). It keeps working for edge/cron paths; browser callers lose it.
2. New `finmind_pool_reset_v2()` — same body behind the
   `has_role(auth.uid(),'company_admin')` guard, with a `service_role` bypass
   evaluated on `session_user` / the JWT `role` claim (inside SECURITY DEFINER
   `current_user` is the owner and would always pass). Granted to
   `authenticated, service_role`; `PUBLIC`/`anon` revoked.
3. The admin console switches to `finmind_pool_reset_v2` **in the same deploy as
   the H-ACL production migration** — see `STAGE_BOUNDARY.md`. Not changed yet.
4. `finmind_pool_set_budget` and `enqueue_bsr_backfill` stay reachable by
   `authenticated` (both carry their own guard); `PUBLIC`/`anon` revoked.

## Clone proof (hacl7 / hacl8, 42/42 PASS each)

| check | result |
|---|---|
| A-16 v2 grants = authenticated + service_role, anon denied | PASS |
| A-17 plain `authenticated` (non-admin JWT, login role `auth_l`) → `unauthorized` | PASS |
| A-18 `company_admin` JWT → `{"ok": true}` | PASS |
| A-19 `service_role` session → allowed | PASS |
| A-20 legacy `finmind_pool_reset()` = `f/f/t` (anon/authenticated denied, service_role allowed) | PASS |
| A-21 0 of the other 46 hardened writers reachable by public/anon/authenticated | PASS |
| A-08 anon + authenticated denied on `finmind_pool_reset()` and 5 other writers | PASS |
| A-13 rollback restores the whole-catalog ACL snapshot bit-identically | PASS |
| A-14 post-rollback fidelity: 37 canonical ACL keys / 149 tuples + every baseline artifact | PASS |
| A-22 v2 rollback drops the new function (catalog back to baseline shape) | PASS |
