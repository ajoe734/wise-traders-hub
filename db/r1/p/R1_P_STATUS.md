# R1-P STATUS — REPLAY + PUBLIC PROJECTION + EMBARGO CLOSURE

VERDICT: **IN PROGRESS — consumer closure re-run pending final two-clone acceptance** — production zero-touch (no DDL/DML, no Edge deploy, no data correction, no publish).

| Gate | r1pA | r1pB |
|---|---|---|
| schema errors | 0 | 0 |
| fidelity / shape | 104/104, 63/63 | 104/104, 63/63 |
| R1-D 090_verify regression | 66 tests, 0 fail | 66 tests, 0 fail |
| R1-P 090_verify_p | 63 tests, 0 fail | 63 tests, 0 fail |
| 091_swap_race (40 swaps / 200 reads) | 0 violations | 0 violations |
| failure injection (pointer held) | PASS | PASS |
| rollback hash before == after | IDENTICAL | IDENTICAL |
| clone destroyed | yes | yes |

Manifest reconciliation (production read-only): 84 = 48 match + 17 multiple_apply
+ 9 signal_only + 6 stored_only + 3 incomplete + 1 other; drift set = 17 + 9 = 26;
unit_ambiguous 24 (84-key basis) / 24 (76-pair basis); market_ambiguous 16 (84-key basis)
= 8 (76-pair basis, the R0 number) and 10 of the 26 drift keys. One definition only
(replay-84.json["ambiguity"]["definition"]); every JSON/status/test uses these exact numbers.
fx_history_unavailable 34 (single undated USDTWD row).
6515 穎崴: stored 50 vs replay 10, manual_review, withheld, no authoritative answer.

Deliverables: replay-84.json, drift-26.json, consumer-matrix.json, policy.md,
manifest_replay.sql, 001_projection.sql, 002_public_contract.sql, 010_manifest_seed.sql,
090_verify.sql, 090_verify_p.sql, 091_swap_race.sh, 092_embargo.sh, 099_rollback_p.sql,
run_two_fresh_clones.sh, run_two_fresh_clones_p.sh, public_legacy_readers.json, evidence/.

Derivative open positions (production read-only, replay-84.json["derivative_open_positions"]):
4/4 TW warrant opens (068003, 071745 -> tw_warrant master hit; 078397, 079052 -> conservative
unknown_derivative, absent from master) and 3/3 US option combos (LUNR/RKLB/SNDK) all carry
derivative_supported=false and public_disposition=withheld_incomplete. Rule: a derivative is
supported only with a complete quote+multiplier chain AND an adjudicated quantity basis
(class=match, single unit); drifted or unit-ambiguous derivative keys fail closed.

Public legacy readers: 10 = 6 gated by the typed public contract + 4 proven authenticated-only
(see public_legacy_readers.json).

## Frontend / test state (this round)

- typecheck (tsgo) clean; contract + UI suites green:
  publicProjection 9, publicEconomicContract 21, PerformanceReviewNotice 7,
  journalRepository mirror parity 11.
- Full suite: 2852 passed / 4 failed, all 4 blocked by the production zero-touch rule:
  - `rls-subscription-visibility` — `run_rls_subscription_tests()` EXECUTE not granted to the
    read-only production role.
  - `1.35-rls-security-audit` — anon still holds EXECUTE on `get_expert_capital_status`,
    `has_active_subscription_after`, `is_tester` in production. The R1-P clone ACL closure
    (002_public_contract.sql) revokes exactly these; the production REVOKE belongs to the
    cutover migration and is deliberately NOT applied this round.
- Fixed this round: `chips-chaos-drill` now uses the shared `requireCompanyAdmin` guard
  (no hand-rolled has_role branch); `freecheckup-tab-perf` HoldingsTab renders inside a
  QueryClientProvider (useChipsBatch dependency).
- journalRepository gate moved into the Deno single source
  (`supabase/functions/_shared/journalRepository.ts` + publicEconomicContract mirror), so the
  frontend mirror stays byte-identical.

STATUS: consumer closure implementation complete; final two-fresh-clone acceptance
(`db/r1/p/run_two_fresh_clones.sh`) still outstanding — no PASS claimed.

## Run 2026-06-XX — consumer closure + fail-closed defaults (production 0 touch)

- Fail-closed contract: `UNKNOWN_PROJECTION` (not loaded / unknown / API error)
  hides every number; only an *observed* absence (`LEGACY_NO_PROJECTION`) takes
  the legacy path. `error` moved into the not-ready set.
- New imperative resolver `src/lib/fetchProjectionStatus.ts` (worst state wins
  across a multi-expert scope); wired into `Journals.tsx` and
  `SignalsDashboard.tsx` (previously an ungated `select *` on expert_signals).
- `public_legacy_readers.json` reclassified: 7 typed_public_contract /
  2 entitled_non_economic / 1 internal_owner_only / 0 ambiguous. Bare
  "authenticated" is no longer an internal justification.
- Runtime coverage: `src/test/unit/public-legacy-readers.test.ts` (22 cases).
- Full app suite: 2878 passed / 1 failed → `price-authority-seam.test.ts`
  "shows the settled snapshot close" timed out at 5000 ms under full-suite
  load; passes in isolation (336 ms). Flake, not a contract regression.
- Adjusted stale expectations (fail-closed direction only, never toward ready):
  `publicEconomicContract.test.ts` (error → null), `PerformanceReviewNotice.test.tsx`
  (error renders the notice), `journal-repository-parity.test.ts` (default gate).
- tsgo clean, production build clean, scanner ALL GREEN (83 consumers / 37 DB objects).
- Clone fixes: `db/r1/clone/schema.sql` now carries `public.warrant_expiry`
  (security master required by `classify_instrument`); `010_manifest_seed.sql`
  disposition vocabulary corrected to `as_reported_publishable`.
- Two fresh clones: fidelity 104/104, shape 63/63, R1-D 66/66, R1-P 84 tests
  with **3 failures each** — all in the RLS harness: T-P99a (9 < 15 cases),
  T-P99b (`auth.users.instance_id` missing in the clone shape), T-P99c.
  092 embargo 0/0, swap race 0, failure injection PASS, rollback hash IDENTICAL.
- Production ACL baseline re-verified read-only: named=3, pattern=25,
  signature hash matches the pinned baseline. 0 DDL/DML/deploy/publish.

**Status: NO-GO** — 6 clone failures remain (RLS harness), so no R1-P PASS.
