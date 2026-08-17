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


## C/D closeout — 2026-08-17 (evidence read-back, production 0 touch)

### A. full app vitest ×3 (serial, single background pid=23341)
| run_id | start | end | exit | files | tests | skipped | failed | log sha256 |
|---|---|---|---|---|---|---|---|---|
| vitestFINAL1 | 07:33:32.025Z | 07:35:26.901Z | 0 | 226 passed / 2 skipped (228) | 2895 passed | 8 | 0 | ccef7095e31dafc036a38076c0bcccc03925002183e7758559d0ef1e12ef3baa |
| vitestFINAL2 | 07:35:26.924Z | 07:37:21.644Z | 0 | 226 passed / 2 skipped (228) | 2895 passed | 8 | 0 | ca63e8fab0440146a809b4390dda61283cbfa719c27dd3999b7527644557bf5b |
| vitestFINAL3 | 07:37:21.664Z | 07:39:15.488Z | 0 | 226 passed / 2 skipped (228) | 2895 passed | 8 | 0 | 2f3c8666c8cd3da4bf5014131646cf5de5a62aab7859f1b0e013e5cc73c508cf |

Superseded (vitestC1/C2/C3, pid=12847): C1 green, C2 1 failed file, C3 2 failed files —
`price-authority-seam` (5s default) and `checkup-free-surface-barrel` (30s) timed out under
parallel load, not logic. Fixed by explicit per-case timeouts; the three rounds above were
recomputed from scratch, not re-run only for the failures.

Gates (`/tmp/r1p-c/gates.log`): tsgo exit=0 · `rm -rf dist && vite build` exit=0 ·
consumer scanner ALL GREEN (exit 0) · module boundaries 0 violations ·
backdoor scan over `dist/`: 1 hit = `dist/robots.txt:15 Disallow: /e2e/` (static text, no
runtime code, no `__lfQueryClient` / `HarnessEntry` / `__shell-bus` in any bundle).

### B. two fresh production-shape clones (sequential, non-overlapping)
| clone | run_id | start | end | exit | log sha256 |
|---|---|---|---|---|---|
| r1pA | r1pA-20260817T074048Z-33705 | 07:40:48.289Z | 07:41:02.146Z | 0 | 3a4dd6ac704713b5829cffb27eadf41bec86c82f477c3c3cf6c385da5435e65e |
| r1pB | r1pB-20260817T074102Z-33705 | 07:41:02.208Z | 07:41:16.048Z | 0 | 0e0309f2b019dc546008cf90eb313b13e1cee86d12ce367b090f5c53c62828ea |

A ends 07:41:02.146Z, B starts 07:41:02.208Z — no overlap. Per clone: fidelity 109/109 ·
shape 63/63 · R1-D 090 = 66/0 · R1-P 090_verify_p = 94/0 · 095_acl25_verify = **65/0** ·
096_acl_dynamic_proof = 185/0 · 092_embargo = 27/0 (min 25) · RLS harness = 16/0 (min 15) ·
094 role matrix = 21/0 · 091_swap_race violations 0 · failure injection pointer held at 49 ·
rollback hash before == after · clone destroyed (`/tmp/r1pA`, `/tmp/r1pB` gone).
`R1-P TWO-CLONE RESULT: cloneA_failures=0 cloneB_failures=0` · entry point exit=0.

**Why the old "70" is void:** 095 is generated by `build_acl25.py`; it can only emit
28 targets × 2 axes + 2 raw twins + 3 runtime negatives + 3 signature pins = 64 assertions
plus 1 coverage test = **65 executed**. The 70 figure was never produced by any run. A clone
run also once reported 9 tests: `to_regprocedure()` was fed argument *names*
(`is_tester_raw(_user_id uuid)`) and aborted the whole DO block with
`syntax error at or near "uuid"` — a false-red that also masked coverage. Both mistakes are
now locked by the generator regression test `src/test/unit/acl25-generator.test.ts`
(byte-identical regeneration, 28 targets, coverage=64, identity-wrapper assertion wording,
T-P98i signature pins).

### C. production read-only read-back (SELECT/metadata only)
Probe = `db/r1/p/acl_watchset.sql`, a single `SELECT` over `pg_proc`/`aclexplode` executed
with the restricted read-only role; no function EXECUTE, no DDL, no DML.

- unique functions = **28** (25 pattern family + 3 named, overlap **0**, `named_is_subset_of_pattern=false`)
- canonical ACL keys = **37** (anon_execute 28 + public_execute 9), duplicate_check = **0**
- watchset sha256 = `4b789a857ffd1f21f0b089d1a192f4f952acb58907c169c233f017fdd465d18c` = pinned baseline (no drift)
- detail sha256 = `29409e83d23c1fde71d415f9ecf420614312d8246e5484f558b56e227280a018`
- canonical keys evidence sha256 = `2842cb39dc9cc33f088867e140dbc08a6b96e2e6fa36ae242c8e7335fd53e081`
- disjointness evidence sha256 = `46d76e7248be336e1fea9aec8f1cb6d11d321d51965bf994a849db461397723c`
- production DDL = 0, DML = 0, GRANT = 0, REVOKE = 0, EXECUTE = 0, deploy = 0, Publish = 0

### D. artifact re-parse
`build_acl25.py --check` → `25 pattern + 3 named = 28 unique (37 canonical keys),
0 unclassified, 0 failures`; regeneration byte-identical. Background processes after the
run: **0** (`ps` count 0).

### Status
**R1-P clone-only PASS; production NO-GO until staged cutover; production real-data E2E not run.**
