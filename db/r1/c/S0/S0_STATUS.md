# S0 PREFLIGHT STATUS — NOT GREEN

Production touch: **read-only** (SELECT / catalog / logs / browsing). No DDL, no DML, no deploy, no Publish.
**S1 仍未批准。**

Denominator = 10 explicitly enumerated gates. TOTAL: **7 PASS / 1 PARTIAL / 2 BLOCKER**.

| Gate | Result | Evidence |
|---|---|---|
| S0-1 lineage (422 remote vs 418 repo, ±10s drift, uuid-suffix, empty-name rows) | PASS | `lineage_query.json`, `s0_preflight.py`; 412 matched / 5 remote-only pre-repo / 5 duplicate-applied / 1 applied-not-recorded (`20260812211500_bsr_claim_token_slot`, `claim_bsr_queue_jobs` already carries `token_slot`) |
| S0-2a backup tier / PITR / retention / last recoverable point | **BLOCKER** | Not readable by any available tool. `supabase--project_info` and `lovable supabase info` return instance size (Mini) only — no backup tier, no PITR flag, no retention, no recovery point. Must be answered by the user/platform before S1. |
| S0-2b stage-specific backup artifact | PASS | `backup/MANIFEST.json` — 28 function definitions (`functions.sql`), 37 canonical ACL keys / 28 unique signatures with live `proacl` (`acl_keys.json`), 11 affected tables with columns/indexes/constraints/policies/grants/RLS (`catalog_affected.json`), 72 cron jobs (`cron_config.json`), catalog fingerprint anchor; every file sha256'd |
| S0-2c restore + S1-only rehearsal on fresh disposable clones | PASS | **Flow A** `s0flowA2`: 14/14 restore fidelity; 095 pre-cutover deviations exactly 42; 096 executed 160 with the exact pinned 35-row `EXPECTED_BASELINE` set (`5ed71542…`), not counted as post-cutover green; destroyed, background=0. **Flow B** `s0flowB4`: baseline restore → only `d/001_compat.sql`, `p/001_projection.sql`, `p/010_manifest_seed.sql`; existing relfilenode/economic data/public ACL/legacy-writer hashes unchanged; `S1_VERIFY_PASS`; stage rollback restored logical data/catalog/ACL/writer fingerprints exactly; destroyed, background=0. S1 was not run on production. |
| S0-3 schema/data/pointer/hash baseline | PASS | `s0_baselines.json`, `baseline_sha256=5efc0d9c…`; trade_records 82 rows / 5 experts / 21 open / md5 `4f1f1f9c…`; expert_signals 173 (all `published`) md5 `7d94e81e…`; projection pointer **absent** (expected pre-S3); columns/policies/triggers sha256 pinned |
| S0-4 exec env (long tx / blocked locks) | PASS | 0 transactions >60s, 0 blocked locks |
| S0-5 writer + trigger inventory | PASS | 15 DB writers, 23 triggers verified against live `pg_proc`/`pg_trigger` |
| S0-5b edge inventory (per-function detail) | PARTIAL | `edge_inventory.json` — 13/13 named with repo path, repo bundle sha256, `_shared` import hashes; deployment identity from `edge_boot_events` for 11/13; **E04 crypto-price-sync** and **E13 us-stock-quote** have no boot record at all (BLOCKER-level gaps inside this gate); numeric platform version observable for only 1/13 because `function_edge_logs` retention on this tier is ~1h; **no authoritative `deployed_at` and no production bundle hash is exposed to this agent**, so repo↔prod bundle equality cannot be proven |
| S0-6 freshness contradiction | PASS (resolved, verdict NOT_FRESH) | `freshness_trace.json`. The two earlier readings were **both correct**: chips-guardian auto-flaps the switches. Stable root chain: FinMind BSR HTTP 400 → `data_source_health.finmind_bsr` circuit **open** → guardian disables `chips_backfill`/`chips_keepwarm` → worker admission returns `circuit_open` / `kill_switch_off` → **0 attempt logs, 0 BSR writes in 24h**; last write `2026-08-15 15:07Z`, latest trade_date `2026-08-14`; queue done 9956 / failed 1573 / pending 76; universe: `stock_names` 74 rows (US 17 + 57 unlabelled), **TW master universe still empty**, prefetch targets 20, user holding entries 38 |
| S0-7 three-identity baseline smoke | **BLOCKER (safe feasibility exhausted)** | Read-only auth inventory: 69 auth users; 0 metadata testers; 0 dedicated testers; role coverage 3 company_admin + 7 analyst across 10 accounts. There is no zero-persistence JWT mechanism for live custom-domain + unpublished Preview smoke, and Preview anon redirects to the platform login bridge. Real users will not be impersonated. Anon evidence remains valid only for production: existing 404 + exact console error on `/performance`, `/journals`, `/checkup`, `/auth`, `/account`; `/` also has failed `hero-bg.mp4`, `/checkup` has failed Facebook error endpoint. Authenticated three-identity evidence is therefore unavailable, not silently waived. |

## Blockers before S1 may even be proposed
1. **S0-2a** — backup tier / PITR enabled / retention / last recoverable point are unknown and unreadable here.
2. **S0-7** — no dedicated tester and no zero-persistence JWT path; authenticated live+Preview smoke cannot be performed safely.

## Non-blocking but explicitly bounded risk
- **S0-5b**: E04 / E13 lack observable boot identity, and no authoritative production bundle hash/deployed_at is exposed. The database restore artifact supports **S1 database rollback only**; it does **not** support S2 Edge overwrite/rollback. S2 remains independently blocked until deployable Edge artifacts and hashes exist.

## Corrected baseline facts
- **096 Flow A**: exact 35 rows are in `expected_baseline_096_rows.json`, each with test ID / SQLSTATE / actual. Any extra, missing, or changed row fails. These are `EXPECTED_BASELINE`, never restore defects and never post-cutover PASS.
- **12 experts**: `s0_baselines.json` stores exact expert_id / slug / name / status / classification / reason. Result is **ready 0 / manual_review 5 / incomplete 7**. `sharkgu` (彥愷) is manual_review: all 35 replay keys unsafe, including 7 drift26.
- **6515**: `expert_signals.instrument` and `trade_records.instrument` direct + `signal_id` join finds 4 signals and 2 trade rows. The two rows are one open quantity 50 and one closed quantity 50; **50 is quantity, not row count**. Replay candidate is 10; stored 50 and replay 10 are both non-authoritative and withheld.
- **Freshness HTTP 400 chain**: `finmind_bsr.last_error_code=http_400`, circuit open with 55 consecutive failures in the pinned snapshot; guardian disabled `chips_backfill` after 59/59 circuit-open rejects and flapped `chips_keepwarm`; worker admission returned circuit/kill-switch rejection, yielding zero attempts and zero writes. Current switch snapshots may differ because guardian auto-heals; the timestamped chain is the evidence.

## Verdict
**S0 is NOT green. Flow A and clone-only Flow B are PASS, but they grant no production authorization. R1-P remains clone-only PASS. Production remains NO-GO. S1 / S2 / any production mutation / deploy / Publish is NOT approved.**

---

## Appendix A — Flow A / Flow B exact run evidence (clone-only)

**Flow A** `s0flowA2-20260817T092028Z-45212` · start `2026-08-17T09:20:28.745Z` · end `09:20:36.915Z` · TOTAL_FAILURES=0 · log sha256 `7e82d3d9e5eb0517…` (file) / in-log `6c199ae3019b4385…` · restored catalog hash `a2f8bfca0c93b8727009be86442b7073` · clone destroyed (`/tmp/s0flowA2` gone) · background=0.
Fidelity 14/14 PASS: 28 function defs; 37 canonical ACL keys = 149 aclexplode tuples / 28 signatures with owners; 140-probe `has_function_privilege` matrix, 0 extra PUBLIC EXECUTE; 11 tables (columns/indexes/constraints/policies/rls/grants 22 rows); 72 cron; 15 writers; 23 triggers.
096 diagnostic: 160 executed, **exactly 35** deviations, failure-set sha256 `5ed715420481d463…` = pinned `expected_baseline_096.json` → 0 extra / 0 missing → EXPECTED_BASELINE.

**Flow B** `s0flowB4-20260817T092251Z-47686` · start `2026-08-17T09:22:51.921Z` · end `09:23:00.520Z` · failures=0 · destroyed=true · background=0 · log sha256 `cfe88fde86295d49…` (file) / in-log `6ff5cc8376487…`.
Steps: restore baseline → apply only `d/001_compat.sql`, `p/001_projection.sql`, `p/010_manifest_seed.sql` → `s1_verify.sql` = `S1_VERIFY_PASS` → `s1_rollback.sql`.
Fingerprints (`before.fp` / `after.fp` / `rollback.fp`):
- relfilenode `792cab66…` → `792cab66…` (unchanged by S1) → `532831998f18…` after rollback (base tables recreated; logical state identical)
- economic `35d397b14a1d46bbb3e4fda9172eecf3` unchanged at all three points
- public_acl `587122c3444de69ee5409c3c6ce49338` unchanged at all three points
- legacy_writer_contract `79b3e11bab5c4e2fce73264128d9dbfe` unchanged at all three points
- `no_drift.diff` 0 bytes, `rollback.diff` 0 bytes

## Appendix B — 096 baseline 35 deviations, category table
Artifact `expected_baseline_096_rows.json` (sha256-16 `63757928f8486972`), full 35 rows with test_id/sqlstate/actual.

| category | count | sqlstate / actual |
|---|---|---|
| T-P96b | 6 | 22P02×1, 42702×3, 42703×1, P0001×1 |
| T-P96b-exec | 6 | 22P02×1, 42702×3, 42703×1, P0001×1 |
| T-P96b-evd | 2 | body_refs_expert_slug=t, repaired_bodies=0 |
| T-P96c | 2 | got=1, got=28 |
| T-P96d | 2 | actual=00000 |
| T-P96e | 6 | 42883, get_expert_capital_status, public=18953/19037/19077/19086 |
| T-P96g | 11 | 00000×8, 42883×2, ""×1 |
| **total** | **35** | matches pinned set exactly |

Post-cutover 185/0 is **only** the existing R1-P clone evidence; it is not re-claimed here.

## Appendix C — freshness observed vs hypothesis
Observed (queried): `finmind_bsr` circuit open, 55 consecutive failures, `last_error_code=http_400`, `disabled_until=2026-08-17 08:46:13.991+00`; `chips_backfill` disabled `2026-08-17 08:10:03.764+00`; `worker_chain_24h.attempt_logs=0`, `bsr_rows_written=0`, last write `2026-08-15 15:07:03Z`, latest trade_date `2026-08-14`; queue done 9956 / failed 1573 / pending 76; `cron_dispatch_24h_by_job = {}` (empty).
Hypothesis (NOT observed end-to-end): there is **no natural run_id chain** linking cron → worker boot → admission reject, because attempt logs and per-job dispatch rows are both empty. The step "hourly cron fires and worker boots but admission rejects" is inference from switch/circuit state plus code paths, not from three joined run_ids. Wording downgraded from "root cause" to "consistent chain, partially inferred".

## S1-min rehearsal (Flow B2) — clone-only, production 0 touch

Files: `db/r1/c/S1/001_s1min.sql`, `010_manifest_seed.sql`, `s1min_verify.sql`,
`s1min_rollback.sql`, `s1min_fingerprint.sql`, `s1min_rehearsal.sh`.

S1-min contains ONLY newly created objects: role `ledger_owner` (NOLOGIN, no
BYPASSRLS), schema `app_ledger`, `replay_manifest_key` + immutability trigger,
the classifier/manifest/fx/embargo functions, and the two new public projection
tables with grants on themselves only. Deferred to S2: ledger core,
`effect_key`, guards, canonical writers, `CREATE OR REPLACE` of existing
writers, `ALTER ROLE ... BYPASSRLS`, and every GRANT on a pre-existing table.

| run_id | clone | apply | additive diff | verifier | rollback diff | residue | failures |
|---|---|---|---|---|---|---|---|
| s1minA-20260817T094123Z | fresh initdb :55972 | 1 txn OK | empty | PASS | empty | 0 | 0 |
| s1minB-20260817T094150Z | fresh initdb :55973 | 1 txn OK | empty | PASS | empty | 0 | 0 |

log_sha256 A `a240e9d5cae4fa5179667990170dcb59333319b1c9be218f32e594f4ae9de40e`,
B `1c79345963d4c979c1a9e85ea00da36e330ac1cb3a15cbd4aa723c99c644e878`; both
destroyed, background=0.

The fingerprint covers baseline relfilenode (excluding the 2 new tables),
economic rows, function ACL, table ACL, writer bodies/secdef, triggers and role
attributes. before == after == after-rollback on both clones, so S1-min is
additive by measurement and its stage rollback is exact for baseline objects
(no "byte-identical whole database" claim is made).

### Three sets are distinct (asserted by the verifier)
- quantity drift (market-aware) = 26
- fail-closed unsafe (`class <> 'match'`) = 36 — all withheld, manual_review, no authoritative qty
- withheld = 59 (superset of the 36), key-level publishable = 25, 59+25 = 84
- expert gate: 12 experts, ready = 0, so effective public output stays 0

Basis provenance regenerated at `db/r1/c/S0/manifest_basis.json` (raw E_classify
stdout remains unrecoverable; the seed SQL + replay artifacts are the surviving
authoritative basis, hashed there).

### Gate impact
- PITR unknown and authenticated smoke are NOT S1-min blockers (additive, proven
  rollback). They remain hard blockers for S2 (writer overwrite / Edge deploy).
- S1-min status: clone-only PASS x2. Production still 0 touch, not applied,
  nothing deployed or published.
